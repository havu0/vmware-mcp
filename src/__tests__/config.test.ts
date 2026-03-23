import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppConfig } from '../types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolveVm } from '../config.js';

const mockReadFile = vi.mocked(readFile);
const mockExistsSync = vi.mocked(existsSync);

describe('resolveVm', () => {
  const config: AppConfig = {
    vmrun_path: '/usr/bin/vmrun',
    default_vm: 'win11',
    vms: {
      win11: {
        vmx_path: '/vms/Windows11.vmx',
        guest_user: 'admin',
        guest_password: 'pass',
        os_type: 'windows',
      },
      ubuntu: {
        vmx_path: '/vms/Ubuntu.vmx',
        guest_user: 'ubuntu',
        guest_password: 'secret',
        os_type: 'linux',
      },
    },
  };

  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('resolves VM by name', () => {
    const result = resolveVm(config, 'win11');
    expect(result.vmxPath).toBe('/vms/Windows11.vmx');
    expect(result.guestUser).toBe('admin');
    expect(result.guestPassword).toBe('pass');
    expect(result.osType).toBe('windows');
  });

  it('resolves Linux VM by name', () => {
    const result = resolveVm(config, 'ubuntu');
    expect(result.vmxPath).toBe('/vms/Ubuntu.vmx');
    expect(result.osType).toBe('linux');
  });

  it('uses default_vm when no VM specified', () => {
    const result = resolveVm(config);
    expect(result.vmxPath).toBe('/vms/Windows11.vmx');
  });

  it('throws when no VM specified and no default', () => {
    const noDefault: AppConfig = { vmrun_path: '/usr/bin/vmrun', vms: {} };
    expect(() => resolveVm(noDefault)).toThrow('No VM specified and no default_vm configured');
  });

  it('resolves direct .vmx path', () => {
    const result = resolveVm(config, '/some/path/Custom.vmx');
    expect(result.vmxPath).toBe('/some/path/Custom.vmx');
    expect(result.osType).toBe('windows');
  });

  it('throws for unknown VM name', () => {
    expect(() => resolveVm(config, 'nonexistent')).toThrow('Unknown VM "nonexistent"');
  });

  it('lists available VMs in error message', () => {
    expect(() => resolveVm(config, 'nope')).toThrow('win11, ubuntu');
  });

  it('falls back to env vars for credentials', () => {
    const configNoPass: AppConfig = {
      vmrun_path: '/usr/bin/vmrun',
      vms: {
        myvm: { vmx_path: '/vms/My.vmx', os_type: 'linux' },
      },
    };
    process.env['VMWARE_MCP_MYVM_USER'] = 'envuser';
    process.env['VMWARE_MCP_MYVM_PASS'] = 'envpass';
    process.env['VMWARE_MCP_MYVM_ENCRYPTION_PASS'] = 'envenc';

    const result = resolveVm(configNoPass, 'myvm');
    expect(result.guestUser).toBe('envuser');
    expect(result.guestPassword).toBe('envpass');
    expect(result.encryptionPassword).toBe('envenc');
  });

  it('config credentials take precedence over env vars', () => {
    process.env['VMWARE_MCP_WIN11_USER'] = 'envuser';
    const result = resolveVm(config, 'win11');
    expect(result.guestUser).toBe('admin');
  });
});

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when no config file exists', async () => {
    mockExistsSync.mockReturnValue(false);
    const { loadConfig } = await import('../config.js');
    const config = await loadConfig();
    expect(config.vms).toEqual({});
    expect(config.vmrun_path).toBeTruthy();
  });

  it('loads config from file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(JSON.stringify({
      vmrun_path: '/custom/vmrun',
      default_vm: 'test',
      vms: { test: { vmx_path: '/test.vmx', os_type: 'linux' } },
    }));

    const { loadConfig } = await import('../config.js');
    const config = await loadConfig();
    expect(config.vmrun_path).toBe('/custom/vmrun');
    expect(config.default_vm).toBe('test');
    expect(config.vms['test']?.vmx_path).toBe('/test.vmx');
  });
});
