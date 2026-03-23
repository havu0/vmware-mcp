import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

const varTypeSchema = z.enum(['runtimeConfig', 'guestEnv', 'guestVar']).describe(
  'runtimeConfig: stored in .vmx file. guestVar: non-persistent runtime value. guestEnv: guest environment variable'
);

export function registerVariableTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'vm_read_variable',
    {
      title: 'Read VM Variable',
      description: 'Read a variable from the VM state.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        var_type: varTypeSchema,
        name: z.string().describe('Variable name to read'),
      }),
    },
    async ({ vm, var_type, name }) => {
      const resolved = resolveVm(config, vm);
      const value = await client.readVariable(resolved, var_type, name);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ name, value, var_type }) }] };
    },
  );

  server.registerTool(
    'vm_write_variable',
    {
      title: 'Write VM Variable',
      description: 'Write a variable to the VM state.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        var_type: varTypeSchema,
        name: z.string().describe('Variable name to write'),
        value: z.string().describe('Value to set'),
      }),
    },
    async ({ vm, var_type, name, value }) => {
      const resolved = resolveVm(config, vm);
      await client.writeVariable(resolved, var_type, name, value);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'written', name, value, var_type }) }] };
    },
  );

  server.registerTool(
    'vm_check_tools',
    {
      title: 'Check VMware Tools',
      description: 'Check the VMware Tools state in the guest. Returns "unknown", "installed", or "running".',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
      }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      const state = await client.checkToolsState(resolved);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ tools_state: state }) }] };
    },
  );
}
