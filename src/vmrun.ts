import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ResolvedVm, VmrunResult, OsType } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const VMRUN_GUEST_TIMEOUT_MS = 300_000;

const ERROR_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /Anonymous guest operations are not allowed/i,
    hint: 'Guest credentials (guest_user/guest_password) are required. Configure them in ~/.config/vmware-mcp/config.json or via VMWARE_MCP_<VM>_USER / VMWARE_MCP_<VM>_PASS environment variables.',
  },
  {
    pattern: /Authentication for encrypted virtual machine failed/i,
    hint: 'The VM is encrypted. Provide the correct encryption_password in config or via VMWARE_MCP_<VM>_ENCRYPTION_PASS. Note: snapshot operations on running encrypted VMs may fail due to vmrun limitations.',
  },
  {
    pattern: /The virtual machine is not powered on/i,
    hint: 'The VM must be running for this operation. Start it first with vm_start.',
  },
  {
    pattern: /VMware Tools are not running/i,
    hint: 'VMware Tools must be installed and running in the guest OS for guest operations. Wait for the VM to fully boot, or install VMware Tools.',
  },
  {
    pattern: /Insufficient permissions in the host operating system/i,
    hint: 'macOS accessibility permission required. Go to System Settings → Privacy & Security → Accessibility and grant permission to VMware Fusion.',
  },
  {
    pattern: /A file was not found/i,
    hint: 'The interpreter or file path was not found in the guest. For Windows guests, ensure the command is valid for cmd.exe.',
  },
  {
    pattern: /The virtual machine is already running/i,
    hint: 'The VM is already powered on. Use vm_status to check current state.',
  },
  {
    pattern: /Cannot open VM/i,
    hint: 'The .vmx file path may be incorrect, or the VM is locked by another process. Check vm_list to see running VMs.',
  },
  {
    pattern: /The snapshot already exists/i,
    hint: 'A snapshot with this name already exists. Use a different name or delete the existing one with vm_snapshot_delete.',
  },
  {
    pattern: /The specified snapshot does not exist/i,
    hint: 'Snapshot not found. Use vm_snapshot_list to see available snapshots.',
  },
  {
    pattern: /The operation is not supported/i,
    hint: 'This operation is not supported in the current VM state. Encrypted VMs may not resume from suspend via vmrun — use VMware Fusion GUI to resume, or use vm_stop/vm_start instead of vm_suspend.',
  },
];

function enhanceError(rawMessage: string): string {
  for (const { pattern, hint } of ERROR_HINTS) {
    if (pattern.test(rawMessage)) {
      return `${rawMessage}\n\nHint: ${hint}`;
    }
  }
  return rawMessage;
}

export class VmrunClient {
  constructor(private readonly vmrunPath: string) {}

