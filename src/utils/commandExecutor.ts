import { spawn, ChildProcess } from "child_process";
import { Logger } from "./logger.js";

const isWindows = process.platform === "win32";

/** Default timeout: 5 minutes. Covers most Gemini CLI agentic sessions. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface CommandOptions {
  /** Abort signal — allows the caller to cancel early. */
  signal?: AbortSignal;
  /** Hard timeout in ms. When reached, the process is killed and partial output is returned. */
  timeoutMs?: number;
  /** Progress callback — receives new stdout chunks. */
  onProgress?: (newOutput: string) => void;
}

/**
 * Kill a child process tree. Tries SIGTERM first, then SIGKILL after 3 s.
 */
function killProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;

  // On Windows, use taskkill for the whole tree.
  if (isWindows) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }

  // Unix: SIGTERM → wait 3 s → SIGKILL
  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    // child.killed is true after ANY signal is sent, not when the process exits.
    // So we only check exitCode to determine if the process actually terminated.
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 3000);
  escalation.unref(); // don't keep the event loop alive
}

export async function executeCommand(
  command: string,
  args: string[],
  optionsOrCallback?: CommandOptions | ((newOutput: string) => void),
): Promise<string> {
  // Backwards-compat: old call sites pass a bare callback
  const opts: CommandOptions =
    typeof optionsOrCallback === "function"
      ? { onProgress: optionsOrCallback }
      : optionsOrCallback ?? {};

  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress } = opts;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    Logger.commandExecution(command, args, startTime);

    const childProcess = spawn(command, args, {
      env: process.env,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    // --- Settle helpers (resolve/reject at most once) ---
    const settle = (fn: typeof resolve | typeof reject, value: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (fn === resolve) {
        (fn as (v: string) => void)(value as string);
      } else {
        (fn as (e: Error) => void)(value as Error);
      }
    };

    // --- Hard timeout ---
    const timer = setTimeout(() => {
      timedOut = true;
      killProcess(childProcess);
      const partial = stdout.trim();
      if (partial.length > 0) {
        Logger.warn(`Process timed out after ${timeoutMs}ms — returning ${partial.length} chars of partial output`);
        settle(resolve, partial);
      } else {
        settle(reject, new Error(`Command timed out after ${timeoutMs}ms with no output`));
      }
    }, timeoutMs);
    timer.unref();

    // --- External abort (e.g. MCP request cancelled) ---
    const onAbort = () => {
      killProcess(childProcess);
      settle(reject, new Error("Command aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // --- stdout ---
    childProcess.stdout.on("data", (data: Buffer) => {
      if (settled) return; // Ignore data arriving while process is shutting down
      stdout += data.toString();
      // Pass full stdout snapshot so the caller always has the complete picture.
      // On model fallback, the new process starts fresh, naturally overwriting stale state.
      if (onProgress) {
        onProgress(stdout);
      }
    });

    // --- stderr ---
    childProcess.stderr.on("data", (data: Buffer) => {
      if (settled) return;
      stderr += data.toString();
      if (stderr.includes("RESOURCE_EXHAUSTED")) {
        const modelMatch = stderr.match(/Quota exceeded for quota metric '([^']+)'/);
        const model = modelMatch ? modelMatch[1] : "Unknown Model";
        Logger.error(`Gemini Quota Error: Quota exceeded for ${model}`);
      }
    });

    // --- Process events ---
    childProcess.on("error", (error) => {
      settle(reject, new Error(`Failed to spawn command: ${error.message}`));
    });

    childProcess.on("close", (code) => {
      if (timedOut) return; // already settled by timeout handler
      if (code === 0) {
        Logger.commandComplete(startTime, code, stdout.length);
        settle(resolve, stdout.trim());
      } else {
        Logger.commandComplete(startTime, code);
        const errorMessage = stderr.trim() || "Unknown error";
        settle(reject, new Error(`Command failed with exit code ${code}: ${errorMessage}`));
      }
    });
  });
}
