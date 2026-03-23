import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from './types.js';
import { VmrunClient } from './vmrun.js';
import { registerLifecycleTools } from './tools/lifecycle.js';
import { registerGuestExecTools } from './tools/guest-exec.js';
import { registerGuestFsTools } from './tools/guest-fs.js';
import { registerSnapshotTools } from './tools/snapshots.js';
import { registerProcessTools } from './tools/process.js';
import { registerScreenTools } from './tools/screen.js';
import { registerVariableTools } from './tools/variables.js';

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: 'vmware-mcp',
    version: '0.1.0',
  });

  const client = new VmrunClient(config.vmrun_path);

  registerLifecycleTools(server, client, config);
  registerGuestExecTools(server, client, config);
  registerGuestFsTools(server, client, config);
  registerSnapshotTools(server, client, config);
  registerProcessTools(server, client, config);
  registerScreenTools(server, client, config);
  registerVariableTools(server, client, config);

  return server;
}
