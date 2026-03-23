import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig, ResolvedVm } from './types.js';

const DEFAULT_VMRUN_PATHS: Record<string, string> = {
  darwin: '/Applications/VMware Fusion.app/Contents/Public/vmrun',
  win32: 'C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe',
  linux: '/usr/bin/vmrun',
};

function getDefaultConfigPath(): string {
  const configDir = process.env['VMWARE_MCP_CONFIG']
    || join(homedir(), '.config', 'vmware-mcp', 'config.json');
  return configDir;
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

  return {
    vmxPath: vmConfig.vmx_path,
    guestUser: vmConfig.guest_user ?? process.env[`VMWARE_MCP_${vm.toUpperCase()}_USER`],
    guestPassword: vmConfig.guest_password ?? process.env[`VMWARE_MCP_${vm.toUpperCase()}_PASS`],
    encryptionPassword: vmConfig.encryption_password ?? process.env[`VMWARE_MCP_${vm.toUpperCase()}_ENCRYPTION_PASS`],
    osType: vmConfig.os_type,
  };
}
