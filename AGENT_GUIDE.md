# Agent Guide — vmware-mcp

Practical guide for AI agents operating VMware VMs through this MCP server.

## VM Identification

Every tool accepts an optional `vm` parameter:
- Omit → uses `default_vm` from config
- VM name (e.g., `"win11"`) → resolved from config
- Full `.vmx` path → used directly

When only one VM is configured, you can omit `vm` from all calls.

## Preflight Checklist

Before running guest commands, verify these conditions in order:

```
1. vm_list(all=true)         → Is the VM configured?
2. vm_status                  → Is it running?
3. vm_check_tools             → Are VMware Tools "running"?
4. guest_run_command("echo ok") → Do guest credentials work?
```

If step 3 returns "unknown" or "installed" (not "running"), wait — the guest OS is still booting.
If step 4 fails with "Anonymous guest operations", credentials are missing from config.

## Common Workflows

### Start VM and run a command

```
vm_start(gui=true)
vm_get_ip(wait=true)          # blocks until Tools are ready
guest_run_command("hostname")
```

### Deploy a file and verify

```
file_copy_to_guest(host_path="/local/app.exe", guest_path="C:\\Users\\admin\\app.exe")
guest_file_exists(guest_path="C:\\Users\\admin\\app.exe")   # → true
guest_run_command("C:\\Users\\admin\\app.exe --version")
```

### Safe snapshot workflow

```
vm_snapshot_list               # see existing snapshots
vm_stop(mode="soft")           # stop first for encrypted VMs
vm_snapshot_create("pre-test")
vm_start(gui=true)
# ... do work ...
vm_stop(mode="soft")
vm_snapshot_revert("pre-test", auto_start=true)
```

### GUI automation (capture + keystrokes)

```
vm_capture_screen              # see current state
guest_type_keystrokes("hello")
vm_capture_screen              # verify result
```

### Inspect and kill a process

```
guest_process_list             # find PID
guest_kill_process(pid=1234)
```

## OS-Specific Notes

### Windows Guests
- `guest_run_command` wraps commands with `cmd /c` automatically
- Use backslashes for paths: `C:\\Users\\admin\\file.txt`
- PowerShell: `guest_run_command(command="Get-Process", shell="powershell")`

### Linux Guests
- `guest_run_command` uses `/bin/bash` by default
- Use forward slashes: `/home/user/file.txt`
- Shell override: `guest_run_command(command="ls", shell="sh")`

## Credential Resolution

Credentials resolve automatically in priority order:

```
config file → CLI args → environment variables → macOS Keychain
```

If a credential is found in any source, lower-priority sources are skipped.
If the user has stored passwords in config or Keychain, no CLI args or env vars are needed.

When launching this server with credentials at runtime:

```bash
node dist/index.js --guest-user win11:admin --guest-pass win11:password --encryption-pass win11:encpass
```

As an MCP client config (e.g., opencode):
```json
{
  "command": ["node", "dist/index.js", "--guest-pass", "win11:password", "--encryption-pass", "win11:encpass"]
}
```

If you get "Anonymous guest operations" errors, credentials are missing from ALL sources.

## Error Handling

All vmrun errors include actionable hints. When you receive an error:

1. **Read the hint** — it tells you exactly what to do
2. **Don't retry blindly** — fix the underlying issue first
3. **Common fixes**:
   - "Anonymous guest operations" → guest credentials not configured
   - "VMware Tools are not running" → VM still booting, wait and retry
   - "not powered on" → start the VM first
   - "Authentication for encrypted VM failed" → wrong encryption password, or stop VM before snapshot ops
   - "Insufficient permissions" → macOS accessibility permission needed for Fusion

## Things That Don't Work (vmrun Limitations)

These are vmrun CLI constraints, not bugs in this server:

| Scenario | What Happens | Workaround |
|---|---|---|
| Snapshot ops on running encrypted VM | Auth error | Stop VM first, then snapshot |
| `vm_suspend` then `vm_start` on encrypted VM | "Operation not supported" | Use `vm_stop`/`vm_start` instead |
| `guest_type_keystrokes` without accessibility permission | Permission error | Grant in macOS System Settings |
| Guest command running >5 minutes | Timeout (vmrun hard limit) | Break into smaller commands |
| `guest_run_command` with interactive programs | Hangs | Use `guest_run_program(no_wait=true)` for GUI apps |

## Tool Quick Reference

### No credentials needed
`vm_list`, `vm_start`, `vm_stop`, `vm_suspend`, `vm_reset`, `vm_pause`, `vm_unpause`, `vm_status`, `vm_get_ip`, `vm_snapshot_list`, `vm_read_variable`, `vm_write_variable`

### Guest credentials required
`guest_run_command`, `guest_run_program`, `file_copy_to_guest`, `file_copy_from_guest`, `guest_read_file`, `guest_file_exists`, `guest_directory_exists`, `guest_directory_create`, `guest_delete_file`, `guest_rename_file`, `guest_list_directory`, `guest_create_tempfile`, `guest_process_list`, `guest_kill_process`, `vm_capture_screen`, `guest_type_keystrokes`

### Encryption password required
`vm_start` (encrypted VMs only), `vm_snapshot_create`, `vm_snapshot_revert`, `vm_snapshot_delete`

## Performance Tips

- `vm_get_ip(wait=true)` blocks until guest is ready — use this instead of polling `vm_status`
- `guest_run_program(no_wait=true)` for fire-and-forget launches (GUI apps, services)
- `guest_create_tempfile` returns a safe unique path — use it for writing intermediate data
- `vm_capture_screen` without `host_path` returns base64 inline — saves a file transfer step
