import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

export function registerGuestExecTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'guest_run_command',
    {
      title: 'Run Command in Guest',
      description: 'Execute a shell command inside the guest VM and return stdout. Uses the appropriate shell based on guest OS type (cmd/bash). Requires guest credentials in config and VMware Tools running in guest.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        command: z.string().describe('Shell command to execute'),
        shell: z.enum(['auto', 'cmd', 'powershell', 'bash', 'sh']).default('auto').describe('Shell to use. "auto" picks based on os_type'),
        timeout_seconds: z.number().default(60).describe('Max execution time in seconds (vmrun hard limit is 300s)'),
      }),
    },
    async ({ vm, command, shell, timeout_seconds }) => {
      const resolved = resolveVm(config, vm);
      const timeoutMs = Math.min(timeout_seconds * 1000, 300_000);

      if (shell === 'auto') {
        const output = await client.runCommandWithOutput(resolved, command, timeoutMs);
        return { content: [{ type: 'text' as const, text: output }] };
      }

      const interpreterMap: Record<string, string> = {
        cmd: 'cmd',
        powershell: 'powershell',
        bash: '/bin/bash',
        sh: '/bin/sh',
      };

      const remoteTmp = await client.createTempFileInGuest(resolved);
      const interpreter = interpreterMap[shell];
      const wrapCmd = resolved.osType === 'windows'
        ? `${command} > "${remoteTmp}" 2>&1`
        : `${command} > '${remoteTmp}' 2>&1`;

      await client.runScriptInGuest(resolved, interpreter, wrapCmd, false, timeoutMs);

      const { readFile, unlink } = await import('node:fs/promises');
      const { randomUUID } = await import('node:crypto');
      const localTmp = `/tmp/vmware-mcp-${randomUUID()}.txt`;
      await client.copyFileFromGuestToHost(resolved, remoteTmp, localTmp);
      const output = await readFile(localTmp, 'utf-8');
      await client.deleteFileInGuest(resolved, remoteTmp).catch(() => {});
      await unlink(localTmp).catch(() => {});

      return { content: [{ type: 'text' as const, text: output }] };
    },
  );

  server.registerTool(
    'guest_run_program',
    {
      title: 'Run Program in Guest',
      description: 'Launch a program inside the guest VM. Can run asynchronously with no_wait. Requires full path to the program.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        program: z.string().describe('Full path to the program in the guest'),
        args: z.array(z.string()).default([]).describe('Program arguments'),
        no_wait: z.boolean().default(false).describe('Return immediately without waiting for the program to finish'),
        timeout_seconds: z.number().default(60),
      }),
    },
    async ({ vm, program, args, no_wait, timeout_seconds }) => {
      const resolved = resolveVm(config, vm);
      const timeoutMs = Math.min(timeout_seconds * 1000, 300_000);
      await client.runProgramInGuest(resolved, program, args, no_wait, timeoutMs);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: no_wait ? 'launched' : 'completed', program }) }] };
    },
  );
}
