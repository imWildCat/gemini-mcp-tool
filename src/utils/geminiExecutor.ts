import { executeCommand, CommandOptions } from './commandExecutor.js';
import { Logger } from './logger.js';
import {
  FALLBACK_MODELS,
  CLI,
  TIMEOUTS,
} from '../constants.js';

import { parseChangeModeOutput, validateChangeModeEdits } from './changeModeParser.js';
import { formatChangeModeResponse, summarizeChangeModeEdits } from './changeModeTranslator.js';
import { chunkChangeModeEdits } from './changeModeChunker.js';
import { cacheChunks, getChunks } from './chunkCache.js';

/**
 * User-configured default model from env, if any.
 * Returns undefined when no env override is set (triggers fallback chain).
 */
function getEnvModelOverride(): string | undefined {
  return process.env.GEMINI_DEFAULT_MODEL || process.env.DEFAULT_MODEL || undefined;
}

/**
 * Build CLI args for a single Gemini invocation.
 * Always includes --yolo so the CLI auto-approves tool calls
 * (stdin is piped away, so interactive confirmation would hang).
 */
function buildArgs(model: string | null, sandbox: boolean): string[] {
  const args: string[] = [];
  if (model !== null) {
    args.push(CLI.FLAGS.MODEL, model);
  }
  if (sandbox) {
    args.push(CLI.FLAGS.SANDBOX);
  }
  // Always run in yolo mode: the MCP server provides no TTY,
  // so the CLI must not block waiting for user confirmation.
  args.push(CLI.FLAGS.YOLO);
  return args;
}

export interface GeminiResult {
  output: string;
  model: string;
}

