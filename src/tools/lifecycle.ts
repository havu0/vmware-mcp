import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

const vmParam = z.string().optional().describe('VM name from config, or full .vmx path. Uses default_vm if omitted');

export function registerLifecycleTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'vm_start',
    {
      title: 'Start VM',
      description: 'Start a VMware virtual machine.',
      inputSchema: z.object({
        vm: vmParam,
        gui: z.boolean().default(true).describe('Show VM window (true) or headless (false)'),
        wait_for_ip: z.boolean().default(false).describe('Wait until guest tools report an IP address after starting'),
      }),
    },
    async ({ vm, gui, wait_for_ip }) => {
      const resolved = resolveVm(config, vm);
      await client.start(resolved, gui);
      let ip: string | undefined;
      if (wait_for_ip) {
        ip = await client.getGuestIP(resolved, true);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ status: 'started', vmxPath: resolved.vmxPath, ip: ip ?? null }) }],
      };
    },
  );

  server.registerTool(
    'vm_stop',
    {
      title: 'Stop VM',
      description: 'Stop a virtual machine. "soft" attempts graceful shutdown, "hard" forces power off.',
      inputSchema: z.object({
        vm: vmParam,
        mode: z.enum(['soft', 'hard']).default('soft').describe('Shutdown mode'),
      }),
    },
    async ({ vm, mode }) => {
      const resolved = resolveVm(config, vm);
      await client.stop(resolved, mode);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'stopped', mode }) }] };
    },
  );

  server.registerTool(
    'vm_suspend',
    {
      title: 'Suspend VM',
      description: 'Suspend a virtual machine, preserving its current state to disk. Warning: encrypted VMs may not resume via vmrun after suspend — use vm_stop instead if unsure.',
      inputSchema: z.object({
        vm: vmParam,
        mode: z.enum(['soft', 'hard']).default('soft'),
      }),
    },
    async ({ vm, mode }) => {
      const resolved = resolveVm(config, vm);
      await client.suspend(resolved, mode);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'suspended', mode }) }] };
    },
  );

  server.registerTool(
    'vm_reset',
    {
      title: 'Reset VM',
      description: 'Reset (reboot) a virtual machine. "soft" runs shutdown scripts first.',
      inputSchema: z.object({
        vm: vmParam,
        mode: z.enum(['soft', 'hard']).default('soft'),
      }),
    },
    async ({ vm, mode }) => {
      const resolved = resolveVm(config, vm);
      await client.reset(resolved, mode);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'reset', mode }) }] };
    },
  );

  server.registerTool(
    'vm_pause',
    {
      title: 'Pause VM',
      description: 'Pause a running virtual machine without shutting it down.',
      inputSchema: z.object({ vm: vmParam }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      await client.pause(resolved);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'paused' }) }] };
    },
  );

  server.registerTool(
    'vm_unpause',
    {
      title: 'Unpause VM',
      description: 'Resume a paused virtual machine.',
      inputSchema: z.object({ vm: vmParam }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      await client.unpause(resolved);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'unpaused' }) }] };
    },
  );

  server.registerTool(
    'vm_status',
    {
      title: 'VM Status',
      description: 'Get the running status and IP address of a virtual machine.',
      inputSchema: z.object({ vm: vmParam }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      const runningVms = await client.list();
      const running = runningVms.some(v => v.includes(resolved.vmxPath));
      let ip: string | undefined;
      if (running) {
        try { ip = await client.getGuestIP(resolved); } catch { /* VM running but no IP yet */ }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ running, vmxPath: resolved.vmxPath, ip: ip ?? null }) }],
      };
    },
  );

  server.registerTool(
    'vm_list',
    {
      title: 'List VMs',
      description: 'List virtual machines. By default shows only running VMs. Use all=true to include configured VMs from config.',
      inputSchema: z.object({
        all: z.boolean().default(false).describe('Include all configured VMs with their running status'),
      }),
    },
    async ({ all }) => {
      const runningVms = await client.list();

      if (!all) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ count: runningVms.length, vms: runningVms }) }] };
      }

      const configuredVms = Object.entries(config.vms).map(([name, vmConfig]) => ({
        name,
        vmxPath: vmConfig.vmx_path,
        osType: vmConfig.os_type,
        running: runningVms.some(v => v.includes(vmConfig.vmx_path)),
        isDefault: config.default_vm === name,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ configured: configuredVms, running: runningVms }) }],
      };
    },
  );

  server.registerTool(
    'vm_get_ip',
    {
      title: 'Get VM IP',
      description: 'Get the IP address of a running virtual machine.',
      inputSchema: z.object({
        vm: vmParam,
        wait: z.boolean().default(false).describe('Wait/poll until IP is available'),
      }),
    },
    async ({ vm, wait }) => {
      const resolved = resolveVm(config, vm);
      const ip = await client.getGuestIP(resolved, wait);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ip }) }] };
    },
  );
}
