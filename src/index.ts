#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, initCliCredentials } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  initCliCredentials(process.argv.slice(2));
  const config = await loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('vmware-mcp server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
