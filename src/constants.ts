// Logging
export const LOG_PREFIX = "[GMCPT]";

// Error messages
export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "Quota exceeded for Gemini model requests",
  QUOTA_EXCEEDED_SHORT: "Gemini daily quota exceeded. Please try again later.",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
} as const;

// Status messages
export const STATUS_MESSAGES = {
  SANDBOX_EXECUTING: "Executing Gemini CLI command in sandbox mode...",
  GEMINI_RESPONSE: "Gemini response:",
  PROCESSING_START: "Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "Still processing... Gemini is working on your request",
  PROCESSING_COMPLETE: "Analysis completed successfully",
} as const;

// Models
export const MODELS = {
  V3: "3",
  PRO: "gemini-3-pro-preview",
  PRO_31: "gemini-3.1-pro-preview",
} as const;

/**
 * Fallback chain when no model is explicitly specified.
 * Tried in order; `null` means omit the --model flag entirely (CLI default).
 *
 * Note: CLI default is currently gemini-3-pro-preview (same as PRO),
 * so `null` would be a redundant retry. We use gemini-2.5-pro as
 * a true last-resort since it's a stable GA model.
 */
export const FALLBACK_MODELS: (string | null)[] = [
  MODELS.PRO_31,      // gemini-3.1-pro-preview  (latest preview)
  MODELS.PRO,         // gemini-3-pro-preview     (stable preview)
  "gemini-2.5-pro",   // GA model — true last-resort
];

// MCP Protocol Constants
export const PROTOCOL = {
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  CONTENT_TYPES: {
    TEXT: "text",
  },
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
    REPORT: "report",
  },
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  KEEPALIVE_INTERVAL: 25_000,
} as const;

// CLI Constants
export const CLI = {
  COMMANDS: {
    GEMINI: "gemini",
    ECHO: "echo",
  },
  FLAGS: {
    MODEL: "-m",
    SANDBOX: "-s",
    PROMPT: "-p",
    HELP: "-help",
    YOLO: "-y",
    OUTPUT_FORMAT: "--output-format",
  },
  DEFAULTS: {
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
  },
} as const;

// Timeouts
export const TIMEOUTS = {
  /** Default command timeout: 5 minutes */
  COMMAND_DEFAULT_MS: 5 * 60 * 1000,
  /** Extended timeout for sandbox mode */
  COMMAND_SANDBOX_MS: 8 * 60 * 1000,
} as const;

/**
 * Generic tool arguments — each tool should validate via its own zod schema.
 * This interface is kept minimal; tool-specific fields live in their zod schemas.
 */
export interface ToolArguments {
  [key: string]: string | boolean | number | undefined;
}