  async execute(args: string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<VmrunResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.vmrunPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          reject(new Error(`vmrun timed out after ${timeoutMs}ms: ${args.join(' ')}`));
          return;
        }
        const result = { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode: code ?? 1 };
        if (result.exitCode !== 0) {
          const msg = result.stderr || result.stdout || `vmrun exited with code ${result.exitCode}`;
          reject(new Error(enhanceError(msg)));
          return;
        }
        resolve(result);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn vmrun: ${err.message}`));
      });
    });
  }

  private buildAuthFlags(vm: ResolvedVm): string[] {
    const flags: string[] = ['-T', 'fusion'];
    if (vm.encryptionPassword) {
      flags.push('-vp', vm.encryptionPassword);
    }
    if (vm.guestUser !== undefined) {
      flags.push('-gu', vm.guestUser);
    }
    if (vm.guestPassword !== undefined) {
      flags.push('-gp', vm.guestPassword);
    }
    return flags;
  }

  private buildGuestAuthFlags(vm: ResolvedVm): string[] {
    if (vm.guestUser === undefined) {
      throw new Error('Guest credentials (guest_user/guest_password) required for guest operations');
    }
    return this.buildAuthFlags(vm);
  }

  async start(vm: ResolvedVm, gui: boolean = true): Promise<void> {
    const mode = gui ? 'gui' : 'nogui';
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'start', vm.vmxPath, mode]);
  }

  async stop(vm: ResolvedVm, mode: 'soft' | 'hard' = 'soft'): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'stop', vm.vmxPath, mode]);
  }

  async suspend(vm: ResolvedVm, mode: 'soft' | 'hard' = 'soft'): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'suspend', vm.vmxPath, mode]);
  }

  async reset(vm: ResolvedVm, mode: 'soft' | 'hard' = 'soft'): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'reset', vm.vmxPath, mode]);
  }

  async pause(vm: ResolvedVm): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'pause', vm.vmxPath]);
  }

  async unpause(vm: ResolvedVm): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'unpause', vm.vmxPath]);
  }

  async list(): Promise<string[]> {
    const result = await this.execute(['list']);
    const lines = result.stdout.split('\n');
    return lines.slice(1).filter(line => line.trim().length > 0);
  }

  async getGuestIP(vm: ResolvedVm, wait: boolean = false): Promise<string> {
    const flags = this.buildAuthFlags(vm);
    const args = [...flags, 'getGuestIPAddress', vm.vmxPath];
    if (wait) args.push('-wait');
    const timeout = wait ? VMRUN_GUEST_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const result = await this.execute(args, timeout);
    return result.stdout.trim();
  }

  async checkToolsState(vm: ResolvedVm): Promise<string> {
    const flags = this.buildAuthFlags(vm);
    const result = await this.execute([...flags, 'checkToolsState', vm.vmxPath]);
    return result.stdout.trim();
  }

  async runScriptInGuest(
    vm: ResolvedVm,
    interpreter: string,
    script: string,
    noWait: boolean = false,
    timeoutMs: number = VMRUN_GUEST_TIMEOUT_MS,
  ): Promise<VmrunResult> {
    const flags = this.buildGuestAuthFlags(vm);
    const args = [...flags, 'runScriptInGuest', vm.vmxPath];
    if (noWait) args.push('-noWait');
    args.push(interpreter, script);
    return this.execute(args, timeoutMs);
  }

  async runProgramInGuest(
    vm: ResolvedVm,
    programPath: string,
    programArgs: string[] = [],
    noWait: boolean = false,
    timeoutMs: number = VMRUN_GUEST_TIMEOUT_MS,
  ): Promise<VmrunResult> {
    const flags = this.buildGuestAuthFlags(vm);
    const args = [...flags, 'runProgramInGuest', vm.vmxPath];
    if (noWait) args.push('-noWait');
    args.push(programPath, ...programArgs);
    return this.execute(args, timeoutMs);
  }

  private getInterpreter(osType: OsType): string {
    return osType === 'windows' ? '' : '/bin/bash';
  }

  private wrapCommandForRedirect(osType: OsType, command: string, outputPath: string): string {
    if (osType === 'windows') {
      return `cmd /c ${command} > "${outputPath}" 2>&1`;
    }
    return `${command} > '${outputPath}' 2>&1`;
  }

  async runCommandWithOutput(
    vm: ResolvedVm,
    command: string,
    timeoutMs: number = VMRUN_GUEST_TIMEOUT_MS,
  ): Promise<string> {
    const remoteTmp = await this.createTempFileInGuest(vm);
    const interpreter = this.getInterpreter(vm.osType);
    const wrappedCmd = this.wrapCommandForRedirect(vm.osType, command, remoteTmp);

    await this.runScriptInGuest(vm, interpreter, wrappedCmd, false, timeoutMs);

    const localTmp = `/tmp/vmware-mcp-${randomUUID()}.txt`;
    await this.copyFileFromGuestToHost(vm, remoteTmp, localTmp);
    const output = await readFile(localTmp, 'utf-8');

    await this.deleteFileInGuest(vm, remoteTmp).catch(() => {});
    await unlink(localTmp).catch(() => {});

    return output;
  }

  async copyFileFromHostToGuest(vm: ResolvedVm, hostPath: string, guestPath: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'CopyFileFromHostToGuest', vm.vmxPath, hostPath, guestPath]);
  }

  async copyFileFromGuestToHost(vm: ResolvedVm, guestPath: string, hostPath: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'CopyFileFromGuestToHost', vm.vmxPath, guestPath, hostPath]);
  }

  async fileExistsInGuest(vm: ResolvedVm, guestPath: string): Promise<boolean> {
    const flags = this.buildGuestAuthFlags(vm);
    try {
      await this.execute([...flags, 'fileExistsInGuest', vm.vmxPath, guestPath]);
      return true;
    } catch {
      return false;
    }
  }

  async directoryExistsInGuest(vm: ResolvedVm, guestPath: string): Promise<boolean> {
    const flags = this.buildGuestAuthFlags(vm);
    try {
      await this.execute([...flags, 'directoryExistsInGuest', vm.vmxPath, guestPath]);
      return true;
    } catch {
      return false;
    }
  }

  async createDirectoryInGuest(vm: ResolvedVm, guestPath: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'createDirectoryInGuest', vm.vmxPath, guestPath]);
  }

  async deleteFileInGuest(vm: ResolvedVm, guestPath: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'deleteFileInGuest', vm.vmxPath, guestPath]);
  }

  async renameFileInGuest(vm: ResolvedVm, oldPath: string, newPath: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'renameFileInGuest', vm.vmxPath, oldPath, newPath]);
  }

  async listDirectoryInGuest(vm: ResolvedVm, guestPath: string): Promise<string[]> {
    const flags = this.buildGuestAuthFlags(vm);
    const result = await this.execute([...flags, 'listDirectoryInGuest', vm.vmxPath, guestPath]);
    return result.stdout.split('\n').filter(line => line.trim().length > 0);
  }

  async createTempFileInGuest(vm: ResolvedVm): Promise<string> {
    const flags = this.buildGuestAuthFlags(vm);
    const result = await this.execute([...flags, 'CreateTempfileInGuest', vm.vmxPath]);
    return result.stdout.trim();
  }

  async listProcessesInGuest(vm: ResolvedVm): Promise<string> {
    const flags = this.buildGuestAuthFlags(vm);
    const result = await this.execute([...flags, 'listProcessesInGuest', vm.vmxPath]);
    return result.stdout;
  }

  async killProcessInGuest(vm: ResolvedVm, pid: number): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'killProcessInGuest', vm.vmxPath, pid.toString()]);
  }

  async createSnapshot(vm: ResolvedVm, snapshotName: string): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'snapshot', vm.vmxPath, snapshotName]);
  }

  async revertToSnapshot(vm: ResolvedVm, snapshotName: string): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'revertToSnapshot', vm.vmxPath, snapshotName]);
  }

  async listSnapshots(vm: ResolvedVm): Promise<string> {
    const flags = this.buildAuthFlags(vm);
    const result = await this.execute([...flags, 'listSnapshots', vm.vmxPath, 'showTree']);
    return result.stdout;
  }

  async deleteSnapshot(vm: ResolvedVm, snapshotName: string, andDeleteChildren: boolean = false): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    const args = [...flags, 'deleteSnapshot', vm.vmxPath, snapshotName];
    if (andDeleteChildren) args.push('andDeleteChildren');
    await this.execute(args);
  }

  async captureScreen(vm: ResolvedVm, hostOutputPath: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'captureScreen', vm.vmxPath, hostOutputPath]);
  }

  async typeKeystrokesInGuest(vm: ResolvedVm, keystrokes: string): Promise<void> {
    const flags = this.buildGuestAuthFlags(vm);
    await this.execute([...flags, 'typeKeystrokesInGuest', vm.vmxPath, keystrokes]);
  }

  async readVariable(vm: ResolvedVm, varType: 'runtimeConfig' | 'guestEnv' | 'guestVar', name: string): Promise<string> {
    const flags = this.buildAuthFlags(vm);
    const result = await this.execute([...flags, 'readVariable', vm.vmxPath, varType, name]);
    return result.stdout.trim();
  }

  async writeVariable(vm: ResolvedVm, varType: 'runtimeConfig' | 'guestEnv' | 'guestVar', name: string, value: string): Promise<void> {
    const flags = this.buildAuthFlags(vm);
    await this.execute([...flags, 'writeVariable', vm.vmxPath, varType, name, value]);
  }
}
