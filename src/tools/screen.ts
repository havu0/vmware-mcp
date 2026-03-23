import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

export function registerScreenTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'vm_capture_screen',
    {
      title: 'Capture VM Screen',
      description: 'Capture a screenshot of the VM screen. Returns the image as base64-encoded PNG, or saves to a specified host path. Requires guest credentials in config.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        host_path: z.string().optional().describe('Path on host to save the screenshot. If omitted, returns base64 image data.'),
      }),
    },
    async ({ vm, host_path }) => {
      const resolved = resolveVm(config, vm);
      const outputPath = host_path || `/tmp/vmware-mcp-screen-${Date.now()}.png`;
      await client.captureScreen(resolved, outputPath);

      if (host_path) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'captured', path: outputPath }) }] };
      }

      const imageBuffer = await readFile(outputPath);
      const { unlink } = await import('node:fs/promises');
      await unlink(outputPath).catch(() => {});
      return {
        content: [{
          type: 'image' as const,
          data: imageBuffer.toString('base64'),
          mimeType: 'image/png',
        }],
      };
    },
  );

  server.registerTool(
    'guest_type_keystrokes',
    {
      title: 'Type Keystrokes in Guest',
      description: 'Send keystrokes to the guest VM. Useful for GUI automation when combined with vm_capture_screen. Requires macOS Accessibility permission for VMware Fusion in System Settings.',
      inputSchema: z.object({
        vm: z.string().optional().describe('VM name or .vmx path'),
        keystrokes: z.string().describe('Keystroke string to type in the guest'),
      }),
    },
    async ({ vm, keystrokes }) => {
      const resolved = resolveVm(config, vm);
      await client.typeKeystrokesInGuest(resolved, keystrokes);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'typed', length: keystrokes.length }) }] };
    },
  );
}
