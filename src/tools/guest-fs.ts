import { z } from 'zod';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../types.js';
import { resolveVm } from '../config.js';
import type { VmrunClient } from '../vmrun.js';

const vmParam = z.string().optional().describe('VM name or .vmx path');

export function registerGuestFsTools(server: McpServer, client: VmrunClient, config: AppConfig): void {

  server.registerTool(
    'file_copy_to_guest',
    {
      title: 'Copy File to Guest',
      description: 'Copy a file from the host machine to the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        host_path: z.string().describe('Source file path on host'),
        guest_path: z.string().describe('Destination file path in guest'),
      }),
    },
    async ({ vm, host_path, guest_path }) => {
      const resolved = resolveVm(config, vm);
      await client.copyFileFromHostToGuest(resolved, host_path, guest_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'copied', host_path, guest_path }) }] };
    },
  );

  server.registerTool(
    'file_copy_from_guest',
    {
      title: 'Copy File from Guest',
      description: 'Copy a file from the guest VM to the host machine.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('Source file path in guest'),
        host_path: z.string().describe('Destination file path on host'),
      }),
    },
    async ({ vm, guest_path, host_path }) => {
      const resolved = resolveVm(config, vm);
      await client.copyFileFromGuestToHost(resolved, guest_path, host_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'copied', guest_path, host_path }) }] };
    },
  );

  server.registerTool(
    'guest_read_file',
    {
      title: 'Read Guest File',
      description: 'Read the contents of a file inside the guest VM. Copies to host, reads, then cleans up.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('File path in guest to read'),
      }),
    },
    async ({ vm, guest_path }) => {
      const resolved = resolveVm(config, vm);
      const localTmp = `/tmp/vmware-mcp-read-${randomUUID()}`;
      await client.copyFileFromGuestToHost(resolved, guest_path, localTmp);
      const content = await readFile(localTmp, 'utf-8');
      await unlink(localTmp).catch(() => {});
      return { content: [{ type: 'text' as const, text: content }] };
    },
  );

  server.registerTool(
    'guest_file_exists',
    {
      title: 'Check Guest File',
      description: 'Check if a file exists inside the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('File path to check in guest'),
      }),
    },
    async ({ vm, guest_path }) => {
      const resolved = resolveVm(config, vm);
      const exists = await client.fileExistsInGuest(resolved, guest_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ exists, guest_path }) }] };
    },
  );

  server.registerTool(
    'guest_directory_exists',
    {
      title: 'Check Guest Directory',
      description: 'Check if a directory exists inside the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('Directory path to check in guest'),
      }),
    },
    async ({ vm, guest_path }) => {
      const resolved = resolveVm(config, vm);
      const exists = await client.directoryExistsInGuest(resolved, guest_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ exists, guest_path }) }] };
    },
  );

  server.registerTool(
    'guest_directory_create',
    {
      title: 'Create Guest Directory',
      description: 'Create a directory inside the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('Directory path to create in guest'),
      }),
    },
    async ({ vm, guest_path }) => {
      const resolved = resolveVm(config, vm);
      await client.createDirectoryInGuest(resolved, guest_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'created', guest_path }) }] };
    },
  );

  server.registerTool(
    'guest_delete_file',
    {
      title: 'Delete Guest File',
      description: 'Delete a file inside the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('File path to delete in guest'),
      }),
    },
    async ({ vm, guest_path }) => {
      const resolved = resolveVm(config, vm);
      await client.deleteFileInGuest(resolved, guest_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'deleted', guest_path }) }] };
    },
  );

  server.registerTool(
    'guest_rename_file',
    {
      title: 'Rename Guest File',
      description: 'Rename or move a file inside the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        old_path: z.string().describe('Current file path in guest'),
        new_path: z.string().describe('New file path in guest'),
      }),
    },
    async ({ vm, old_path, new_path }) => {
      const resolved = resolveVm(config, vm);
      await client.renameFileInGuest(resolved, old_path, new_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'renamed', old_path, new_path }) }] };
    },
  );

  server.registerTool(
    'guest_list_directory',
    {
      title: 'List Guest Directory',
      description: 'List the contents of a directory inside the guest VM.',
      inputSchema: z.object({
        vm: vmParam,
        guest_path: z.string().describe('Directory path to list in guest'),
      }),
    },
    async ({ vm, guest_path }) => {
      const resolved = resolveVm(config, vm);
      const entries = await client.listDirectoryInGuest(resolved, guest_path);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ guest_path, entries }) }] };
    },
  );

  server.registerTool(
    'guest_create_tempfile',
    {
      title: 'Create Temp File in Guest',
      description: 'Create a temporary file inside the guest VM and return its path.',
      inputSchema: z.object({ vm: vmParam }),
    },
    async ({ vm }) => {
      const resolved = resolveVm(config, vm);
      const tempPath = await client.createTempFileInGuest(resolved);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ temp_path: tempPath }) }] };
    },
  );
}
