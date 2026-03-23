import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig, ResolvedVm } from './types.js';

const DEFAULT_VMRUN_PATHS: Record<string, string> = {
  darwin: '/Applications/VMware Fusion.app/Contents/Public/vmrun',
  win32: 'C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe',
  linux: '/usr/bin/vmrun',
};

const KEYCHAIN_SERVICE = 'vmware-mcp';

function getDefaultConfigPath(): string {
  return process.env['VMWARE_MCP_CONFIG']
    || join(homedir(), '.config', 'vmware-mcp', 'config.json');
}

function readKeychain(account: string): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
    ).toString().trim();
  } catch {
    return undefined;
  }
}

export function parseCliCredentials(argv: string[]): Map<string, { user?: string; pass?: string; encryptionPass?: string }> {
  const creds = new Map<string, { user?: string; pass?: string; encryptionPass?: string }>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (!next) continue;

    const colonIdx = next.indexOf(':');
    if (colonIdx <= 0) continue;
    const vmName = next.substring(0, colonIdx);
    const value = next.substring(colonIdx + 1);

    const existing = creds.get(vmName) ?? {};

    if (arg === '--guest-user') {
      existing.user = value;
      creds.set(vmName, existing);
      i++;
    } else if (arg === '--guest-pass') {
      existing.pass = value;
      creds.set(vmName, existing);
      i++;
    } else if (arg === '--encryption-pass') {
      existing.encryptionPass = value;
      creds.set(vmName, existing);
      i++;
    }
  }

  return creds;
}

let cliCredentials: Map<string, { user?: string; pass?: string; encryptionPass?: string }> | undefined;

export function initCliCredentials(argv: string[]): void {
  cliCredentials = parseCliCredentials(argv);
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getDefaultConfigPath();

  if (existsSync(configPath)) {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      vmrun_path: parsed.vmrun_path || DEFAULT_VMRUN_PATHS[process.platform] || 'vmrun',
      default_vm: parsed.default_vm,
      vms: parsed.vms || {},
    };
  }

  return {
    vmrun_path: DEFAULT_VMRUN_PATHS[process.platform] || 'vmrun',
    vms: {},
  };
}

function resolveCredential(
  configValue: string | undefined,
  cliValue: string | undefined,
  envValue: string | undefined,
  keychainAccount: string,
): string | undefined {
  return configValue ?? cliValue ?? envValue ?? readKeychain(keychainAccount);
}

export function resolveVm(config: AppConfig, vm?: string): ResolvedVm {
  if (!vm) {
    if (!config.default_vm) {
      throw new Error('No VM specified and no default_vm configured');
    }
    vm = config.default_vm;
  }

  if (vm.endsWith('.vmx')) {
    return { vmxPath: vm, osType: 'windows' };
  }

  const vmConfig = config.vms[vm];
  if (!vmConfig) {
    throw new Error(
      `Unknown VM "${vm}". Available: ${Object.keys(config.vms).join(', ') || '(none)'}`
    );
  }

  const cli = cliCredentials?.get(vm);
  const upper = vm.toUpperCase();

  return {
    vmxPath: vmConfig.vmx_path,
    guestUser: resolveCredential(vmConfig.guest_user, cli?.user, process.env[`VMWARE_MCP_${upper}_USER`], `${vm}/guest_user`),
    guestPassword: resolveCredential(vmConfig.guest_password, cli?.pass, process.env[`VMWARE_MCP_${upper}_PASS`], `${vm}/guest_password`),
    encryptionPassword: resolveCredential(vmConfig.encryption_password, cli?.encryptionPass, process.env[`VMWARE_MCP_${upper}_ENCRYPTION_PASS`], `${vm}/encryption_password`),
    osType: vmConfig.os_type,
  };
}
