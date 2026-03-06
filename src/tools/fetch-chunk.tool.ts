import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { getChunks } from '../utils/chunkCache.js';
import { formatChangeModeResponse, summarizeChangeModeEdits } from '../utils/changeModeTranslator.js';
import { Logger } from '../utils/logger.js';

const inputSchema = z.object({
  cacheKey: z.string().describe("The cache key provided in the initial changeMode response"),
  chunkIndex: z.number().min(1).describe("Which chunk to retrieve (1-based index)")
});

export const fetchChunkTool: UnifiedTool = {
  name: 'fetch-chunk',
  description: 'Retrieves cached chunks from a changeMode response. Use this to get subsequent chunks after receiving a partial changeMode response.',
  
  zodSchema: inputSchema,
  
  prompt: {
    description: 'Fetch the next chunk of a response',
    arguments: [
      {
        name: 'prompt',
        description: 'fetch-chunk cacheKey=<key> chunkIndex=<number>',
        required: true
      }
    ]
  },
  
  category: 'utility',
  
  execute: async (args, _onProgress) => {
    const key = String(args.cacheKey);
    const idx = Number(args.chunkIndex);

    Logger.toolInvocation('fetch-chunk', args);
    Logger.debug(`Fetching chunk ${idx} with cache key: ${key}`);

    const chunks = getChunks(key);

    if (!chunks) {
      return `Cache miss: No chunks found for cache key "${key}".

  Possible reasons:
  1. The cache key is incorrect — have you run ask-gemini with changeMode enabled?
  2. The cache has expired (10 minute TTL)
  3. The MCP server was restarted and the file-based cache was cleared

Please re-run the original changeMode request to regenerate the chunks.`;
    }

    if (idx < 1 || idx > chunks.length) {
      return `Invalid chunk index: ${idx}

Available chunks: 1 to ${chunks.length}
You requested: ${idx}

Please use a valid chunk index.`;
    }

    const chunk = chunks[idx - 1];

    let result = formatChangeModeResponse(
      chunk.edits,
      { current: idx, total: chunks.length, cacheKey: key },
    );

    if (idx === 1 && chunks.length > 1) {
      const allEdits = chunks.flatMap(c => c.edits);
      result = summarizeChangeModeEdits(allEdits, true) + '\n\n' + result;
    }

    Logger.debug(`Returning chunk ${idx} of ${chunks.length} with ${chunk.edits.length} edits`);
    return result;
  }
};