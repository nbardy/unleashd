import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodTypeAny } from 'zod';
import { MEMORY_REVIEW_TOKEN_ENV, MEMORY_REVIEW_URL_ENV } from './control-server';
import { MEMORY_REVIEW_TOOLS } from './memory-review-tools';

/** No database or Buddy credentials: this proxy can only use the short-lived maintenance capability. */
export function createMemoryReviewMcpServer(
  call: (operation: string, input: unknown) => Promise<unknown>
) {
  const server = new McpServer({ name: 'unleashd-memory-review', version: '1.0.0' });
  // Avoid the SDK's recursive generic expansion for a heterogeneous schema registry.
  const registration = server as unknown as {
    registerTool(
      name: string,
      config: { description: string; inputSchema: ZodTypeAny },
      callback: (input: unknown) => Promise<Record<string, unknown>>
    ): unknown;
  };
  for (const [name, tool] of Object.entries(MEMORY_REVIEW_TOOLS)) {
    registration.registerTool(
      name,
      { description: tool.description, inputSchema: tool.schema },
      async (input: unknown) => {
        try {
          const result = await call(name, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      }
    );
  }
  return server;
}

async function main() {
  const url = process.env[MEMORY_REVIEW_URL_ENV];
  const token = process.env[MEMORY_REVIEW_TOKEN_ENV];
  if (!url || !token) throw new Error('Memory review capability is required');
  const server = createMemoryReviewMcpServer(async (operation, input) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ operation, input }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
  });
  await server.connect(new StdioServerTransport());
  process.once('SIGTERM', () => void server.close().finally(() => process.exit(0)));
}
if (require.main === module)
  void main().catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  });
