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
        const channels = await this.mirthClient.getChannels();
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
        return await this.mirthClient.getEvents({
          level: args.level as string | undefined,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate as string | undefined,
          name: args.name as string | undefined,
          limit: args.limit as number | undefined,
        });
      }

      case 'mirth_get_channel_messages': {
        await this.ensureConnected();
        return await this.mirthClient.getMessages(args.channelId as string, {
          status: args.status as string | undefined,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate as string | undefined,
          limit: args.limit as number | undefined,
          includeContent: args.includeContent as boolean | undefined,
        });
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
