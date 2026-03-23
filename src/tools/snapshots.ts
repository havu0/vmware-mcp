import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

const vmParam = z.string().optional().describe('VM name or .vmx path');

export function registerSnapshotTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'vm_snapshot_create',
    {
      title: 'Create Snapshot',
      description: 'Create a snapshot of a virtual machine. Do not use "/" in snapshot names. Note: may fail on running encrypted VMs due to vmrun limitations — stop the VM first if needed.',
      inputSchema: z.object({
        vm: vmParam,
        snapshot_name: z.string().describe('Name for the new snapshot'),
      }),
    },
    async ({ vm, snapshot_name }) => {
      const resolved = resolveVm(config, vm);
      await client.createSnapshot(resolved, snapshot_name);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'created', snapshot_name }) }] };
    },
  );

  server.registerTool(
    'vm_snapshot_revert',
    {
      title: 'Revert to Snapshot',
      description: 'Revert a VM to a previous snapshot. The VM will be in suspended state after revert. Use auto_start to automatically power it back on.',
      inputSchema: z.object({
        vm: vmParam,
        snapshot_name: z.string().describe('Snapshot name or path (e.g. "Snap1/Snap2" for nested)'),
        auto_start: z.boolean().default(false).describe('Automatically start the VM after reverting'),
      }),
    },
    async ({ vm, snapshot_name, auto_start }) => {
      const resolved = resolveVm(config, vm);
      await client.revertToSnapshot(resolved, snapshot_name);
      if (auto_start) {
        await client.start(resolved, true);
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'reverted', snapshot_name, auto_started: auto_start }) }] };
    },
  );

  server.registerTool(
    'vm_snapshot_list',
    {
      title: 'List Snapshots',
      description: 'List all snapshots of a virtual machine in tree format.',
      inputSchema: z.object({ vm: vmParam }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      const output = await client.listSnapshots(resolved);
      return { content: [{ type: 'text' as const, text: output }] };
    },
  );

  server.registerTool(
    'vm_snapshot_delete',
    {
      title: 'Delete Snapshot',
      description: 'Delete a snapshot from a virtual machine.',
      inputSchema: z.object({
        vm: vmParam,
        snapshot_name: z.string().describe('Snapshot name to delete'),
        delete_children: z.boolean().default(false).describe('Also delete child snapshots'),
      }),
    },
    async ({ vm, snapshot_name, delete_children }) => {
      const resolved = resolveVm(config, vm);
      await client.deleteSnapshot(resolved, snapshot_name, delete_children);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'deleted', snapshot_name }) }] };
    },
  );
}
