# vmware-mcp

MCP server for controlling VMware Fusion/Workstation virtual machines via the `vmrun` CLI.

Unlike existing VMware MCP servers that depend on the REST API (`vmrest`), this server calls `vmrun` directly — no additional daemon required.

## Quick Start

```bash
# Install globally
npm install -g vmware-mcp

# Or run directly
npx vmware-mcp
```

### Configuration

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

Credentials are resolved in this order (first match wins):

| Priority | Source | Example |
|---|---|---|
| 1 | Config file | `"guest_password": "pass"` in config.json |
| 2 | CLI arguments | `--guest-pass my-vm:pass` |
| 3 | Environment variables | `VMWARE_MCP_MY-VM_PASS=pass` |
| 4 | macOS Keychain | `security add-generic-password -s vmware-mcp -a my-vm/guest_password -w pass` |

If credentials are found in config or Keychain, no CLI args or env vars are needed.

#### Environment Variables

| Variable | Description |
|---|---|
| `VMWARE_MCP_<VM>_USER` | Guest OS username |
| `VMWARE_MCP_<VM>_PASS` | Guest OS password |
| `VMWARE_MCP_<VM>_ENCRYPTION_PASS` | VM encryption password |

`<VM>` is the uppercase VM name from config (e.g., `VMWARE_MCP_MY-VM_USER`).

#### CLI Arguments

Pass credentials at server launch — useful when agents start the server:

```bash
node dist/index.js --guest-user my-vm:admin --guest-pass my-vm:password --encryption-pass my-vm:encpass
```

#### OS Secret Store

Store credentials securely (no plaintext files). The server reads from the native secret store automatically.

**macOS (Keychain)**
```bash
security add-generic-password -s vmware-mcp -a "my-vm/guest_user" -w "admin"
security add-generic-password -s vmware-mcp -a "my-vm/guest_password" -w "password"
security add-generic-password -s vmware-mcp -a "my-vm/encryption_password" -w "encpass"
```

**Linux (libsecret — GNOME Keyring / KDE Wallet)**
```bash
secret-tool store --label="vmware-mcp guest_user" service vmware-mcp account "my-vm/guest_user" <<< "admin"
secret-tool store --label="vmware-mcp guest_password" service vmware-mcp account "my-vm/guest_password" <<< "password"
secret-tool store --label="vmware-mcp encryption_password" service vmware-mcp account "my-vm/encryption_password" <<< "encpass"
```

**Windows (Credential Locker / PasswordVault)**
```powershell
$vault = New-Object Windows.Security.Credentials.PasswordVault
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential("vmware-mcp", "my-vm/guest_user", "admin")))
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential("vmware-mcp", "my-vm/guest_password", "password")))
$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential("vmware-mcp", "my-vm/encryption_password", "encpass")))
```

### vmrun Path Defaults

| Platform | Default Path |
|---|---|
| macOS | `/Applications/VMware Fusion.app/Contents/Public/vmrun` |
| Windows | `C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe` |
| Linux | `/usr/bin/vmrun` |

## Tools (32)

### VM Lifecycle

| Tool | Description |
|---|---|
| `vm_start` | Start a VM (gui or headless) |
| `vm_stop` | Graceful or forced shutdown |
| `vm_suspend` | Suspend to disk |
| `vm_reset` | Reboot (soft or hard) |
| `vm_pause` / `vm_unpause` | Pause/resume execution |
| `vm_status` | Running state + IP address |
| `vm_list` | List running VMs, or all configured VMs with `all=true` |
| `vm_get_ip` | Get guest IP (optionally wait) |

### Guest Execution

| Tool | Description |
|---|---|
| `guest_run_command` | Run shell command, return stdout. Auto-detects OS shell (cmd/bash) |
| `guest_run_program` | Launch a program (sync or async with `no_wait`) |

### File Operations

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

### Snapshots

| Tool | Description |
|---|---|
| `vm_snapshot_create` | Create named snapshot |
| `vm_snapshot_revert` | Revert to snapshot (optional `auto_start`) |
| `vm_snapshot_list` | List snapshots in tree format |
| `vm_snapshot_delete` | Delete snapshot |

### Process Management

| Tool | Description |
|---|---|
| `guest_process_list` | List all guest processes |
| `guest_kill_process` | Kill process by PID |

### Screen & Input

| Tool | Description |
|---|---|
| `vm_capture_screen` | Screenshot as base64 PNG or save to file |
| `guest_type_keystrokes` | Send keystrokes to guest |

### Variables & Tools State

| Tool | Description |
|---|---|
| `vm_read_variable` | Read VM variable (runtimeConfig/guestVar/guestEnv) |
| `vm_write_variable` | Write VM variable |
| `vm_check_tools` | Check VMware Tools state |

## Integration

### opencode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "vmware": {
      "type": "local",
      "command": ["node", "/path/to/vmware-mcp/dist/index.js"],
      "environment": {
        "VMWARE_MCP_MYVM_USER": "admin",
        "VMWARE_MCP_MYVM_PASS": "password",
        "VMWARE_MCP_MYVM_ENCRYPTION_PASS": "encryption-password"
      },
      "timeout": 300000
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vmware": {
      "command": "npx",
      "args": ["-y", "vmware-mcp"],
      "env": {
        "VMWARE_MCP_CONFIG": "~/.config/vmware-mcp/config.json"
      }
    }
  }
}
```

## Development

```bash
git clone https://github.com/user/vmware-mcp
cd vmware-mcp
npm install
npm run build    # tsc
npm test         # vitest (70 tests)
npm run dev      # tsc --watch
```

## Known Limitations

- **Encrypted VMs**: Snapshot create/delete/revert may fail on running encrypted VMs. Stop the VM first.
- **Encrypted VMs + suspend**: `vm_suspend` works but `vm_start` may fail to resume. Use `vm_stop`/`vm_start` instead.
- **Guest command timeout**: vmrun has a hard 5-minute limit on guest operations. Not configurable.
- **`guest_type_keystrokes`**: Requires macOS Accessibility permission for VMware Fusion.
- **`vm_capture_screen`**: Requires guest credentials even though it's a display operation.
- **Port forwarding**: vmrun port forwarding commands are Windows-host only, not available on macOS Fusion.

## License

MIT
