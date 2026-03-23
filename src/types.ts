export type OsType = 'windows' | 'linux' | 'macos';

export interface VmConfig {
  vmx_path: string;
  guest_user?: string;
  guest_password?: string;
  encryption_password?: string;
  os_type: OsType;
}

export interface AppConfig {
  vmrun_path: string;
  default_vm?: string;
  vms: Record<string, VmConfig>;
}

export interface ResolvedVm {
  vmxPath: string;
  guestUser?: string;
  guestPassword?: string;
  encryptionPassword?: string;
  osType: OsType;
}

export interface VmrunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface VmStatus {
  running: boolean;
  vmxPath: string;
  ip?: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  owner?: string;
}
