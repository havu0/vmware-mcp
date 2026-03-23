# vmware-mcp

[![npm version](https://img.shields.io/npm/v/vmware-mcp.svg)](https://www.npmjs.com/package/vmware-mcp)
[![license](https://img.shields.io/npm/l/vmware-mcp.svg)](https://github.com/havu0/vmware-mcp/blob/main/LICENSE)

MCP server for controlling VMware Fusion/Workstation virtual machines via the `vmrun` CLI.

Unlike existing VMware MCP servers that depend on the REST API (`vmrest`), this server calls `vmrun` directly — no additional daemon required.

```bash
npx vmware-mcp
```

## Quick Start

### For AI Agents (opencode, Claude Desktop, Cursor, etc.)

Add to your MCP client config — the agent gets 32 tools for full VM control:

**opencode** (`~/.config/opencode/opencode.json`):
```json
{
  "mcp": {
    "vmware": {
      "type": "local",
      "command": ["npx", "-y", "vmware-mcp",
        "--guest-user", "my-vm:admin",
        "--guest-pass", "my-vm:password",
        "--encryption-pass", "my-vm:encpass"
      ],
      "timeout": 300000
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "vmware": {
      "command": "npx",
      "args": ["-y", "vmware-mcp",
        "--guest-user", "my-vm:admin",
        "--guest-pass", "my-vm:password"
      ]
    }
  }
}
```

Credentials can be omitted from args if stored in config file, environment variables, or OS secret store. See [Credential Resolution](#credential-resolution).

For tool usage workflows and known limitations, see [`AGENT_GUIDE.md`](AGENT_GUIDE.md).

### For Manual / Global Install

```bash
npm install -g vmware-mcp
vmware-mcp
```

## Configuration

Create `~/.config/vmware-mcp/config.json`:

```json
{
  "vmrun_path": "/Applications/VMware Fusion.app/Contents/Public/vmrun",
  "default_vm": "my-vm",
  "vms": {
    "my-vm": {
      "vmx_path": "/path/to/VM.vmwarevm/VM.vmx",
      "os_type": "windows",
      "guest_user": "admin",
      "guest_password": "password"
    },
    "linux-vm": {
      "vmx_path": "/path/to/Ubuntu.vmwarevm/Ubuntu.vmx",
      "os_type": "linux",
      "guest_user": "ubuntu",
      "guest_password": "password"
    }
  }
}
```

The config file is optional. VMs can also be specified by full `.vmx` path, and credentials can come from other sources.

### vmrun Path Defaults

| Platform | Default Path |
|---|---|
| macOS | `/Applications/VMware Fusion.app/Contents/Public/vmrun` |
| Windows | `C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe` |
| Linux | `/usr/bin/vmrun` |

## Credential Resolution

Credentials are resolved in this order (first match wins):

| Priority | Source | Platforms |
|---|---|---|
| 1 | Config file | All |
| 2 | CLI arguments | All |
| 3 | Environment variables | All |
| 4 | OS secret store | macOS Keychain, Linux libsecret, Windows PasswordVault |

If credentials exist in config or OS secret store, no CLI args or env vars are needed.

### CLI Arguments

```bash
vmware-mcp --guest-user my-vm:admin --guest-pass my-vm:password --encryption-pass my-vm:encpass
```

### Environment Variables

| Variable | Description |
|---|---|
| `VMWARE_MCP_<VM>_USER` | Guest OS username |
| `VMWARE_MCP_<VM>_PASS` | Guest OS password |
| `VMWARE_MCP_<VM>_ENCRYPTION_PASS` | VM encryption password |

`<VM>` is the uppercase VM name from config (e.g., `VMWARE_MCP_MY-VM_USER`).

### OS Secret Store

Store credentials securely — no plaintext files. The server reads from the native store automatically.

**macOS (Keychain)**
```bash
security add-generic-password -s vmware-mcp -a "my-vm/guest_user" -w "admin"
security add-generic-password -s vmware-mcp -a "my-vm/guest_password" -w "password"
security add-generic-password -s vmware-mcp -a "my-vm/encryption_password" -w "encpass"
```

**Linux (libsecret — GNOME Keyring / KDE Wallet)**
```bash
secret-tool store --label="vmware-mcp" service vmware-mcp account "my-vm/guest_user" <<< "admin"
secret-tool store --label="vmware-mcp" service vmware-mcp account "my-vm/guest_password" <<< "password"
secret-tool store --label="vmware-mcp" service vmware-mcp account "my-vm/encryption_password" <<< "encpass"
```

**Windows (Credential Locker / PasswordVault)**
```powershell
$vault = New-Object Windows.Security.Credentials.PasswordVault
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential("vmware-mcp", "my-vm/guest_user", "admin")))
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential("vmware-mcp", "my-vm/guest_password", "password")))
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential("vmware-mcp", "my-vm/encryption_password", "encpass")))
```

## Tools (32)

### VM Lifecycle (9)

| Tool | Description |
|---|---|
| `vm_start` | Start a VM (gui or headless) |
| `vm_stop` | Graceful or forced shutdown |
| `vm_suspend` | Suspend to disk (encrypted VMs may not resume via vmrun) |
| `vm_reset` | Reboot (soft or hard) |
| `vm_pause` / `vm_unpause` | Pause/resume execution |
| `vm_status` | Running state + IP address |
| `vm_list` | Running VMs, or all configured VMs with `all=true` |
| `vm_get_ip` | Guest IP (optionally wait until ready) |

### Guest Execution (2)

| Tool | Description |
|---|---|
| `guest_run_command` | Run shell command, return stdout. Auto-detects shell (cmd/bash/powershell) |
| `guest_run_program` | Launch a program (sync or fire-and-forget with `no_wait`) |

### File Operations (10)

| Tool | Description |
|---|---|
| `file_copy_to_guest` | Host → Guest file copy |
| `file_copy_from_guest` | Guest → Host file copy |
| `guest_read_file` | Read guest file contents |
| `guest_file_exists` | Check if file exists |
| `guest_directory_exists` | Check if directory exists |
| `guest_directory_create` | Create directory |
| `guest_delete_file` | Delete file |
| `guest_rename_file` | Rename/move file |
| `guest_list_directory` | List directory contents |
| `guest_create_tempfile` | Create temp file, return path |

### Snapshots (4)

| Tool | Description |
|---|---|
| `vm_snapshot_create` | Create named snapshot (may fail on running encrypted VMs) |
| `vm_snapshot_revert` | Revert to snapshot (optional `auto_start`) |
| `vm_snapshot_list` | List snapshots in tree format |
| `vm_snapshot_delete` | Delete snapshot |

### Process Management (2)

| Tool | Description |
|---|---|
| `guest_process_list` | List all guest processes |
| `guest_kill_process` | Kill process by PID |

### Screen & Input (2)

| Tool | Description |
|---|---|
| `vm_capture_screen` | Screenshot as base64 PNG or save to file (requires guest credentials) |
| `guest_type_keystrokes` | Send keystrokes to guest (requires macOS Accessibility permission) |

### Variables & Tools State (3)

| Tool | Description |
|---|---|
| `vm_read_variable` | Read VM variable (runtimeConfig / guestVar / guestEnv) |
| `vm_write_variable` | Write VM variable |
| `vm_check_tools` | Check VMware Tools state (unknown / installed / running) |

## Known Limitations

These are `vmrun` CLI constraints, not bugs in this server. All errors include actionable hints.

| Limitation | Workaround |
|---|---|
| Snapshot ops fail on running encrypted VMs | Stop the VM first |
| `vm_suspend` → `vm_start` fails on encrypted VMs | Use `vm_stop` / `vm_start` instead |
| Guest commands have a 5-minute hard timeout | Break long operations into smaller commands |
| `guest_type_keystrokes` needs macOS Accessibility | Grant permission in System Settings |
| `vm_capture_screen` requires guest credentials | Configure guest_user / guest_password |
| Port forwarding is Windows-host only | Not available on macOS Fusion |

## Development

```bash
git clone https://github.com/havu0/vmware-mcp.git
cd vmware-mcp
npm install
npm run build    # tsc
npm test         # vitest (70 tests)
npm run dev      # tsc --watch
```

## License

[MIT](LICENSE)
