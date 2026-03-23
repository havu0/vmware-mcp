import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

export function registerProcessTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'guest_process_list',
    {
      title: 'List Guest Processes',
      description: 'List all running processes inside the guest VM. Requires guest credentials.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
      }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      const output = await client.listProcessesInGuest(resolved);
      return { content: [{ type: 'text' as const, text: output }] };
    },
  );

  server.registerTool(
    'guest_kill_process',
    {
      title: 'Kill Guest Process',
      description: 'Kill a process inside the guest VM by its PID.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        pid: z.number().describe('Process ID to kill (from guest_process_list)'),
      }),
    },
    async ({ vm, pid }) => {
      const resolved = resolveVm(config, vm);
      await client.killProcessInGuest(resolved, pid);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'killed', pid }) }] };
    },
  );
}
