# Mirth Connect MCP Server

A comprehensive Model Context Protocol (MCP) server for AI-assisted Mirth Connect / Open Integration Engine (OIE) development.

## Features

- **Channel Management**: List, view, deploy, undeploy, start, stop, update, delete channels
- **Code Templates**: View and manage code template libraries
- **Troubleshooting**: Access server events, channel messages, statistics
- **Backup & Recovery**: Automatic backups before modifications, manual backup/restore
- **Safety Features**: Confirmation required for destructive operations, automatic backup before changes
- **Validation**: Channel XML validation and analysis

## Installation

```bash
cd servers/mirth-connect-mcp
npm install
npm run build
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_URL` | `https://localhost:8444/api` | Mirth Connect API endpoint |
| `MIRTH_USERNAME` | `admin` | Username for authentication |
| `MIRTH_PASSWORD` | `admin` | Password for authentication |
| `MIRTH_REJECT_UNAUTHORIZED` | `true` | Verify SSL certificates |
| `BACKUP_DIR` | `./backups` | Directory for storing backups |
| `BACKUP_MAX_VERSIONS` | `10` | Max backup versions per resource |
| `REQUIRE_CONFIRMATION` | `true` | Require confirmation for destructive ops |

## Usage with Claude Code

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "mirth-connect": {
      "command": "node",
      "args": ["path/to/servers/mirth-connect-mcp/dist/index.js"],
      "env": {
        "MIRTH_URL": "https://localhost:8444/api",
        "MIRTH_USERNAME": "admin",
        "MIRTH_PASSWORD": "admin",
        "MIRTH_REJECT_UNAUTHORIZED": "false"
      }
    }
  }
}
```

## Available Tools

### Connection
- `mirth_connect` - Connect to Mirth server
- `mirth_disconnect` - Disconnect from server
- `mirth_server_info` - Get server information

### Channels
- `mirth_list_channels` - List all channels with status/stats
- `mirth_get_channel` - Get channel details (JSON/XML)
- `mirth_deploy_channel` - Deploy a channel
- `mirth_undeploy_channel` - Undeploy a channel
- `mirth_start_channel` - Start a channel
- `mirth_stop_channel` - Stop a channel
- `mirth_update_channel` - Update channel config (requires confirmation)
- `mirth_delete_channel` - Delete a channel (requires confirmation)

### Code Templates
- `mirth_list_code_templates` - List all templates and libraries
- `mirth_get_code_template` - Get template details
- `mirth_get_code_template_library` - Get library with templates

### Troubleshooting
- `mirth_get_events` - Get server events/logs
- `mirth_get_channel_messages` - Get channel messages
- `mirth_get_message_content` - Get message details
- `mirth_get_channel_statistics` - Get message statistics
- `mirth_reprocess_message` - Reprocess a failed message

### Global Configuration
- `mirth_get_global_scripts` - Get global scripts
- `mirth_update_global_scripts` - Update global scripts
- `mirth_get_configuration_map` - Get server config map

### Backup & Recovery
- `mirth_backup_channel` - Manually backup a channel
- `mirth_backup_code_template` - Backup a code template
- `mirth_list_backups` - List all backups
- `mirth_get_backup` - Get backup content
- `mirth_restore_backup` - Restore from backup
- `mirth_compare_backups` - Compare two backups
- `mirth_backup_stats` - Get backup statistics

### Validation
- `mirth_validate_channel_xml` - Validate channel XML
- `mirth_analyze_channel` - Analyze channel for issues

### Safety
- `mirth_confirm_action` - Confirm a pending action
- `mirth_cancel_action` - Cancel a pending action
