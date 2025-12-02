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
│   │   ├── backup-manager.ts     # Backup/recovery system
│   │   └── dataset-manager.ts    # Dataset query system (token optimization)
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

The server provides 45+ tools organized into categories:

### Connection
`mirth_connect`, `mirth_disconnect`, `mirth_server_info`

### Channel Management
`mirth_list_channels`, `mirth_get_channel`, `mirth_deploy_channel`, `mirth_undeploy_channel`, `mirth_start_channel`, `mirth_stop_channel`, `mirth_update_channel`, `mirth_delete_channel`

### Code Templates
`mirth_list_code_templates`, `mirth_get_code_template`, `mirth_get_code_template_library`

### Troubleshooting
`mirth_get_events`, `mirth_get_channel_messages`, `mirth_get_message_content`, `mirth_get_channel_statistics`, `mirth_reprocess_message`

### Server Logs & Maps
`mirth_get_server_logs`, `mirth_get_connection_logs`, `mirth_get_channel_connection_logs`, `mirth_get_global_map`, `mirth_get_channel_map`, `mirth_get_all_maps`

### File Export/Import
`mirth_export_channel`, `mirth_import_channel`, `mirth_export_code_template_library`, `mirth_export_code_template`, `mirth_import_code_template`, `mirth_import_code_template_library`, `mirth_list_exported_files`

### Backup & Recovery
`mirth_backup_channel`, `mirth_backup_code_template`, `mirth_list_backups`, `mirth_get_backup`, `mirth_restore_backup`, `mirth_compare_backups`

### Validation
`mirth_validate_channel_xml`, `mirth_analyze_channel`

### Dataset Query (Token Optimization)
`dataset_query`, `dataset_get_item`, `dataset_list`, `dataset_info`

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

### Phase 1 - Initial Implementation
- Created MCP server architecture
- Implemented Mirth Connect API client (mirth-client.ts)
- Implemented backup/recovery system (backup-manager.ts)
- Implemented MCP server with 30+ tools (index.ts)
- Added safety features (auto-backup, confirmations)

### Phase 2 - API Fixes & Extensions
- Fixed HTTP 415 error: Login requires `application/x-www-form-urlencoded`
- Fixed HTTP 404 error: Changed `/server/info` to `/server/version` + `/server/id`
- Fixed HTTP 406 error: Added `Accept: text/plain` for text endpoints
- Added 6 new tools for extension services:
  - `mirth_get_server_logs` - Server log entries with pagination
  - `mirth_get_connection_logs` - Connection logs for all channels
  - `mirth_get_channel_connection_logs` - Per-channel connection logs (source/destination)
  - `mirth_get_global_map` - Global map (shared variables)
  - `mirth_get_channel_map` - Channel-specific maps
  - `mirth_get_all_maps` - All maps combined
- All endpoints support `fetchSize` and `lastLogId` for pagination

### Phase 3 - File Export/Import for Channels
- Added file-based workflow for large XML configs:
  - `mirth_export_channel` - Export channel XML to local file + metadata JSON
  - `mirth_import_channel` - Import/update channel from local XML file (with auto-backup)
  - `mirth_export_code_template_library` - Export library with all templates
  - `mirth_list_exported_files` - List exported files in a directory

### Phase 4 - Code Template Import/Export
- Added individual code template management:
  - `mirth_export_code_template` - Export single template to XML file
  - `mirth_import_code_template` - Import/update single template (does NOT affect others)
  - `mirth_import_code_template_library` - Import library with merge (preserves other libraries)
- API Strategy:
  - `PUT /codeTemplates/{id}` - Updates ONLY the specified template (safe)
  - `PUT /codeTemplateLibraries` - Replaces ALL libraries (requires merge logic)
- Safety: Auto-backup before any import, confirmation required

### Phase 5 - Dataset Query System (Token Optimization)
- Created DatasetManager for temporary data storage with query capabilities
- Pattern: Fetch data → Store locally → Return summary + datasetId → AI queries as needed
- New tools:
  - `dataset_query` - Query dataset with filters, pagination, search
  - `dataset_get_item` - Get single item by ID (full content)
  - `dataset_list` - List active datasets
  - `dataset_info` - Get dataset metadata and summary
- Modified tools to use DatasetManager:
  - `mirth_get_channel_messages` → Returns datasetId + summary (not raw messages)
  - `mirth_get_events` → Returns datasetId + summary
  - `mirth_get_server_logs` → Returns datasetId + summary
  - `mirth_get_connection_logs` → Returns datasetId + summary
  - `mirth_get_channel_connection_logs` → Returns datasetId + summary
