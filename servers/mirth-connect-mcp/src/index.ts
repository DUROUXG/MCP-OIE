#!/usr/bin/env node
/**
 * Mirth Connect MCP Server
 *
 * A comprehensive MCP server for AI-assisted Mirth Connect development,
 * testing, troubleshooting, and code management with safety features.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig, ServerConfig } from './config.js';
import { MirthClient } from './mirth-client.js';
import { BackupManager } from './backup-manager.js';
import { datasetManager, DatasetQuery } from './dataset-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Pending confirmations for destructive operations
const pendingConfirmations = new Map<string, {
  action: string;
  params: Record<string, unknown>;
  expiresAt: number;
}>();

class MirthConnectMCPServer {
  private server: Server;
  private config: ServerConfig;
  private mirthClient: MirthClient;
  private backupManager: BackupManager;
  private isConnected: boolean = false;

  constructor() {
    this.config = loadConfig();
    this.mirthClient = new MirthClient(this.config.mirth);
    this.backupManager = new BackupManager(this.config.backup);

    this.server = new Server(
      {
        name: 'mirth-connect-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return await this.handleToolCall(request.params.name, request.params.arguments || {});
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'mirth://server/info',
          name: 'Server Information',
          description: 'Current Mirth Connect server information and status',
          mimeType: 'application/json',
        },
        {
          uri: 'mirth://channels/list',
          name: 'Channel List',
          description: 'List of all channels with their current status',
          mimeType: 'application/json',
        },
        {
          uri: 'mirth://backups/stats',
          name: 'Backup Statistics',
          description: 'Statistics about stored backups',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return await this.handleResourceRead(request.params.uri);
    });
  }

  private getTools(): Tool[] {
    return [
      // === Connection Tools ===
      {
        name: 'mirth_connect',
        description: 'Connect to the Mirth Connect server. Must be called before other operations.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mirth_disconnect',
        description: 'Disconnect from the Mirth Connect server.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mirth_server_info',
        description: 'Get Mirth Connect server information and status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // === Channel Management Tools ===
      {
        name: 'mirth_list_channels',
        description: 'List all channels with their status and basic information.',
        inputSchema: {
          type: 'object',
          properties: {
            includeStatus: {
              type: 'boolean',
              description: 'Include deployment status for each channel',
              default: true,
            },
            includeStats: {
              type: 'boolean',
              description: 'Include message statistics for each channel',
              default: false,
            },
          },
        },
      },
      {
        name: 'mirth_get_channel',
        description: 'Get detailed information about a specific channel including its configuration.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID or name',
            },
            format: {
              type: 'string',
              enum: ['json', 'xml'],
              description: 'Output format',
              default: 'json',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_deploy_channel',
        description: 'Deploy a channel to make it active. Creates a backup first.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_undeploy_channel',
        description: 'Undeploy a channel. Creates a backup first.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_start_channel',
        description: 'Start a deployed channel.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_stop_channel',
        description: 'Stop a running channel.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_update_channel',
        description: 'Update a channel configuration. ALWAYS creates a backup before updating. Requires confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
            channelXml: {
              type: 'string',
              description: 'The complete channel XML configuration',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token from a previous call (for safety)',
            },
          },
          required: ['channelId', 'channelXml'],
        },
      },
      {
        name: 'mirth_delete_channel',
        description: 'Delete a channel. ALWAYS creates a backup before deletion. Requires double confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token from a previous call (for safety)',
            },
          },
          required: ['channelId'],
        },
      },

      // === Code Template Tools ===
      {
        name: 'mirth_list_code_templates',
        description: 'List all code template libraries and their templates.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mirth_get_code_template',
        description: 'Get a specific code template with its code.',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: {
              type: 'string',
              description: 'The code template ID',
            },
            format: {
              type: 'string',
              enum: ['json', 'xml'],
              description: 'Output format',
              default: 'json',
            },
          },
          required: ['templateId'],
        },
      },
      {
        name: 'mirth_get_code_template_library',
        description: 'Get a code template library with all its templates.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryId: {
              type: 'string',
              description: 'The code template library ID',
            },
            format: {
              type: 'string',
              enum: ['json', 'xml'],
              description: 'Output format',
              default: 'json',
            },
          },
          required: ['libraryId'],
        },
      },

      // === Troubleshooting Tools ===
      {
        name: 'mirth_get_events',
        description: 'Get server events/logs for troubleshooting. Can filter by level, date range, and more.',
        inputSchema: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['INFORMATION', 'WARNING', 'ERROR'],
              description: 'Filter by event level',
            },
            startDate: {
              type: 'string',
              description: 'Start date in ISO format (e.g., 2024-01-01T00:00:00)',
            },
            endDate: {
              type: 'string',
              description: 'End date in ISO format',
            },
            name: {
              type: 'string',
              description: 'Filter by event name',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of events to return',
              default: 50,
            },
          },
        },
      },
      {
        name: 'mirth_get_channel_messages',
        description: 'Get messages for a channel to debug message processing issues.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
            status: {
              type: 'string',
              enum: ['RECEIVED', 'TRANSFORMED', 'FILTERED', 'QUEUED', 'SENT', 'ERROR'],
              description: 'Filter by message status',
            },
            startDate: {
              type: 'string',
              description: 'Start date in ISO format',
            },
            endDate: {
              type: 'string',
              description: 'End date in ISO format',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to return',
              default: 20,
            },
            includeContent: {
              type: 'boolean',
              description: 'Include message content (raw, transformed, encoded)',
              default: false,
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_get_message_content',
        description: 'Get detailed content of a specific message including raw, transformed, and encoded data.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
            messageId: {
              type: 'number',
              description: 'The message ID',
            },
            metaDataId: {
              type: 'number',
              description: 'The connector metadata ID (0 for source, 1+ for destinations)',
              default: 0,
            },
          },
          required: ['channelId', 'messageId'],
        },
      },
      {
        name: 'mirth_get_channel_statistics',
        description: 'Get message statistics for channels (received, sent, error, filtered, queued counts).',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'Optional channel ID. If not provided, returns stats for all channels.',
            },
          },
        },
      },
      {
        name: 'mirth_reprocess_message',
        description: 'Reprocess a message that failed or needs to be sent again.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
            messageId: {
              type: 'number',
              description: 'The message ID to reprocess',
            },
            replace: {
              type: 'boolean',
              description: 'Replace the existing message instead of creating a new one',
              default: false,
            },
          },
          required: ['channelId', 'messageId'],
        },
      },

      // === Global Scripts & Configuration ===
      {
        name: 'mirth_get_global_scripts',
        description: 'Get global deploy/undeploy/preprocessor/postprocessor scripts.',
        inputSchema: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              enum: ['json', 'xml'],
              description: 'Output format',
              default: 'json',
            },
          },
        },
      },
      {
        name: 'mirth_update_global_scripts',
        description: 'Update global scripts. Creates a backup first. Requires confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            scriptsXml: {
              type: 'string',
              description: 'The global scripts XML',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token from a previous call',
            },
          },
          required: ['scriptsXml'],
        },
      },
      {
        name: 'mirth_get_configuration_map',
        description: 'Get the server configuration map (key-value settings).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // === Backup & Recovery Tools ===
      {
        name: 'mirth_backup_channel',
        description: 'Manually create a backup of a channel.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID to backup',
            },
            description: {
              type: 'string',
              description: 'Optional description for this backup',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_backup_code_template',
        description: 'Manually create a backup of a code template.',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: {
              type: 'string',
              description: 'The code template ID to backup',
            },
            description: {
              type: 'string',
              description: 'Optional description for this backup',
            },
          },
          required: ['templateId'],
        },
      },
      {
        name: 'mirth_list_backups',
        description: 'List all stored backups with filtering options.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['channel', 'codeTemplate', 'codeTemplateLibrary', 'globalScripts', 'full'],
              description: 'Filter by backup type',
            },
            resourceId: {
              type: 'string',
              description: 'Filter by resource ID',
            },
          },
        },
      },
      {
        name: 'mirth_get_backup',
        description: 'Get the content of a specific backup.',
        inputSchema: {
          type: 'object',
          properties: {
            backupId: {
              type: 'string',
              description: 'The backup ID',
            },
          },
          required: ['backupId'],
        },
      },
      {
        name: 'mirth_restore_backup',
        description: 'Restore a resource from a backup. Creates a backup of current state first. Requires confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            backupId: {
              type: 'string',
              description: 'The backup ID to restore',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token from a previous call',
            },
          },
          required: ['backupId'],
        },
      },
      {
        name: 'mirth_compare_backups',
        description: 'Compare two backups to see if they differ.',
        inputSchema: {
          type: 'object',
          properties: {
            backupId1: {
              type: 'string',
              description: 'First backup ID',
            },
            backupId2: {
              type: 'string',
              description: 'Second backup ID',
            },
          },
          required: ['backupId1', 'backupId2'],
        },
      },
      {
        name: 'mirth_backup_stats',
        description: 'Get statistics about stored backups.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // === Server Logs & Maps (Extension Services) ===
      {
        name: 'mirth_get_server_logs',
        description: 'Get server log entries for debugging. Supports pagination via lastLogId.',
        inputSchema: {
          type: 'object',
          properties: {
            fetchSize: {
              type: 'number',
              description: 'Maximum number of log entries to return',
              default: 50,
            },
            lastLogId: {
              type: 'number',
              description: 'Last log ID retrieved. Only logs with greater ID will be returned (for pagination).',
            },
          },
        },
      },
      {
        name: 'mirth_get_connection_logs',
        description: 'Get connection logs for all channels. Shows connector states and events.',
        inputSchema: {
          type: 'object',
          properties: {
            fetchSize: {
              type: 'number',
              description: 'Maximum number of log entries to return',
              default: 50,
            },
            serverId: {
              type: 'string',
              description: 'Filter by server ID (optional)',
            },
            lastLogId: {
              type: 'number',
              description: 'Last log ID retrieved (for pagination)',
            },
          },
        },
      },
      {
        name: 'mirth_get_channel_connection_logs',
        description: 'Get connection logs for a specific channel (source and destination connectors).',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
            fetchSize: {
              type: 'number',
              description: 'Maximum number of log entries to return',
              default: 50,
            },
            serverId: {
              type: 'string',
              description: 'Filter by server ID (optional)',
            },
            lastLogId: {
              type: 'number',
              description: 'Last log ID retrieved (for pagination)',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_get_global_map',
        description: 'Get the global map (shared variables across all channels).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mirth_get_channel_map',
        description: 'Get the global channel map for a specific channel.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID',
            },
          },
          required: ['channelId'],
        },
      },
      {
        name: 'mirth_get_all_maps',
        description: 'Get all global and channel maps.',
        inputSchema: {
          type: 'object',
          properties: {
            channelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of channel IDs to filter',
            },
            includeGlobalMap: {
              type: 'boolean',
              description: 'Include the global map in response',
              default: true,
            },
          },
        },
      },

      // === File Export/Import Tools ===
      {
        name: 'mirth_export_channel',
        description: 'Export a channel XML to a local file. Use this to work with large channel configs without token issues.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID or name to export',
            },
            filePath: {
              type: 'string',
              description: 'Destination file path (e.g., ./channels/my-channel.xml)',
            },
            includeMetadata: {
              type: 'boolean',
              description: 'Include a .meta.json file with channel info',
              default: true,
            },
          },
          required: ['channelId', 'filePath'],
        },
      },
      {
        name: 'mirth_import_channel',
        description: 'Import/update a channel from a local XML file. Creates backup before update.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Source XML file path',
            },
            deploy: {
              type: 'boolean',
              description: 'Deploy the channel after import',
              default: false,
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token for safety',
            },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'mirth_export_code_template_library',
        description: 'Export a code template library to a local file.',
        inputSchema: {
          type: 'object',
          properties: {
            libraryId: {
              type: 'string',
              description: 'The library ID to export',
            },
            filePath: {
              type: 'string',
              description: 'Destination file path',
            },
          },
          required: ['libraryId', 'filePath'],
        },
      },
      {
        name: 'mirth_list_exported_files',
        description: 'List exported channel/template files in a directory.',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Directory to scan (default: ./exports)',
              default: './exports',
            },
          },
        },
      },
      {
        name: 'mirth_export_code_template',
        description: 'Export a single code template to a local XML file.',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: {
              type: 'string',
              description: 'The code template ID to export',
            },
            filePath: {
              type: 'string',
              description: 'Destination file path (e.g., ./exports/templates/my-template.xml)',
            },
          },
          required: ['templateId', 'filePath'],
        },
      },
      {
        name: 'mirth_import_code_template',
        description: 'Import/update a single code template from a local XML file. Does NOT affect other templates.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Source XML file path',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token for safety',
            },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'mirth_import_code_template_library',
        description: 'Import/update a code template library. WARNING: This replaces ALL libraries, so it merges the imported library with existing ones.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Source XML file path for the library',
            },
            confirmationToken: {
              type: 'string',
              description: 'Confirmation token for safety',
            },
          },
          required: ['filePath'],
        },
      },

      // === Validation & Testing Tools ===
      {
        name: 'mirth_validate_channel_xml',
        description: 'Validate channel XML structure before deployment.',
        inputSchema: {
          type: 'object',
          properties: {
            channelXml: {
              type: 'string',
              description: 'The channel XML to validate',
            },
          },
          required: ['channelXml'],
        },
      },
      {
        name: 'mirth_analyze_channel',
        description: 'Analyze a channel configuration for potential issues and best practices.',
        inputSchema: {
          type: 'object',
          properties: {
            channelId: {
              type: 'string',
              description: 'The channel ID to analyze',
            },
          },
          required: ['channelId'],
        },
      },

      // === Safety & Confirmation ===
      {
        name: 'mirth_confirm_action',
        description: 'Confirm a pending destructive action using its token.',
        inputSchema: {
          type: 'object',
          properties: {
            confirmationToken: {
              type: 'string',
              description: 'The confirmation token',
            },
          },
          required: ['confirmationToken'],
        },
      },
      {
        name: 'mirth_cancel_action',
        description: 'Cancel a pending destructive action.',
        inputSchema: {
          type: 'object',
          properties: {
            confirmationToken: {
              type: 'string',
              description: 'The confirmation token to cancel',
            },
          },
          required: ['confirmationToken'],
        },
      },

      // === Dataset Query Tools ===
      {
        name: 'dataset_query',
        description: 'Query a stored dataset with filters, pagination, and search. Use this after receiving a datasetId from tools like mirth_get_channel_messages or mirth_get_server_logs.',
        inputSchema: {
          type: 'object',
          properties: {
            datasetId: {
              type: 'string',
              description: 'The dataset ID returned by a previous data fetch',
            },
            page: {
              type: 'number',
              description: 'Page number (1-based). Default: 1',
              default: 1,
            },
            pageSize: {
              type: 'number',
              description: 'Items per page (max 50). Default: 50',
              default: 50,
            },
            sortBy: {
              type: 'string',
              description: 'Field name to sort by (e.g., "id", "receivedDate", "status")',
            },
            sortOrder: {
              type: 'string',
              enum: ['asc', 'desc'],
              description: 'Sort order. Default: desc (newest first)',
              default: 'desc',
            },
            filters: {
              type: 'object',
              description: 'Field filters as key-value pairs (e.g., {"status": "ERROR", "level": "ERROR"})',
            },
            search: {
              type: 'string',
              description: 'Text search across all fields',
            },
            ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Get specific items by their IDs',
            },
          },
          required: ['datasetId'],
        },
      },
      {
        name: 'dataset_get_item',
        description: 'Get a single item by ID from a stored dataset. Use this to get full details of a specific message, log entry, or event.',
        inputSchema: {
          type: 'object',
          properties: {
            datasetId: {
              type: 'string',
              description: 'The dataset ID',
            },
            itemId: {
              type: 'number',
              description: 'The item ID (messageId, log id, event id, etc.)',
            },
          },
          required: ['datasetId', 'itemId'],
        },
      },
      {
        name: 'dataset_list',
        description: 'List all active datasets with their metadata. Useful to see what data is available for querying.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'dataset_info',
        description: 'Get detailed information about a specific dataset including summary statistics.',
        inputSchema: {
          type: 'object',
          properties: {
            datasetId: {
              type: 'string',
              description: 'The dataset ID',
            },
          },
          required: ['datasetId'],
        },
      },
    ];
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to Mirth Connect. Please call mirth_connect first.');
    }
  }

  private generateConfirmationToken(): string {
    return `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private requireConfirmation(action: string, params: Record<string, unknown>): TextContent[] {
    if (!this.config.requireConfirmation) {
      return [];
    }

    const token = this.generateConfirmationToken();
    pendingConfirmations.set(token, {
      action,
      params,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return [{
      type: 'text',
      text: JSON.stringify({
        status: 'confirmation_required',
        message: `This action requires confirmation. Action: ${action}`,
        confirmationToken: token,
        expiresIn: '5 minutes',
        instructions: 'Call the same tool again with the confirmationToken parameter to proceed, or call mirth_cancel_action to cancel.',
      }, null, 2),
    }];
  }

  private async handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: TextContent[] }> {
    try {
      const result = await this.executeToolCall(name, args);
      return {
        content: [{
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    }
  }

  private async executeToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      // === Connection ===
      case 'mirth_connect': {
        await this.mirthClient.login();
        this.isConnected = true;
        const info = await this.mirthClient.getServerInfo();
        return { status: 'connected', serverInfo: info };
      }

      case 'mirth_disconnect': {
        await this.mirthClient.logout();
        this.isConnected = false;
        return { status: 'disconnected' };
      }

      case 'mirth_server_info': {
        await this.ensureConnected();
        const [info, status] = await Promise.all([
          this.mirthClient.getServerInfo(),
          this.mirthClient.getServerStatus(),
        ]);
        return { info, status };
      }

      // === Channels ===
      case 'mirth_list_channels': {
        await this.ensureConnected();
        const rawChannels = await this.mirthClient.getChannels();

        // Extract only essential fields to reduce token usage
        const channelArray = Array.isArray(rawChannels) ? rawChannels : [rawChannels];
        const channels = channelArray.map((ch) => ({
          id: ch.id,
          name: ch.name,
          description: ch.description || '',
          revision: ch.revision,
          enabled: ch.enabled ?? true
        }));

        let statuses: unknown[] = [];
        let statistics: unknown[] = [];

        if (args.includeStatus) {
          statuses = await this.mirthClient.getChannelStatuses();
        }
        if (args.includeStats) {
          statistics = await this.mirthClient.getChannelStatistics();
        }

        return { channels, statuses, statistics };
      }

      case 'mirth_get_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;
        if (args.format === 'xml') {
          return await this.mirthClient.getChannelXml(channelId);
        }
        return await this.mirthClient.getChannel(channelId);
      }

      case 'mirth_deploy_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;

        // Backup before deploy
        const channelXml = await this.mirthClient.getChannelXml(channelId);
        const channel = await this.mirthClient.getChannel(channelId);
        await this.backupManager.createBackup(
          'channel',
          channelId,
          (channel as Record<string, string>).name || channelId,
          channelXml,
          'Auto-backup before deploy'
        );

        await this.mirthClient.deployChannel(channelId);
        return { status: 'deployed', channelId };
      }

      case 'mirth_undeploy_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;

        // Backup before undeploy
        const channelXml = await this.mirthClient.getChannelXml(channelId);
        const channel = await this.mirthClient.getChannel(channelId);
        await this.backupManager.createBackup(
          'channel',
          channelId,
          (channel as Record<string, string>).name || channelId,
          channelXml,
          'Auto-backup before undeploy'
        );

        await this.mirthClient.undeployChannel(channelId);
        return { status: 'undeployed', channelId };
      }

      case 'mirth_start_channel': {
        await this.ensureConnected();
        await this.mirthClient.startChannel(args.channelId as string);
        return { status: 'started', channelId: args.channelId };
      }

      case 'mirth_stop_channel': {
        await this.ensureConnected();
        await this.mirthClient.stopChannel(args.channelId as string);
        return { status: 'stopped', channelId: args.channelId };
      }

      case 'mirth_update_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;
        const channelXml = args.channelXml as string;

        // Check for confirmation
        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: 'Channel update requires confirmation.',
            action: 'update_channel',
            channelId,
            instructions: 'Call mirth_update_channel again with the same parameters plus confirmationToken to proceed.',
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        // Backup current version first
        const currentXml = await this.mirthClient.getChannelXml(channelId);
        const currentChannel = await this.mirthClient.getChannel(channelId);
        await this.backupManager.createBackup(
          'channel',
          channelId,
          (currentChannel as Record<string, string>).name || channelId,
          currentXml,
          'Auto-backup before update'
        );

        await this.mirthClient.updateChannel(channelId, channelXml, true);
        return { status: 'updated', channelId, backupCreated: true };
      }

      case 'mirth_delete_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;

        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: 'Channel deletion requires confirmation. This action cannot be undone (but a backup will be created).',
            action: 'delete_channel',
            channelId,
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        // Backup before delete
        const channelXml = await this.mirthClient.getChannelXml(channelId);
        const channel = await this.mirthClient.getChannel(channelId);
        const backup = await this.backupManager.createBackup(
          'channel',
          channelId,
          (channel as Record<string, string>).name || channelId,
          channelXml,
          'Auto-backup before deletion'
        );

        await this.mirthClient.deleteChannel(channelId);
        return {
          status: 'deleted',
          channelId,
          backupId: backup.metadata.id,
          message: `Channel deleted. Backup created with ID: ${backup.metadata.id}. Use mirth_restore_backup to recover if needed.`,
        };
      }

      // === Code Templates ===
      case 'mirth_list_code_templates': {
        await this.ensureConnected();
        const libraries = await this.mirthClient.getCodeTemplateLibraries();
        const templates = await this.mirthClient.getCodeTemplates();
        return { libraries, templates };
      }

      case 'mirth_get_code_template': {
        await this.ensureConnected();
        const templateId = args.templateId as string;
        if (args.format === 'xml') {
          return await this.mirthClient.getCodeTemplateXml(templateId);
        }
        return await this.mirthClient.getCodeTemplate(templateId);
      }

      case 'mirth_get_code_template_library': {
        await this.ensureConnected();
        const libraryId = args.libraryId as string;
        if (args.format === 'xml') {
          return await this.mirthClient.getCodeTemplateLibraryXml(libraryId);
        }
        return await this.mirthClient.getCodeTemplateLibrary(libraryId);
      }

      // === Troubleshooting ===
      case 'mirth_get_events': {
        await this.ensureConnected();
        const events = await this.mirthClient.getEvents({
          level: args.level as string | undefined,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate as string | undefined,
          name: args.name as string | undefined,
          limit: (args.limit as number) || 200, // Fetch more for dataset
        });

        // Store in dataset manager
        const eventsArray = Array.isArray(events) ? events : [events];
        const metadata = datasetManager.store('events', eventsArray, {
          idField: 'id',
        });

        return {
          datasetId: metadata.id,
          totalEvents: metadata.totalCount,
          totalPages: metadata.totalPages,
          pageSize: metadata.pageSize,
          expiresAt: metadata.expiresAt.toISOString(),
          summary: metadata.summary,
          hint: 'Use dataset_query to filter by level, outcome, name, or search text.',
        };
      }

      case 'mirth_get_channel_messages': {
        await this.ensureConnected();
        const channelId = args.channelId as string;

        // Get channel name for context
        let channelName = channelId;
        try {
          const channel = await this.mirthClient.getChannel(channelId) as Record<string, string>;
          channelName = channel.name || channelId;
        } catch {
          // Ignore - use channelId as name
        }

        const messages = await this.mirthClient.getMessages(channelId, {
          status: args.status as string | undefined,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate as string | undefined,
          limit: (args.limit as number) || 100, // Fetch more for dataset
          includeContent: true, // Always fetch full content for dataset storage
        });

        // Store in dataset manager
        const messagesArray = Array.isArray(messages) ? messages : [messages];
        const metadata = datasetManager.store('messages', messagesArray, {
          channelId,
          channelName,
          idField: 'messageId',
        });

        return {
          datasetId: metadata.id,
          channelId,
          channelName,
          totalMessages: metadata.totalCount,
          totalPages: metadata.totalPages,
          pageSize: metadata.pageSize,
          expiresAt: metadata.expiresAt.toISOString(),
          summary: metadata.summary,
          hint: 'Use dataset_query to browse messages, dataset_get_item to get full message content.',
        };
      }

      case 'mirth_get_message_content': {
        await this.ensureConnected();
        return await this.mirthClient.getMessageContent(
          args.channelId as string,
          args.messageId as number,
          (args.metaDataId as number) || 0
        );
      }

      case 'mirth_get_channel_statistics': {
        await this.ensureConnected();
        if (args.channelId) {
          return await this.mirthClient.getChannelStatistic(args.channelId as string);
        }
        return await this.mirthClient.getChannelStatistics();
      }

      case 'mirth_reprocess_message': {
        await this.ensureConnected();
        await this.mirthClient.reprocessMessage(
          args.channelId as string,
          args.messageId as number,
          args.replace as boolean || false
        );
        return { status: 'reprocessed', channelId: args.channelId, messageId: args.messageId };
      }

      // === Global Scripts ===
      case 'mirth_get_global_scripts': {
        await this.ensureConnected();
        if (args.format === 'xml') {
          return await this.mirthClient.getGlobalScriptsXml();
        }
        return await this.mirthClient.getGlobalScripts();
      }

      case 'mirth_update_global_scripts': {
        await this.ensureConnected();
        const scriptsXml = args.scriptsXml as string;

        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: 'Global scripts update requires confirmation.',
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        // Backup current scripts
        const currentScripts = await this.mirthClient.getGlobalScriptsXml();
        await this.backupManager.createBackup(
          'globalScripts',
          'global',
          'GlobalScripts',
          currentScripts,
          'Auto-backup before update'
        );

        await this.mirthClient.updateGlobalScripts(scriptsXml);
        return { status: 'updated', backupCreated: true };
      }

      case 'mirth_get_configuration_map': {
        await this.ensureConnected();
        return await this.mirthClient.getConfigurationMap();
      }

      // === Server Logs & Maps ===
      case 'mirth_get_server_logs': {
        await this.ensureConnected();
        const logs = await this.mirthClient.getServerLogs({
          fetchSize: (args.fetchSize as number) || 200, // Fetch more for dataset
          lastLogId: args.lastLogId as number | undefined,
        });

        // Store in dataset manager
        const logsArray = Array.isArray(logs) ? logs : [logs];
        const metadata = datasetManager.store('serverLogs', logsArray, {
          idField: 'id',
        });

        return {
          datasetId: metadata.id,
          totalLogs: metadata.totalCount,
          totalPages: metadata.totalPages,
          pageSize: metadata.pageSize,
          expiresAt: metadata.expiresAt.toISOString(),
          summary: metadata.summary,
          hint: 'Use dataset_query to browse logs with filters (level, search), dataset_get_item for full log entry.',
        };
      }

      case 'mirth_get_connection_logs': {
        await this.ensureConnected();
        const logs = await this.mirthClient.getConnectionLogs({
          fetchSize: (args.fetchSize as number) || 200,
          serverId: args.serverId as string | undefined,
          lastLogId: args.lastLogId as number | undefined,
        });

        const logsArray = Array.isArray(logs) ? logs : [logs];
        const metadata = datasetManager.store('connectionLogs', logsArray, {
          idField: 'id',
        });

        return {
          datasetId: metadata.id,
          totalLogs: metadata.totalCount,
          totalPages: metadata.totalPages,
          pageSize: metadata.pageSize,
          expiresAt: metadata.expiresAt.toISOString(),
          summary: metadata.summary,
          hint: 'Use dataset_query to filter by channelName, eventState, or search text.',
        };
      }

      case 'mirth_get_channel_connection_logs': {
        await this.ensureConnected();
        const channelId = args.channelId as string;
        const logs = await this.mirthClient.getChannelConnectionLogs(
          channelId,
          {
            fetchSize: (args.fetchSize as number) || 200,
            serverId: args.serverId as string | undefined,
            lastLogId: args.lastLogId as number | undefined,
          }
        );

        const logsArray = Array.isArray(logs) ? logs : [logs];
        const metadata = datasetManager.store('connectionLogs', logsArray, {
          channelId,
          idField: 'id',
        });

        return {
          datasetId: metadata.id,
          channelId,
          totalLogs: metadata.totalCount,
          totalPages: metadata.totalPages,
          pageSize: metadata.pageSize,
          expiresAt: metadata.expiresAt.toISOString(),
          summary: metadata.summary,
          hint: 'Use dataset_query to filter by eventState or search text.',
        };
      }

      case 'mirth_get_global_map': {
        await this.ensureConnected();
        return await this.mirthClient.getGlobalMap();
      }

      case 'mirth_get_channel_map': {
        await this.ensureConnected();
        return await this.mirthClient.getChannelMap(args.channelId as string);
      }

      case 'mirth_get_all_maps': {
        await this.ensureConnected();
        return await this.mirthClient.getAllMaps({
          channelIds: args.channelIds as string[] | undefined,
          includeGlobalMap: args.includeGlobalMap as boolean | undefined,
        });
      }

      // === Backup & Recovery ===
      case 'mirth_backup_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;
        const channelXml = await this.mirthClient.getChannelXml(channelId);
        const channel = await this.mirthClient.getChannel(channelId);
        const backup = await this.backupManager.createBackup(
          'channel',
          channelId,
          (channel as Record<string, string>).name || channelId,
          channelXml,
          args.description as string | undefined
        );
        return {
          status: 'backed_up',
          backupId: backup.metadata.id,
          timestamp: backup.metadata.timestamp,
          path: backup.path,
        };
      }

      case 'mirth_backup_code_template': {
        await this.ensureConnected();
        const templateId = args.templateId as string;
        const templateXml = await this.mirthClient.getCodeTemplateXml(templateId);
        const template = await this.mirthClient.getCodeTemplate(templateId);
        const backup = await this.backupManager.createBackup(
          'codeTemplate',
          templateId,
          (template as Record<string, string>).name || templateId,
          templateXml,
          args.description as string | undefined
        );
        return {
          status: 'backed_up',
          backupId: backup.metadata.id,
          timestamp: backup.metadata.timestamp,
        };
      }

      case 'mirth_list_backups': {
        const backups = await this.backupManager.listBackups(
          args.type as 'channel' | 'codeTemplate' | 'codeTemplateLibrary' | 'globalScripts' | 'full' | undefined,
          args.resourceId as string | undefined
        );
        return backups.map(b => b.metadata);
      }

      case 'mirth_get_backup': {
        const backup = await this.backupManager.getBackup(args.backupId as string);
        if (!backup) {
          throw new Error(`Backup not found: ${args.backupId}`);
        }
        return backup;
      }

      case 'mirth_restore_backup': {
        await this.ensureConnected();
        const backupId = args.backupId as string;

        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: 'Backup restoration requires confirmation. Current state will be backed up first.',
            backupId,
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        const backup = await this.backupManager.getBackup(backupId);
        if (!backup) {
          throw new Error(`Backup not found: ${backupId}`);
        }

        const { metadata, content } = backup;

        // Backup current state before restore
        if (metadata.type === 'channel') {
          const currentXml = await this.mirthClient.getChannelXml(metadata.resourceId);
          const currentChannel = await this.mirthClient.getChannel(metadata.resourceId);
          await this.backupManager.createBackup(
            'channel',
            metadata.resourceId,
            (currentChannel as Record<string, string>).name || metadata.resourceId,
            currentXml,
            `Auto-backup before restore from ${backupId}`
          );
          await this.mirthClient.updateChannel(metadata.resourceId, content, true);
        } else if (metadata.type === 'globalScripts') {
          const currentScripts = await this.mirthClient.getGlobalScriptsXml();
          await this.backupManager.createBackup(
            'globalScripts',
            'global',
            'GlobalScripts',
            currentScripts,
            `Auto-backup before restore from ${backupId}`
          );
          await this.mirthClient.updateGlobalScripts(content);
        } else {
          throw new Error(`Restore not supported for backup type: ${metadata.type}`);
        }

        return { status: 'restored', backupId, resourceId: metadata.resourceId };
      }

      case 'mirth_compare_backups': {
        return await this.backupManager.compareBackups(
          args.backupId1 as string,
          args.backupId2 as string
        );
      }

      case 'mirth_backup_stats': {
        return await this.backupManager.getBackupStats();
      }

      // === File Export/Import ===
      case 'mirth_export_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;
        const filePath = args.filePath as string;
        const includeMetadata = args.includeMetadata !== false;

        // Get channel XML and metadata
        const channelXml = await this.mirthClient.getChannelXml(channelId);
        const channel = await this.mirthClient.getChannel(channelId) as Record<string, unknown>;

        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        // Write XML file
        await fs.writeFile(filePath, channelXml, 'utf-8');

        // Write metadata file if requested
        let metadataPath: string | undefined;
        if (includeMetadata) {
          metadataPath = filePath.replace(/\.xml$/i, '.meta.json');
          const metadata = {
            channelId: channel.id,
            name: channel.name,
            description: channel.description,
            revision: channel.revision,
            exportedAt: new Date().toISOString(),
            xmlSize: channelXml.length,
          };
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
        }

        return {
          status: 'exported',
          channelId,
          channelName: channel.name,
          filePath: path.resolve(filePath),
          metadataPath: metadataPath ? path.resolve(metadataPath) : undefined,
          xmlSize: channelXml.length,
          message: `Channel exported to ${filePath}. You can now read/edit the file directly.`,
        };
      }

      case 'mirth_import_channel': {
        await this.ensureConnected();
        const filePath = args.filePath as string;
        const deploy = args.deploy as boolean || false;

        // Read XML file
        const channelXml = await fs.readFile(filePath, 'utf-8');

        // Extract channel ID from XML
        const idMatch = channelXml.match(/<id>([^<]+)<\/id>/);
        if (!idMatch) {
          throw new Error('Could not find channel ID in XML file');
        }
        const channelId = idMatch[1];

        // Check for confirmation
        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: `Channel import requires confirmation. Will update channel ${channelId} from file.`,
            action: 'import_channel',
            channelId,
            filePath,
            deploy,
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        // Try to backup existing channel first
        try {
          const existingXml = await this.mirthClient.getChannelXml(channelId);
          const existingChannel = await this.mirthClient.getChannel(channelId) as Record<string, string>;
          await this.backupManager.createBackup(
            'channel',
            channelId,
            existingChannel.name || channelId,
            existingXml,
            `Auto-backup before import from ${path.basename(filePath)}`
          );
        } catch {
          // Channel might not exist yet, that's ok
        }

        // Update or create channel
        await this.mirthClient.updateChannel(channelId, channelXml, true);

        // Deploy if requested
        if (deploy) {
          await this.mirthClient.deployChannel(channelId);
        }

        return {
          status: 'imported',
          channelId,
          deployed: deploy,
          filePath: path.resolve(filePath),
          message: deploy
            ? `Channel imported and deployed from ${filePath}`
            : `Channel imported from ${filePath}. Use mirth_deploy_channel to deploy.`,
        };
      }

      case 'mirth_export_code_template_library': {
        await this.ensureConnected();
        const libraryId = args.libraryId as string;
        const filePath = args.filePath as string;

        const libraryXml = await this.mirthClient.getCodeTemplateLibraryXml(libraryId);
        const library = await this.mirthClient.getCodeTemplateLibrary(libraryId);

        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, libraryXml, 'utf-8');

        // Write metadata
        const metadataPath = filePath.replace(/\.xml$/i, '.meta.json');
        const metadata = {
          libraryId: library.id,
          name: library.name,
          description: library.description,
          templateCount: library.codeTemplates?.length || 0,
          exportedAt: new Date().toISOString(),
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

        return {
          status: 'exported',
          libraryId,
          libraryName: library.name,
          filePath: path.resolve(filePath),
          metadataPath: path.resolve(metadataPath),
          templateCount: library.codeTemplates?.length || 0,
        };
      }

      case 'mirth_list_exported_files': {
        const directory = (args.directory as string) || './exports';

        try {
          await fs.access(directory);
        } catch {
          return { files: [], message: `Directory ${directory} does not exist yet.` };
        }

        const entries = await fs.readdir(directory, { withFileTypes: true });
        const files: Array<{
          name: string;
          path: string;
          type: 'channel' | 'library' | 'template' | 'unknown';
          metadata?: Record<string, unknown>;
        }> = [];

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.xml')) {
            const xmlPath = path.join(directory, entry.name);
            const metaPath = xmlPath.replace(/\.xml$/i, '.meta.json');

            let metadata: Record<string, unknown> | undefined;
            try {
              const metaContent = await fs.readFile(metaPath, 'utf-8');
              metadata = JSON.parse(metaContent);
            } catch {
              // No metadata file
            }

            let fileType: 'channel' | 'library' | 'template' | 'unknown' = 'unknown';
            if (metadata?.channelId) fileType = 'channel';
            else if (metadata?.libraryId) fileType = 'library';
            else if (metadata?.templateId) fileType = 'template';

            files.push({
              name: entry.name,
              path: path.resolve(xmlPath),
              type: fileType,
              metadata,
            });
          }
        }

        return { directory: path.resolve(directory), files, count: files.length };
      }

      case 'mirth_export_code_template': {
        await this.ensureConnected();
        const templateId = args.templateId as string;
        const filePath = args.filePath as string;

        const templateXml = await this.mirthClient.getCodeTemplateXml(templateId);
        const template = await this.mirthClient.getCodeTemplate(templateId) as Record<string, unknown>;

        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, templateXml, 'utf-8');

        // Write metadata
        const metadataPath = filePath.replace(/\.xml$/i, '.meta.json');
        const metadata = {
          templateId: template.id,
          name: template.name,
          type: template.type,
          revision: template.revision,
          exportedAt: new Date().toISOString(),
          xmlSize: templateXml.length,
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

        return {
          status: 'exported',
          templateId,
          templateName: template.name,
          filePath: path.resolve(filePath),
          metadataPath: path.resolve(metadataPath),
          xmlSize: templateXml.length,
        };
      }

      case 'mirth_import_code_template': {
        await this.ensureConnected();
        const filePath = args.filePath as string;

        // Read XML file
        const templateXml = await fs.readFile(filePath, 'utf-8');

        // Extract template ID from XML
        const idMatch = templateXml.match(/<id>([^<]+)<\/id>/);
        if (!idMatch) {
          throw new Error('Could not find template ID in XML file');
        }
        const templateId = idMatch[1];

        // Check for confirmation
        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: `Code template import requires confirmation. Will update template ${templateId}.`,
            action: 'import_code_template',
            templateId,
            filePath,
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        // Backup existing template if it exists
        try {
          const existingXml = await this.mirthClient.getCodeTemplateXml(templateId);
          const existingTemplate = await this.mirthClient.getCodeTemplate(templateId) as Record<string, string>;
          await this.backupManager.createBackup(
            'codeTemplate',
            templateId,
            existingTemplate.name || templateId,
            existingXml,
            `Auto-backup before import from ${path.basename(filePath)}`
          );
        } catch {
          // Template might not exist yet
        }

        // Update the single code template (does NOT affect others)
        await this.mirthClient.updateCodeTemplate(templateId, templateXml, true);

        return {
          status: 'imported',
          templateId,
          filePath: path.resolve(filePath),
          message: `Code template imported from ${filePath}. Other templates were NOT affected.`,
        };
      }

      case 'mirth_import_code_template_library': {
        await this.ensureConnected();
        const filePath = args.filePath as string;

        // Read library XML from file
        const libraryXml = await fs.readFile(filePath, 'utf-8');

        // Extract library ID from XML
        const idMatch = libraryXml.match(/<id>([^<]+)<\/id>/);
        if (!idMatch) {
          throw new Error('Could not find library ID in XML file');
        }
        const libraryId = idMatch[1];

        // Check for confirmation
        if (this.config.requireConfirmation && !args.confirmationToken) {
          return {
            status: 'confirmation_required',
            message: `Library import requires confirmation. Will merge library ${libraryId} with existing libraries.`,
            action: 'import_code_template_library',
            libraryId,
            filePath,
            warning: 'This operation will backup and replace ALL libraries. The imported library will be merged with existing ones.',
            confirmationToken: this.generateConfirmationToken(),
          };
        }

        // CRITICAL: Get ALL existing libraries first
        const allLibrariesXml = await this.mirthClient.getAllCodeTemplateLibrariesXml(true);

        // Backup all libraries before modification
        await this.backupManager.createBackup(
          'codeTemplateLibrary',
          'all-libraries',
          'AllCodeTemplateLibraries',
          allLibrariesXml,
          `Auto-backup before importing library from ${path.basename(filePath)}`
        );

        // Parse existing libraries and merge with imported one
        // Strategy: Replace library with same ID, or add if new
        let mergedXml: string;

        if (allLibrariesXml.includes(`<id>${libraryId}</id>`)) {
          // Library exists - replace it in the list
          // Find and replace the library block
          const libraryRegex = new RegExp(
            `<codeTemplateLibrary[^>]*>\\s*<id>${libraryId}</id>[\\s\\S]*?</codeTemplateLibrary>`,
            'g'
          );

          // Extract just the library content from the imported file
          const importedLibraryMatch = libraryXml.match(/<codeTemplateLibrary[^>]*>[\s\S]*<\/codeTemplateLibrary>/);
          if (!importedLibraryMatch) {
            throw new Error('Invalid library XML format');
          }

          mergedXml = allLibrariesXml.replace(libraryRegex, importedLibraryMatch[0]);
        } else {
          // Library is new - add it to the list
          const importedLibraryMatch = libraryXml.match(/<codeTemplateLibrary[^>]*>[\s\S]*<\/codeTemplateLibrary>/);
          if (!importedLibraryMatch) {
            throw new Error('Invalid library XML format');
          }

          // Insert before closing </list> tag
          mergedXml = allLibrariesXml.replace('</list>', `${importedLibraryMatch[0]}\n</list>`);
        }

        // Update all libraries with the merged version
        await this.mirthClient.updateAllCodeTemplateLibraries(mergedXml, true);

        return {
          status: 'imported',
          libraryId,
          filePath: path.resolve(filePath),
          message: `Library imported and merged. Other libraries were preserved. Backup created.`,
        };
      }

      // === Validation ===
      case 'mirth_validate_channel_xml': {
        const channelXml = args.channelXml as string;
        const issues: string[] = [];

        // Basic XML validation
        if (!channelXml.includes('<channel')) {
          issues.push('Missing <channel> root element');
        }
        if (!channelXml.includes('<id>')) {
          issues.push('Missing channel ID');
        }
        if (!channelXml.includes('<name>')) {
          issues.push('Missing channel name');
        }
        if (!channelXml.includes('<sourceConnector>')) {
          issues.push('Missing source connector');
        }

        // Check for common issues
        if (channelXml.includes('password>') && !channelXml.includes('encrypted>')) {
          issues.push('Warning: Possible unencrypted password in configuration');
        }

        return {
          valid: issues.length === 0,
          issues,
          xmlLength: channelXml.length,
        };
      }

      case 'mirth_analyze_channel': {
        await this.ensureConnected();
        const channelId = args.channelId as string;
        const channel = await this.mirthClient.getChannel(channelId) as Record<string, unknown>;
        const channelXml = await this.mirthClient.getChannelXml(channelId);
        const stats = await this.mirthClient.getChannelStatistic(channelId);
        let status;
        try {
          status = await this.mirthClient.getChannelStatus(channelId);
        } catch {
          status = { state: 'UNKNOWN' };
        }

        const analysis: Record<string, unknown> = {
          channelId,
          name: channel.name,
          status: status,
          statistics: stats,
          recommendations: [] as string[],
        };

        const recommendations = analysis.recommendations as string[];

        // Analyze for common issues
        if (stats.error > 0) {
          recommendations.push(`Channel has ${stats.error} error(s). Review error messages for troubleshooting.`);
        }
        if (stats.queued > 100) {
          recommendations.push(`Channel has ${stats.queued} queued messages. Consider reviewing destination performance.`);
        }
        if (channelXml.includes('logger.info') || channelXml.includes('logger.debug')) {
          recommendations.push('Channel uses logging. Ensure appropriate log levels for production.');
        }
        if (channelXml.includes('globalMap.put')) {
          recommendations.push('Channel uses globalMap. Ensure proper cleanup to avoid memory issues.');
        }

        return analysis;
      }

      // === Safety ===
      case 'mirth_confirm_action': {
        const token = args.confirmationToken as string;
        const pending = pendingConfirmations.get(token);

        if (!pending) {
          throw new Error('Invalid or expired confirmation token');
        }

        if (Date.now() > pending.expiresAt) {
          pendingConfirmations.delete(token);
          throw new Error('Confirmation token has expired');
        }

        pendingConfirmations.delete(token);
        return { status: 'confirmed', action: pending.action };
      }

      case 'mirth_cancel_action': {
        const token = args.confirmationToken as string;
        const deleted = pendingConfirmations.delete(token);
        return { status: deleted ? 'cancelled' : 'not_found' };
      }

      // === Dataset Query Tools ===
      case 'dataset_query': {
        const query: DatasetQuery = {
          datasetId: args.datasetId as string,
          page: args.page as number | undefined,
          pageSize: args.pageSize as number | undefined,
          sortBy: args.sortBy as string | undefined,
          sortOrder: args.sortOrder as 'asc' | 'desc' | undefined,
          filters: args.filters as Record<string, unknown> | undefined,
          search: args.search as string | undefined,
          ids: args.ids as number[] | undefined,
        };

        const result = datasetManager.query(query);

        return {
          ...result,
          hint: result.hasNext
            ? `More pages available. Use page: ${result.page + 1} for next page.`
            : 'This is the last page.',
        };
      }

      case 'dataset_get_item': {
        const datasetId = args.datasetId as string;
        const itemId = args.itemId as number;
        const item = datasetManager.getById(datasetId, itemId);

        if (!item) {
          return {
            error: true,
            message: `Item with ID ${itemId} not found in dataset ${datasetId}`,
          };
        }

        return {
          datasetId,
          itemId,
          item,
        };
      }

      case 'dataset_list': {
        const datasets = datasetManager.listDatasets();

        return {
          activeDatasets: datasets.length,
          datasets: datasets.map(d => ({
            id: d.id,
            type: d.type,
            channelId: d.channelId,
            channelName: d.channelName,
            totalCount: d.totalCount,
            createdAt: d.createdAt.toISOString(),
            expiresAt: d.expiresAt.toISOString(),
            summary: {
              dateRange: d.summary.dateRange,
              statusCounts: d.summary.statusCounts,
              levelCounts: d.summary.levelCounts,
              errorCount: d.summary.errorCount,
            },
          })),
        };
      }

      case 'dataset_info': {
        const datasetId = args.datasetId as string;
        const metadata = datasetManager.getMetadata(datasetId);

        if (!metadata) {
          return {
            error: true,
            message: `Dataset not found: ${datasetId}. It may have expired.`,
          };
        }

        return {
          id: metadata.id,
          type: metadata.type,
          channelId: metadata.channelId,
          channelName: metadata.channelName,
          totalCount: metadata.totalCount,
          totalPages: metadata.totalPages,
          pageSize: metadata.pageSize,
          createdAt: metadata.createdAt.toISOString(),
          expiresAt: metadata.expiresAt.toISOString(),
          summary: metadata.summary,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleResourceRead(uri: string): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    try {
      let content: unknown;

      switch (uri) {
        case 'mirth://server/info':
          await this.ensureConnected();
          content = await this.mirthClient.getServerInfo();
          break;

        case 'mirth://channels/list':
          await this.ensureConnected();
          const channels = await this.mirthClient.getChannels();
          const statuses = await this.mirthClient.getChannelStatuses();
          content = { channels, statuses };
          break;

        case 'mirth://backups/stats':
          content = await this.backupManager.getBackupStats();
          break;

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(content, null, 2),
        }],
      };
    } catch (error) {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Mirth Connect MCP Server running on stdio');
  }
}

// Main entry point
const server = new MirthConnectMCPServer();
server.run().catch(console.error);