export async function executeGeminiCLI(
  prompt: string,
  model?: string,
  sandbox?: boolean,
  changeMode?: boolean,
  onProgress?: (newOutput: string) => void,
): Promise<GeminiResult> {
  let prompt_processed = prompt;

  if (changeMode) {
    prompt_processed = prompt.replace(/file:(\S+)/g, '@$1');

    const changeModeInstructions = `
[CHANGEMODE INSTRUCTIONS]
You are generating code modifications that will be processed by an automated system. The output format is critical because it enables programmatic application of changes without human intervention.

INSTRUCTIONS:
1. Analyze each provided file thoroughly
2. Identify locations requiring changes based on the user request
3. For each change, output in the exact format specified
4. The OLD section must be EXACTLY what appears in the file (copy-paste exact match)
5. Provide complete, directly replacing code blocks
6. Verify line numbers are accurate

CRITICAL REQUIREMENTS:
1. Output edits in the EXACT format specified below - no deviations
2. The OLD string MUST be findable with Ctrl+F - it must be a unique, exact match
3. Include enough surrounding lines to make the OLD string unique
4. If a string appears multiple times (like </div>), include enough context lines above and below to make it unique
5. Copy the OLD content EXACTLY as it appears - including all whitespace, indentation, line breaks
6. Never use partial lines - always include complete lines from start to finish

OUTPUT FORMAT (follow exactly):
**FILE: [filename]:[line_number]**
\\\`\\\`\\\`
OLD:
[exact code to be replaced - must match file content precisely]
NEW:
[new code to insert - complete and functional]
\\\`\\\`\\\`

EXAMPLE 1 - Simple unique match:
**FILE: src/utils/helper.js:100**
\\\`\\\`\\\`
OLD:
function getMessage() {
  return "Hello World";
}
NEW:
function getMessage() {
  return "Hello Universe!";
}
\\\`\\\`\\\`

EXAMPLE 2 - Common tag needing context:
**FILE: index.html:245**
\\\`\\\`\\\`
OLD:
        </div>
      </div>
    </section>
NEW:
        </div>
      </footer>
    </section>
\\\`\\\`\\\`

IMPORTANT: The OLD section must be an EXACT copy from the file that can be found with Ctrl+F!

USER REQUEST:
${prompt_processed}
`;
    prompt_processed = changeModeInstructions;
  }

  // Wrap prompts containing @ syntax in quotes for cross-platform compat
  const finalPrompt = prompt_processed.includes('@') && !prompt_processed.startsWith('"')
    ? `"${prompt_processed}"`
    : prompt_processed;

  const timeoutMs = sandbox ? TIMEOUTS.COMMAND_SANDBOX_MS : TIMEOUTS.COMMAND_DEFAULT_MS;

  // --- Model selection strategy ---
  const envOverride = getEnvModelOverride();

  if (model) {
    const args = buildArgs(model, !!sandbox);
    args.push(finalPrompt);
    const output = await executeCommand(CLI.COMMANDS.GEMINI, args, { timeoutMs, onProgress });
    return { output, model };
  }

  if (envOverride) {
    const args = buildArgs(envOverride, !!sandbox);
    args.push(finalPrompt);
    const output = await executeCommand(CLI.COMMANDS.GEMINI, args, { timeoutMs, onProgress });
    return { output, model: envOverride };
  }

  // No model specified -> fallback chain
  let lastError: Error | undefined;
  for (let i = 0; i < FALLBACK_MODELS.length; i++) {
    const candidateModel = FALLBACK_MODELS[i];
    const label = candidateModel ?? '(CLI default)';
    try {
      Logger.debug(`Trying model: ${label}`);
      const args = buildArgs(candidateModel, !!sandbox);
      args.push(finalPrompt);
      // Always forward progress — on fallback, the new process starts with fresh stdout,
      // so the first onProgress call naturally overwrites stale state from the failed model.
      const output = await executeCommand(CLI.COMMANDS.GEMINI, args, {
        timeoutMs,
        onProgress,
      });
      return { output, model: label };
    } catch (error) {
      lastError = error as Error;
      Logger.debug(`Model ${label} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error('All model fallback attempts failed');
}

export async function processChangeModeOutput(
  rawResult: string,
  chunkIndex?: number,
  chunkCacheKey?: string,
  prompt?: string,
): Promise<string> {
  // Check for cached chunks first
  if (chunkIndex && chunkCacheKey) {
    const cachedChunks = getChunks(chunkCacheKey);
    if (cachedChunks && chunkIndex > 0 && chunkIndex <= cachedChunks.length) {
      Logger.debug(`Using cached chunk ${chunkIndex} of ${cachedChunks.length}`);
      const chunk = cachedChunks[chunkIndex - 1];
      let result = formatChangeModeResponse(
        chunk.edits,
        { current: chunkIndex, total: cachedChunks.length, cacheKey: chunkCacheKey },
      );

      if (chunkIndex === 1 && chunk.edits.length > 5) {
        const allEdits = cachedChunks.flatMap(c => c.edits);
        result = summarizeChangeModeEdits(allEdits) + '\n\n' + result;
      }
      return result;
    }
    Logger.debug(`Cache miss or invalid chunk index, processing new result`);
  }

  const edits = parseChangeModeOutput(rawResult);

  if (edits.length === 0) {
    return `No edits found in Gemini's response. Please ensure Gemini uses the OLD/NEW format. \n\n+ ${rawResult}`;
  }

  const validation = validateChangeModeEdits(edits);
  if (!validation.valid) {
    return `Edit validation failed:\n${validation.errors.join('\n')}`;
  }

  const chunks = chunkChangeModeEdits(edits);

  let cacheKey: string | undefined;
  if (chunks.length > 1 && prompt) {
    cacheKey = cacheChunks(prompt, chunks);
    Logger.debug(`Cached ${chunks.length} chunks with key: ${cacheKey}`);
  }

  const returnChunkIndex = (chunkIndex && chunkIndex > 0 && chunkIndex <= chunks.length) ? chunkIndex : 1;
  const returnChunk = chunks[returnChunkIndex - 1];

  let result = formatChangeModeResponse(
    returnChunk.edits,
    chunks.length > 1 ? { current: returnChunkIndex, total: chunks.length, cacheKey } : undefined,
  );

  if (returnChunkIndex === 1 && edits.length > 5) {
    result = summarizeChangeModeEdits(edits, chunks.length > 1) + '\n\n' + result;
  }

  Logger.debug(`ChangeMode: Parsed ${edits.length} edits, ${chunks.length} chunks, returning chunk ${returnChunkIndex}`);
  return result;
}
