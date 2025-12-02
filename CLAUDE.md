# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server for AI-assisted Mirth Connect / Open Integration Engine (OIE) v4.5.2 development, testing, troubleshooting, and management.

## Mirth Connect API

- **Endpoint**: `https://localhost:8444/api/`
- **Authentication**: Basic auth with `admin/admin` credentials
- **API Spec**: OpenAPI 3.0.1 specification in `SWAGGER OIE/API_OIE.json`

## Project Structure

```
MCP OIE/
├── servers/mirth-connect-mcp/    # Main MCP server (TypeScript)
│   ├── src/
│   │   ├── index.ts              # MCP server entry point with all tools
│   │   ├── config.ts             # Configuration management
│   │   ├── mirth-client.ts       # Mirth Connect API client
│   │   └── backup-manager.ts     # Backup/recovery system
│   ├── package.json
│   └── tsconfig.json
├── SWAGGER OIE/API_OIE.json      # OIE API specification
└── info.txt                      # Connection details
```

## Build & Run Commands

```bash
cd servers/mirth-connect-mcp
npm install           # Install dependencies
npm run build         # Compile TypeScript to dist/
npm run dev           # Run in development mode with tsx
npm start             # Run compiled server
```

## MCP Server Tools

The server provides 30+ tools organized into categories:

### Connection
`mirth_connect`, `mirth_disconnect`, `mirth_server_info`

### Channel Management
`mirth_list_channels`, `mirth_get_channel`, `mirth_deploy_channel`, `mirth_undeploy_channel`, `mirth_start_channel`, `mirth_stop_channel`, `mirth_update_channel`, `mirth_delete_channel`

### Code Templates
`mirth_list_code_templates`, `mirth_get_code_template`, `mirth_get_code_template_library`

### Troubleshooting
`mirth_get_events`, `mirth_get_channel_messages`, `mirth_get_message_content`, `mirth_get_channel_statistics`, `mirth_reprocess_message`

### Backup & Recovery
`mirth_backup_channel`, `mirth_backup_code_template`, `mirth_list_backups`, `mirth_get_backup`, `mirth_restore_backup`, `mirth_compare_backups`

### Validation
`mirth_validate_channel_xml`, `mirth_analyze_channel`

## Safety Features

- **Auto-backup**: Before any modification (update, delete, deploy, undeploy)
- **Confirmation required**: For destructive operations (update, delete, restore)
- **Version control**: Keeps last 10 versions of each resource
- **Restore capability**: Can restore from any backup

## Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_URL` | `https://localhost:8444/api` | API endpoint |
| `MIRTH_USERNAME` | `admin` | Username |
| `MIRTH_PASSWORD` | `admin` | Password |
| `MIRTH_REJECT_UNAUTHORIZED` | `true` | SSL verification |
| `BACKUP_DIR` | `./backups` | Backup directory |
| `REQUIRE_CONFIRMATION` | `true` | Safety confirmations |

## Session Summary (2024-12-02)

Completed:
- Created MCP server architecture
- Implemented Mirth Connect API client (mirth-client.ts)
- Implemented backup/recovery system (backup-manager.ts)
- Implemented MCP server with 30+ tools (index.ts)
- Added safety features (auto-backup, confirmations)
- Created documentation (README.md, CLAUDE.md)
