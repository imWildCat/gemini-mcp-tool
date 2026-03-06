/**
 * Per-operation progress tracker. Each tool invocation gets its own instance
 * so concurrent calls don't stomp each other's state.
 */
export interface ProgressTracker {
  /** Latest output snapshot from the running command. */
  latestOutput: string;
  /** Whether the operation is still in flight. */
  active: boolean;
  /** Stop tracking and clear the keepalive interval. */
  stop(success: boolean): void;
}

export interface ProgressTrackerOptions {
  operationName: string;
  /** MCP progress token (undefined = client didn't request progress). */
  progressToken?: string | number;
  /** Send a progress notification to the MCP client. */
  sendProgress: (
    token: string | number,
    progress: number,
    total: number | undefined,
    message: string,
  ) => Promise<void>;
  /** Interval in ms between keepalive pings. Default 25 000. */
  intervalMs?: number;
}

const PROGRESS_MESSAGES = [
  "Gemini is analyzing your request...",
  "Processing files and generating insights...",
  "Creating structured response for your review...",
  "Large analysis in progress (this is normal for big requests)...",
  "Still working... Gemini takes time for quality results...",
];

export function createProgressTracker(opts: ProgressTrackerOptions): ProgressTracker {
  const { operationName, progressToken, sendProgress, intervalMs = 25_000 } = opts;

  const tracker: ProgressTracker = {
    latestOutput: "",
    active: true,
    stop: () => {},
  };

  if (!progressToken) {
    // Client didn't request progress — return a no-op tracker.
    tracker.stop = () => { tracker.active = false; };
    return tracker;
  }

  let msgIndex = 0;
  let progress = 0;

  // Immediate acknowledgement
  sendProgress(progressToken, 0, undefined, `Starting ${operationName}`).catch(() => {});

  const interval = setInterval(() => {
    if (!tracker.active) {
      clearInterval(interval);
      return;
    }

    progress += 1;
    const base = PROGRESS_MESSAGES[msgIndex % PROGRESS_MESSAGES.length];
    const preview = tracker.latestOutput.slice(-150).trim();
    const message = preview
      ? `${operationName} - ${base}\nOutput: ...${preview}`
      : `${operationName} - ${base}`;

    sendProgress(progressToken, progress, undefined, message).catch(() => {});
    msgIndex++;
  }, intervalMs);

  tracker.stop = (success: boolean) => {
    tracker.active = false;
    clearInterval(interval);
    sendProgress(
      progressToken,
      100,
      100,
      success ? `${operationName} completed successfully` : `${operationName} failed`,
    ).catch(() => {});
  };

  return tracker;
}
