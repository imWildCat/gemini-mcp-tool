#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CallToolRequest,
  ListToolsRequest,
  ListPromptsRequest,
  GetPromptRequest,
  Tool,
  Prompt,
  GetPromptResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "./utils/logger.js";
import { PROTOCOL, ToolArguments } from "./constants.js";
import { createProgressTracker } from "./utils/timeoutManager.js";

import {
  getToolDefinitions,
  getPromptDefinitions,
  executeTool,
  toolExists,
  getPromptMessage,
} from "./tools/index.js";

const server = new Server(
  {
    name: "gemini-cli-mcp",
    version: "1.6.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
      notifications: {},
      logging: {},
    },
  },
);

async function sendProgressNotification(
  progressToken: string | number,
  progress: number,
  total: number | undefined,
  message: string,
): Promise<void> {
  try {
    const params: Record<string, string | number> = { progressToken, progress };
    if (total !== undefined) params.total = total;
    if (message) params.message = message;

    await server.notification({
      method: PROTOCOL.NOTIFICATIONS.PROGRESS,
      params,
    });
  } catch (error) {
    Logger.error("Failed to send progress notification:", error);
  }
}

// tools/list
server.setRequestHandler(
  ListToolsRequestSchema,
  async (_request: ListToolsRequest): Promise<{ tools: Tool[] }> => {
    return { tools: getToolDefinitions() as unknown as Tool[] };
  },
);

// tools/call
server.setRequestHandler(
  CallToolRequestSchema,
  async (request: CallToolRequest): Promise<CallToolResult> => {
    const toolName: string = request.params.name;

    if (!toolExists(toolName)) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const progressToken = (
      request.params as Record<string, Record<string, string | number> | undefined>
    )._meta?.progressToken;

    // Each request gets its own isolated progress tracker — no shared mutable state
    const tracker = createProgressTracker({
      operationName: toolName,
      progressToken,
      sendProgress: sendProgressNotification,
      intervalMs: PROTOCOL.KEEPALIVE_INTERVAL,
    });

    try {
      const args: ToolArguments = (request.params.arguments as ToolArguments) ?? {};
      Logger.toolInvocation(toolName, args);

      const result = await executeTool(toolName, args, (newOutput) => {
        tracker.latestOutput = newOutput;
      });

      tracker.stop(true);

      return {
        content: [{ type: "text", text: result }],
        isError: false,
      };
    } catch (error) {
      tracker.stop(false);
      Logger.error(`Error in tool '${toolName}':`, error);

      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        content: [{ type: "text", text: `Error executing ${toolName}: ${errorMessage}` }],
        isError: true,
      };
    }
  },
);

// prompts/list
server.setRequestHandler(
  ListPromptsRequestSchema,
  async (_request: ListPromptsRequest): Promise<{ prompts: Prompt[] }> => {
    return { prompts: getPromptDefinitions() as unknown as Prompt[] };
  },
);

// prompts/get
server.setRequestHandler(
  GetPromptRequestSchema,
  async (request: GetPromptRequest): Promise<GetPromptResult> => {
    const promptName = request.params.name;
    const args = request.params.arguments ?? {};

    const promptMessage = getPromptMessage(promptName, args);

    if (!promptMessage) {
      throw new Error(`Unknown prompt: ${promptName}`);
    }

    return {
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: promptMessage },
        },
      ],
    };
  },
);

// Start the server
async function main() {
  Logger.debug("init gemini-mcp-tool v1.6.0");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.debug("gemini-mcp-tool listening on stdio");
}

main().catch((error) => {
  Logger.error("Fatal error:", error);
  process.exit(1);
});
