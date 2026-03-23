import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppConfig } from '../types.js';
import { VmrunClient } from '../vmrun.js';
import { createServer } from '../server.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const mockSpawn = vi.mocked(spawn);

function setupSpawn(stdout = '', exitCode = 0) {
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    queueMicrotask(() => {
      proc.stdout.emit('data', Buffer.from(stdout));
      proc.stderr.emit('data', Buffer.from(''));
      proc.emit('close', exitCode);
    });
    return proc;
  });
}

const testConfig: AppConfig = {
  vmrun_path: '/usr/bin/vmrun',
  default_vm: 'testvm',
  vms: {
    testvm: {
      vmx_path: '/vms/Test.vmx',
      guest_user: 'user',
      guest_password: 'pass',
      os_type: 'linux',
    },
  },
};

const EXPECTED_TOOLS = [
  'vm_start', 'vm_stop', 'vm_suspend', 'vm_reset', 'vm_pause', 'vm_unpause',
  'vm_status', 'vm_list', 'vm_get_ip',
  'guest_run_command', 'guest_run_program',
  'file_copy_to_guest', 'file_copy_from_guest', 'guest_read_file',
  'guest_file_exists', 'guest_directory_exists', 'guest_directory_create',
  'guest_delete_file', 'guest_rename_file', 'guest_list_directory', 'guest_create_tempfile',
  'vm_snapshot_create', 'vm_snapshot_revert', 'vm_snapshot_list', 'vm_snapshot_delete',
  'guest_process_list', 'guest_kill_process',
  'vm_capture_screen', 'guest_type_keystrokes',
  'vm_read_variable', 'vm_write_variable', 'vm_check_tools',
];

describe('MCP Integration', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = createServer(testConfig);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('registers all 32 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(EXPECTED_TOOLS.length);
  });

  it('registers every expected tool by name', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it('every tool has a description', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it('every tool has an input schema', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  describe('tool invocation', () => {
    it('vm_list returns running VMs', async () => {
      setupSpawn('Total running VMs: 1\n/vms/Test.vmx');
      const result = await client.callTool({ name: 'vm_list', arguments: {} });
      const text = (result.content as any)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.count).toBe(1);
      expect(parsed.vms).toContain('/vms/Test.vmx');
    });

    it('vm_start uses default VM', async () => {
      setupSpawn();
      const result = await client.callTool({
        name: 'vm_start',
        arguments: { gui: false, wait_for_ip: false },
      });
      const text = (result.content as any)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.status).toBe('started');
      expect(parsed.vmxPath).toBe('/vms/Test.vmx');
    });

    it('vm_stop with soft mode', async () => {
      setupSpawn();
      const result = await client.callTool({
        name: 'vm_stop',
        arguments: { mode: 'soft' },
      });
      const text = (result.content as any)[0].text;
      expect(JSON.parse(text).status).toBe('stopped');
    });

    it('vm_status returns running state', async () => {
      setupSpawn('Total running VMs: 1\n/vms/Test.vmx');
      const result = await client.callTool({ name: 'vm_status', arguments: {} });
      const text = (result.content as any)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.running).toBe(true);
    });

    it('vm_check_tools returns state', async () => {
      setupSpawn('running\n');
      const result = await client.callTool({ name: 'vm_check_tools', arguments: {} });
      const text = (result.content as any)[0].text;
      expect(JSON.parse(text).tools_state).toBe('running');
    });

    it('vm_snapshot_create passes name', async () => {
      setupSpawn();
      const result = await client.callTool({
        name: 'vm_snapshot_create',
        arguments: { snapshot_name: 'test-snap' },
      });
      const text = (result.content as any)[0].text;
      expect(JSON.parse(text).status).toBe('created');

      const args = mockSpawn.mock.calls.at(-1)?.[1] as string[];
      expect(args).toContain('snapshot');
      expect(args).toContain('test-snap');
    });

    it('vm_snapshot_list returns output', async () => {
      setupSpawn('Total snapshots: 2\nSnap1\n  Snap2');
      const result = await client.callTool({ name: 'vm_snapshot_list', arguments: {} });
      const text = (result.content as any)[0].text;
      expect(text).toContain('Snap1');
    });

    it('guest_type_keystrokes sends text', async () => {
      setupSpawn();
      const result = await client.callTool({
        name: 'guest_type_keystrokes',
        arguments: { keystrokes: 'hello' },
      });
      const text = (result.content as any)[0].text;
      expect(JSON.parse(text).status).toBe('typed');
    });

    it('guest_kill_process passes pid', async () => {
      setupSpawn();
      const result = await client.callTool({
        name: 'guest_kill_process',
        arguments: { pid: 42 },
      });
      const text = (result.content as any)[0].text;
      expect(JSON.parse(text).pid).toBe(42);
    });
  });
});
