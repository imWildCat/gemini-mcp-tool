import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGeminiCLI, processChangeModeOutput } from '../utils/geminiExecutor.js';
import { 
  ERROR_MESSAGES, 
  STATUS_MESSAGES
} from '../constants.js';

const askGeminiArgsSchema = z.object({
  prompt: z.string().min(1).describe("Analysis request. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions"),
  model: z.string().optional().describe("Optional model override. If not specified, tries gemini-3.1-pro-preview, then gemini-3-pro-preview, then falls back to CLI default (no --model flag)."),
  sandbox: z.boolean().default(false).describe("Use sandbox mode (-s flag) to safely test code changes, execute scripts, or run potentially risky operations in an isolated environment"),
  changeMode: z.boolean().default(false).describe("Enable structured change mode - formats prompts to prevent tool errors and returns structured edit suggestions that Claude can apply directly"),
  chunkIndex: z.union([z.number(), z.string()]).optional().describe("Which chunk to return (1-based)"),
  chunkCacheKey: z.string().optional().describe("Optional cache key for continuation"),
});

export const askGeminiTool: UnifiedTool = {
  name: "ask-gemini",
  description: "model selection [-m], sandbox [-s], and changeMode:boolean for providing edits",
  zodSchema: askGeminiArgsSchema,
  prompt: {
    description: "Execute 'gemini <prompt>' to get Gemini AI's response. Supports enhanced change mode for structured edit suggestions.",
  },
  category: 'gemini',
  execute: async (args, onProgress) => {
    const { prompt, model, sandbox, changeMode, chunkIndex, chunkCacheKey } = args;
    if (!prompt || !String(prompt).trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const promptStr = String(prompt);
    const modelStr = model ? String(model) : undefined;
    const chunkIdx = chunkIndex ? Number(chunkIndex) : undefined;
    const cacheKeyStr = chunkCacheKey ? String(chunkCacheKey) : undefined;

    if (changeMode && chunkIdx && cacheKeyStr) {
      return processChangeModeOutput('', chunkIdx, cacheKeyStr, promptStr);
    }

    const { output, model: usedModel } = await executeGeminiCLI(
      promptStr,
      modelStr,
      !!sandbox,
      !!changeMode,
      onProgress,
    );

    if (changeMode) {
      return processChangeModeOutput(output, chunkIdx, undefined, promptStr);
    }
    return `${STATUS_MESSAGES.GEMINI_RESPONSE} [model: ${usedModel}]\n${output}`;
  }
};