- Features:
  - Auto-pagination (50 items per page)
  - Sorted by ID (newest first)
  - Filter by any field
  - Text search across all fields
  - 30-minute TTL with auto-cleanup

## Dataset Query Workflow

```
1. Fetch data (returns summary + datasetId)
   mirth_get_channel_messages { channelId: "xxx" }
   → { datasetId: "ds_xxx", totalMessages: 150, summary: {...} }

2. Browse with pagination
   dataset_query { datasetId: "ds_xxx", page: 1 }
   → First 50 items with compact preview

3. Filter results
   dataset_query { datasetId: "ds_xxx", filters: { status: "ERROR" } }
   → Only error messages

4. Search text
   dataset_query { datasetId: "ds_xxx", search: "patient" }
   → Items containing "patient"

5. Get full item details
   dataset_get_item { datasetId: "ds_xxx", itemId: 123 }
   → Full message/log content
```

## Tests to Run After Restart

### Connection Tests
1. `mirth_connect` - Should connect successfully
2. `mirth_server_info` - Should return version "4.5.2"
3. `mirth_disconnect` - Should disconnect

### Channel Tests
4. `mirth_list_channels` - List all channels
5. `mirth_get_channel_statistics` - Get stats for all channels
6. `mirth_export_channel` - Export a channel to `./exports/test-channel.xml`
7. `mirth_list_exported_files` - Verify exported file appears
8. (Edit XML file locally if needed)
9. `mirth_import_channel` - Re-import the channel (confirm when prompted)
10. `mirth_deploy_channel` - Deploy the imported channel

### Code Template Tests
11. `mirth_list_code_templates` - List all libraries and templates
12. `mirth_export_code_template_library` - Export a library to `./exports/test-library.xml`
13. `mirth_export_code_template` - Export single template to `./exports/test-template.xml`
14. `mirth_import_code_template` - Import single template (confirm)
15. `mirth_import_code_template_library` - Import library with merge (confirm)
16. Verify other templates/libraries were NOT deleted

### Server Logs & Maps Tests
17. `mirth_get_server_logs` (fetchSize: 10) - Get server logs
18. `mirth_get_connection_logs` (fetchSize: 10) - Get connection logs
19. `mirth_get_global_map` - Get global map variables
20. `mirth_get_channel_map` (channelId) - Get channel map

### Backup Tests
21. `mirth_list_backups` - List all backups created during tests
22. `mirth_backup_stats` - Get backup statistics

### Dataset Query Tests (Phase 5 + Phase 6 Fixes)
23. `mirth_get_events` (limit: 20) - Should return datasetId + summary with proper levelCounts
24. `mirth_get_server_logs` (fetchSize: 20) - Should return datasetId + flattened data
25. `mirth_get_channel_messages` (channelId, limit: 20) - Should NOT throw "Invalid time value"
26. `dataset_list` - Should show active datasets with correct totalCount
27. `dataset_query` (datasetId, page: 1) - Items should be flat (not nested in list.event[])
28. `dataset_get_item` (datasetId, itemId) - Should find item by ID (test with event id from query)
29. `dataset_info` (datasetId) - Should show summary with proper date ranges

## Phase 6 - Bug Fixes (2024-12-02)

### Issues Fixed
1. **Nested API response handling**: Mirth API returns data wrapped in `{ list: { event: [...] } }` format. Added `flattenApiResponse()` to extract flat arrays before storing in DatasetManager.

2. **Date parsing errors**: Fixed "Invalid time value" error in `generateSummary()`. Mirth returns dates as:
   - Timestamps (numbers)
   - Objects with `time` property: `{ time: 1234567890, timezone: "Europe/Paris" }`
   - ISO strings
   Added robust parsing with try/catch.

3. **Undefined parameter handling**: API calls with undefined `startDate`/`endDate` caused errors. Added parameter filtering in `mirth-client.ts` to remove undefined values.

### Files Modified
- `dataset-manager.ts`: Added `flattenApiResponse()`, fixed date parsing
- `mirth-client.ts`: Added undefined parameter filtering in `getMessages()`

### Restart Required
After rebuilding (`npm run build`), the MCP server must be restarted for changes to take effect. Close and reopen Claude Code or restart the MCP server process.

## Development Workflow

```
1. Export channel/template to local file
   mirth_export_channel / mirth_export_code_template

2. Read/Edit XML file with Claude's Read/Edit tools
   (No token issues - file is local)

3. Import modified XML
   mirth_import_channel / mirth_import_code_template
   (Auto-backup created, confirmation required)

4. Deploy and test
   mirth_deploy_channel / check logs

5. If issues, restore from backup
   mirth_list_backups -> mirth_restore_backup
```
