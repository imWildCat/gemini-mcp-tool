import { LOG_PREFIX } from "../constants.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Read the minimum log level from env. Defaults to "info" so debug noise
 * doesn't flood the MCP client's diagnostic stream.
 */
function getMinLevel(): LogLevel {
  const env = process.env.GMCPT_LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_PRIORITY) return env as LogLevel;
  return "info";
}

export class Logger {
  private static minLevel: LogLevel = getMinLevel();

  private static shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private static formatMessage(message: string): string {
    return `${LOG_PREFIX} ${message}\n`;
  }

  static log(message: string, ...args: unknown[]): void {
    if (!this.shouldLog("info")) return;
    process.stderr.write(this.formatMessage(message));
    if (args.length > 0) console.error(...args);
  }

  static warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog("warn")) return;
    process.stderr.write(this.formatMessage(message));
    if (args.length > 0) console.error(...args);
  }

  static error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog("error")) return;
    process.stderr.write(this.formatMessage(message));
    if (args.length > 0) console.error(...args);
  }

  static debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog("debug")) return;
    process.stderr.write(this.formatMessage(message));
    if (args.length > 0) console.error(...args);
  }

  static toolInvocation(toolName: string, args: Record<string, unknown>): void {
    this.log(`[${toolName}] args: ${JSON.stringify(args)}`);
  }

  static toolParsedArgs(prompt: string, model?: string, sandbox?: boolean, changeMode?: boolean): void {
    this.log(`Parsed prompt: "${prompt}" changeMode: ${changeMode ?? false}`);
  }

  static commandExecution(command: string, args: string[], startTime: number): void {
    this.log(`[${startTime}] Starting: ${command} ${args.map(a => `"${a}"`).join(" ")}`);
    this._commandStartTimes.set(startTime, { command, args, startTime });
  }

  private static _commandStartTimes = new Map<number, { command: string; args: string[]; startTime: number }>();

  static commandComplete(startTime: number, exitCode: number | null, outputLength?: number): void {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.log(`[${elapsed}s] Process finished with exit code: ${exitCode}`);
    if (outputLength !== undefined) {
      this.log(`Response: ${outputLength} chars`);
    }
    this._commandStartTimes.delete(startTime);
  }
}
