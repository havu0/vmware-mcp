import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VmrunClient } from '../vmrun.js';
import type { ResolvedVm } from '../types.js';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

function createMockSpawn(stdout = '', stderr = '', exitCode = 0) {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;

  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  (proc as any).stdout = stdoutEmitter;
  (proc as any).stderr = stderrEmitter;
  (proc as any).stdin = { write: vi.fn(), end: vi.fn() };

  const spawnFn = vi.fn().mockReturnValue(proc);

  queueMicrotask(() => {
    stdoutEmitter.emit('data', Buffer.from(stdout));
    stderrEmitter.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  });

  return { spawnFn, proc };
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

const VMRUN_PATH = '/usr/bin/vmrun';

const windowsVm: ResolvedVm = {
  vmxPath: '/vms/Windows11.vmx',
  guestUser: 'admin',
  guestPassword: 'pass123',
  osType: 'windows',
};

const linuxVm: ResolvedVm = {
  vmxPath: '/vms/Ubuntu.vmx',
  guestUser: 'ubuntu',
  guestPassword: 'secret',
  osType: 'linux',
};

const encryptedVm: ResolvedVm = {
  vmxPath: '/vms/Encrypted.vmx',
  guestUser: 'user',
  guestPassword: 'pass',
  encryptionPassword: 'enc123',
  osType: 'windows',
};

const bareVm: ResolvedVm = {
  vmxPath: '/vms/Bare.vmx',
  osType: 'linux',
};

function setupSpawn(stdout = '', stderr = '', exitCode = 0) {
  const { spawnFn, proc } = createMockSpawn(stdout, stderr, exitCode);
  mockSpawn.mockImplementation(spawnFn as any);
  return proc;
}

describe('VmrunClient', () => {
  let client: VmrunClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new VmrunClient(VMRUN_PATH);
  });

  describe('execute', () => {
    it('passes args to spawn and returns stdout/stderr', async () => {
      setupSpawn('output text', '', 0);
      const result = await client.execute(['list']);
      expect(mockSpawn).toHaveBeenCalledWith(VMRUN_PATH, ['list'], expect.any(Object));
      expect(result.stdout).toBe('output text');
      expect(result.exitCode).toBe(0);
    });

    it('rejects on non-zero exit code', async () => {
      setupSpawn('', 'Error: VM not found', 1);
      await expect(client.execute(['start', '/bad.vmx'])).rejects.toThrow('VM not found');
    });

    it('rejects on spawn error', async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      mockSpawn.mockReturnValue(proc);
      queueMicrotask(() => proc.emit('error', new Error('ENOENT')));
      await expect(client.execute(['list'])).rejects.toThrow('Failed to spawn vmrun');
    });

    it('rejects on timeout', async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.kill = vi.fn(() => {
        queueMicrotask(() => proc.emit('close', null));
      });
      mockSpawn.mockReturnValue(proc);

      await expect(client.execute(['list'], 50)).rejects.toThrow('timed out');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('auth flags', () => {
    it('includes -T fusion for all commands', async () => {
      setupSpawn();
      await client.start(windowsVm);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[0]).toBe('-T');
      expect(args[1]).toBe('fusion');
    });

    it('includes -gu/-gp when guest credentials present', async () => {
      setupSpawn();
      await client.start(windowsVm);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-gu');
      expect(args).toContain('admin');
      expect(args).toContain('-gp');
      expect(args).toContain('pass123');
    });

    it('includes -vp for encrypted VMs', async () => {
      setupSpawn();
      await client.start(encryptedVm);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-vp');
      expect(args).toContain('enc123');
    });

    it('omits -gu/-gp when no guest credentials', async () => {
      setupSpawn();
      await client.start(bareVm);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('-gu');
      expect(args).not.toContain('-gp');
    });

    it('places auth flags before command', async () => {
      setupSpawn();
      await client.start(encryptedVm);
      const args = mockSpawn.mock.calls[0][1] as string[];
      const vpIdx = args.indexOf('-vp');
      const startIdx = args.indexOf('start');
      expect(vpIdx).toBeLessThan(startIdx);
    });
  });

  describe('lifecycle commands', () => {
    it('start: passes gui mode', async () => {
      setupSpawn();
      await client.start(windowsVm, true);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('start');
      expect(args).toContain('gui');
      expect(args).toContain(windowsVm.vmxPath);
    });

    it('start: respects gui=true for encrypted VMs', async () => {
      setupSpawn();
      await client.start(encryptedVm, true);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('gui');
    });

    it('start: passes nogui when gui=false', async () => {
      setupSpawn();
      await client.start(windowsVm, false);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('nogui');
    });

    it('stop: passes mode soft/hard', async () => {
      setupSpawn();
      await client.stop(windowsVm, 'hard');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('stop');
      expect(args).toContain('hard');
    });

    it('suspend: passes mode', async () => {
      setupSpawn();
      await client.suspend(linuxVm, 'soft');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('suspend');
      expect(args).toContain('soft');
    });

    it('reset: passes mode', async () => {
      setupSpawn();
      await client.reset(windowsVm, 'hard');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('reset');
      expect(args).toContain('hard');
    });

    it('pause/unpause', async () => {
      setupSpawn();
      await client.pause(windowsVm);
      expect((mockSpawn.mock.calls[0][1] as string[])).toContain('pause');

      setupSpawn();
      await client.unpause(windowsVm);
      expect((mockSpawn.mock.calls[1][1] as string[])).toContain('unpause');
    });
  });

  describe('list', () => {
    it('parses vmrun list output into vmx paths', async () => {
      setupSpawn('Total running VMs: 2\n/vms/A.vmx\n/vms/B.vmx');
      const result = await client.list();
      expect(result).toEqual(['/vms/A.vmx', '/vms/B.vmx']);
    });

    it('returns empty array when no VMs running', async () => {
      setupSpawn('Total running VMs: 0\n');
      const result = await client.list();
      expect(result).toEqual([]);
    });
  });

  describe('getGuestIP', () => {
    it('returns trimmed IP', async () => {
      setupSpawn('192.168.1.100\n');
      const ip = await client.getGuestIP(windowsVm);
      expect(ip).toBe('192.168.1.100');
    });

    it('passes -wait flag when wait=true', async () => {
      setupSpawn('10.0.0.1');
      await client.getGuestIP(windowsVm, true);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-wait');
    });

    it('omits -wait flag when wait=false', async () => {
      setupSpawn('10.0.0.1');
      await client.getGuestIP(windowsVm, false);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('-wait');
    });
  });

  describe('guest operations', () => {
    it('runScriptInGuest: passes interpreter and script text', async () => {
      setupSpawn();
      await client.runScriptInGuest(windowsVm, '/bin/bash', 'echo hello');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('runScriptInGuest');
      expect(args).toContain('/bin/bash');
      expect(args).toContain('echo hello');
    });

    it('runScriptInGuest: includes -noWait when set', async () => {
      setupSpawn();
      await client.runScriptInGuest(windowsVm, 'cmd', 'dir', true);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('-noWait');
    });

    it('runProgramInGuest: passes program path and args', async () => {
      setupSpawn();
      await client.runProgramInGuest(windowsVm, 'C:\\app.exe', ['-v', '--flag']);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('runProgramInGuest');
      expect(args).toContain('C:\\app.exe');
      expect(args).toContain('-v');
      expect(args).toContain('--flag');
    });

    it('throws when guest credentials missing', async () => {
      await expect(client.runScriptInGuest(bareVm, '/bin/bash', 'echo'))
        .rejects.toThrow('Guest credentials');
    });
  });

  describe('file operations', () => {
    it('copyFileFromHostToGuest: correct args', async () => {
      setupSpawn();
      await client.copyFileFromHostToGuest(windowsVm, '/local/file.txt', 'C:\\remote\\file.txt');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('CopyFileFromHostToGuest');
      expect(args).toContain('/local/file.txt');
      expect(args).toContain('C:\\remote\\file.txt');
    });

    it('copyFileFromGuestToHost: correct args', async () => {
      setupSpawn();
      await client.copyFileFromGuestToHost(windowsVm, 'C:\\remote\\f.txt', '/local/f.txt');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('CopyFileFromGuestToHost');
    });

    it('fileExistsInGuest: returns true on success', async () => {
      setupSpawn();
      const exists = await client.fileExistsInGuest(windowsVm, 'C:\\file.txt');
      expect(exists).toBe(true);
    });

    it('fileExistsInGuest: returns false on error', async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      mockSpawn.mockReturnValue(proc);
      queueMicrotask(() => proc.emit('error', new Error('not found')));
      const exists = await client.fileExistsInGuest(windowsVm, 'C:\\nope.txt');
      expect(exists).toBe(false);
    });

    it('createDirectoryInGuest: correct args', async () => {
      setupSpawn();
      await client.createDirectoryInGuest(windowsVm, 'C:\\newdir');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('createDirectoryInGuest');
      expect(args).toContain('C:\\newdir');
    });

    it('deleteFileInGuest: correct args', async () => {
      setupSpawn();
      await client.deleteFileInGuest(windowsVm, 'C:\\del.txt');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('deleteFileInGuest');
    });

    it('renameFileInGuest: passes old and new path', async () => {
      setupSpawn();
      await client.renameFileInGuest(windowsVm, 'C:\\old.txt', 'C:\\new.txt');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('renameFileInGuest');
      expect(args).toContain('C:\\old.txt');
      expect(args).toContain('C:\\new.txt');
    });

    it('listDirectoryInGuest: parses output lines', async () => {
      setupSpawn('file1.txt\nfile2.txt\nsubdir\n');
      const entries = await client.listDirectoryInGuest(windowsVm, 'C:\\dir');
      expect(entries).toEqual(['file1.txt', 'file2.txt', 'subdir']);
    });

    it('createTempFileInGuest: returns trimmed path', async () => {
      setupSpawn('C:\\Users\\admin\\AppData\\Local\\Temp\\vmw1234.tmp\n');
      const tmpPath = await client.createTempFileInGuest(windowsVm);
      expect(tmpPath).toBe('C:\\Users\\admin\\AppData\\Local\\Temp\\vmw1234.tmp');
    });
  });

  describe('snapshots', () => {
    it('createSnapshot: passes name', async () => {
      setupSpawn();
      await client.createSnapshot(windowsVm, 'my-snap');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('snapshot');
      expect(args).toContain('my-snap');
    });

    it('revertToSnapshot: passes name', async () => {
      setupSpawn();
      await client.revertToSnapshot(windowsVm, 'my-snap');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('revertToSnapshot');
      expect(args).toContain('my-snap');
    });

    it('listSnapshots: passes showTree', async () => {
      setupSpawn('Total snapshots: 2\nSnap1\n  Snap2');
      const output = await client.listSnapshots(windowsVm);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('showTree');
      expect(output).toContain('Snap1');
    });

    it('deleteSnapshot: passes andDeleteChildren flag', async () => {
      setupSpawn();
      await client.deleteSnapshot(windowsVm, 'old-snap', true);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('deleteSnapshot');
      expect(args).toContain('andDeleteChildren');
    });

    it('deleteSnapshot: omits andDeleteChildren when false', async () => {
      setupSpawn();
      await client.deleteSnapshot(windowsVm, 'old-snap', false);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).not.toContain('andDeleteChildren');
    });
  });

  describe('screen and keystrokes', () => {
    it('captureScreen: passes output path', async () => {
      setupSpawn();
      await client.captureScreen(windowsVm, '/tmp/screen.png');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('captureScreen');
      expect(args).toContain('/tmp/screen.png');
    });

    it('typeKeystrokesInGuest: passes keystrokes', async () => {
      setupSpawn();
      await client.typeKeystrokesInGuest(windowsVm, 'hello world');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('typeKeystrokesInGuest');
      expect(args).toContain('hello world');
    });
  });

  describe('variables', () => {
    it('readVariable: passes varType and name', async () => {
      setupSpawn('some-value\n');
      const val = await client.readVariable(windowsVm, 'guestVar', 'myVar');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('readVariable');
      expect(args).toContain('guestVar');
      expect(args).toContain('myVar');
      expect(val).toBe('some-value');
    });

    it('writeVariable: passes varType, name, and value', async () => {
      setupSpawn();
      await client.writeVariable(windowsVm, 'runtimeConfig', 'key', 'val');
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('writeVariable');
      expect(args).toContain('runtimeConfig');
      expect(args).toContain('key');
      expect(args).toContain('val');
    });
  });

  describe('checkToolsState', () => {
    it('returns trimmed state string', async () => {
      setupSpawn('running\n');
      const state = await client.checkToolsState(windowsVm);
      expect(state).toBe('running');
    });
  });

  describe('process management', () => {
    it('listProcessesInGuest: returns raw output', async () => {
      setupSpawn('Process list:\npid=1234, owner=admin, cmd=notepad.exe');
      const output = await client.listProcessesInGuest(windowsVm);
      expect(output).toContain('pid=1234');
    });

    it('killProcessInGuest: passes pid as string', async () => {
      setupSpawn();
      await client.killProcessInGuest(windowsVm, 1234);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args).toContain('killProcessInGuest');
      expect(args).toContain('1234');
    });
  });
});
