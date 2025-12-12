# Mirth Connect MCP Server

A comprehensive Model Context Protocol (MCP) server for AI-assisted Mirth Connect / Open Integration Engine (OIE) v4.5.2 development.

## Features

- **Channel Management**: List, view, deploy, undeploy, start, stop, update, delete channels
- **Code Templates**: View and manage code template libraries
- **Troubleshooting**: Access server events, channel messages, statistics
- **Backup & Recovery**: Automatic backups before modifications, manual backup/restore
- **Safety Features**: Confirmation required for destructive operations, automatic backup before changes
- **Validation**: Channel XML validation and analysis
- **File Export/Import**: Export channels/templates to local files for editing
- **Dataset Query System**: Token-optimized data retrieval with pagination, filtering, and search

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

### Server Logs & Maps
- `mirth_get_server_logs` - Get server log entries (returns datasetId)
- `mirth_get_connection_logs` - Get connection logs for all channels (returns datasetId)
- `mirth_get_channel_connection_logs` - Get connection logs for specific channel (returns datasetId)
- `mirth_get_global_map` - Get global map variables
- `mirth_get_channel_map` - Get channel-specific map
- `mirth_get_all_maps` - Get all maps combined

### File Export/Import
- `mirth_export_channel` - Export channel XML to local file
- `mirth_import_channel` - Import channel from local XML file
- `mirth_export_code_template` - Export single code template to file
- `mirth_import_code_template` - Import single code template from file
- `mirth_export_code_template_library` - Export library with all templates
- `mirth_import_code_template_library` - Import library (merges with existing)
- `mirth_list_exported_files` - List exported files in directory

### Dataset Query (Token Optimization)
- `dataset_query` - Query stored dataset with filters, pagination, search
- `dataset_get_item` - Get single item by ID from dataset
- `dataset_list` - List all active datasets
- `dataset_info` - Get dataset metadata and summary

## Dataset Query System

The Dataset Query System optimizes token usage by storing large datasets locally and returning summaries instead of raw data.

### How It Works

1. **Fetch data** - Tools like `mirth_get_channel_messages` return a `datasetId` + summary
2. **Query dataset** - Use `dataset_query` to browse with pagination, filters, search
3. **Get details** - Use `dataset_get_item` to retrieve full content of specific items

### Example Workflow

```
# Step 1: Fetch messages (returns summary, not raw data)
mirth_get_channel_messages { channelId: "abc-123" }
→ { datasetId: "ds_xxx", totalMessages: 150, summary: { errorCount: 5, ... } }

# Step 2: Browse with pagination
dataset_query { datasetId: "ds_xxx", page: 1 }
→ First 50 items (compact preview)

# Step 3: Filter by status
dataset_query { datasetId: "ds_xxx", filters: { status: "ERROR" } }
→ Only error messages

# Step 4: Text search
dataset_query { datasetId: "ds_xxx", search: "patient" }
→ Items containing "patient"

# Step 5: Get full details
dataset_get_item { datasetId: "ds_xxx", itemId: 123 }
→ Full message content
```

### Dataset Features
- **Auto-pagination**: 50 items per page (max 100)
- **Sorted by ID**: Newest first for easy navigation
- **Field filters**: Filter by any field (status, level, channelName, etc.)
- **Text search**: Search across all fields
- **30-minute TTL**: Datasets auto-expire to free memory
