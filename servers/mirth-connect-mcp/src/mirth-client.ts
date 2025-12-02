// Mirth Connect API Client
import axios, { AxiosInstance, AxiosError } from 'axios';
import https from 'https';
import { MirthConfig } from './config.js';

export interface Channel {
  id: string;
  name: string;
  description?: string;
  revision?: number;
  enabled?: boolean;
  lastModified?: string;
}

export interface ChannelStatus {
  channelId: string;
  name: string;
  state: 'STARTED' | 'STOPPED' | 'PAUSED' | 'DEPLOYING' | 'UNDEPLOYING';
  deployedRevisionDelta?: number;
  deployedDate?: string;
}

export interface ChannelStatistics {
  channelId: string;
  received: number;
  sent: number;
  error: number;
  filtered: number;
  queued: number;
}

export interface CodeTemplate {
  id: string;
  name: string;
  revision?: number;
  lastModified?: string;
  type: string;
  code?: string;
}

export interface CodeTemplateLibrary {
  id: string;
  name: string;
  revision?: number;
  description?: string;
  codeTemplates?: CodeTemplate[];
}

export interface ServerEvent {
  id: number;
  level: 'INFORMATION' | 'WARNING' | 'ERROR';
  name: string;
  outcome: string;
  dateTime: string;
  userId?: string;
  ipAddress?: string;
  attributes?: Record<string, string>;
}

export interface MessageSearchResult {
  messageId: number;
  serverId: string;
  channelId: string;
  receivedDate: string;
  processed: boolean;
  connectorMessages?: ConnectorMessage[];
}

export interface ConnectorMessage {
  messageId: number;
  metaDataId: number;
  channelId: string;
  connectorName: string;
  status: 'RECEIVED' | 'TRANSFORMED' | 'FILTERED' | 'QUEUED' | 'SENT' | 'ERROR';
  rawData?: string;
  transformedData?: string;
  encodedData?: string;
  responseData?: string;
  errors?: string;
  processingError?: string;
}

export class MirthClient {
  private client: AxiosInstance;
  private sessionCookie: string | null = null;

  constructor(private config: MirthConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.rejectUnauthorized
      }),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 30000
    });

    // Add response interceptor for session management
    this.client.interceptors.response.use(
      response => {
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
          const jsessionid = setCookie.find(c => c.startsWith('JSESSIONID'));
          if (jsessionid) {
            this.sessionCookie = jsessionid.split(';')[0];
          }
        }
        return response;
      },
      error => Promise.reject(error)
    );

    // Add request interceptor for session cookie
    this.client.interceptors.request.use(config => {
      if (this.sessionCookie) {
        config.headers.Cookie = this.sessionCookie;
      }
      return config;
    });
  }

  private handleError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;
      throw new Error(`${context}: HTTP ${status} - ${JSON.stringify(data) || axiosError.message}`);
    }
    throw new Error(`${context}: ${error}`);
  }

  // Authentication
  async login(): Promise<boolean> {
    try {
      // API requires application/x-www-form-urlencoded content type per Swagger spec
      const formData = new URLSearchParams();
      formData.append('username', this.config.username);
      formData.append('password', this.config.password);

      const response = await this.client.post('/users/_login', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });
      return response.status === 200;
    } catch (error) {
      this.handleError(error, 'Login failed');
    }
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/users/_logout');
      this.sessionCookie = null;
    } catch (error) {
      // Ignore logout errors
    }
  }

  // Server Info - uses /server/version and /server/id per Swagger spec (no /server/info endpoint)
  // These endpoints return text/plain, not JSON
  async getServerInfo(): Promise<Record<string, unknown>> {
    try {
      const textHeaders = { headers: { 'Accept': 'text/plain' } };
      const [versionRes, idRes] = await Promise.all([
        this.client.get('/server/version', textHeaders),
        this.client.get('/server/id', textHeaders)
      ]);
      return {
        version: versionRes.data,
        serverId: idRes.data
      };
    } catch (error) {
      this.handleError(error, 'Failed to get server info');
    }
  }

  async getServerStatus(): Promise<Record<string, unknown>> {
    try {
      const response = await this.client.get('/server/status');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to get server status');
    }
  }

  // Channel Operations
  async getChannels(): Promise<Channel[]> {
    try {
      const response = await this.client.get('/channels');
      return response.data?.list?.channel || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get channels');
    }
  }

  async getChannel(channelId: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.client.get(`/channels/${channelId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get channel ${channelId}`);
    }
  }

  async getChannelXml(channelId: string): Promise<string> {
    try {
      const response = await this.client.get(`/channels/${channelId}`, {
        headers: { 'Accept': 'application/xml' }
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get channel XML ${channelId}`);
    }
  }

  async updateChannel(channelId: string, channelXml: string, override: boolean = false): Promise<boolean> {
    try {
      const response = await this.client.put(`/channels/${channelId}`, channelXml, {
        headers: { 'Content-Type': 'application/xml' },
        params: { override }
      });
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to update channel ${channelId}`);
    }
  }

  async createChannel(channelXml: string): Promise<string> {
    try {
      const response = await this.client.post('/channels', channelXml, {
        headers: { 'Content-Type': 'application/xml' }
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to create channel');
    }
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.delete(`/channels/${channelId}`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to delete channel ${channelId}`);
    }
  }

  // Channel Status Operations
  async getChannelStatuses(): Promise<ChannelStatus[]> {
    try {
      const response = await this.client.get('/channels/statuses');
      return response.data?.list?.dashboardStatus || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get channel statuses');
    }
  }

  async getChannelStatus(channelId: string): Promise<ChannelStatus> {
    try {
      const response = await this.client.get(`/channels/${channelId}/status`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get channel status ${channelId}`);
    }
  }

  // Channel Deployment
  async deployChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/_deploy`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to deploy channel ${channelId}`);
    }
  }

  async undeployChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/_undeploy`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to undeploy channel ${channelId}`);
    }
  }

  async startChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/_start`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to start channel ${channelId}`);
    }
  }

  async stopChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/_stop`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to stop channel ${channelId}`);
    }
  }

  async pauseChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/_pause`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to pause channel ${channelId}`);
    }
  }

  async resumeChannel(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/_resume`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to resume channel ${channelId}`);
    }
  }

  // Channel Statistics
  async getChannelStatistics(): Promise<ChannelStatistics[]> {
    try {
      const response = await this.client.get('/channels/statistics');
      return response.data?.list?.channelStatistics || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get channel statistics');
    }
  }

  async getChannelStatistic(channelId: string): Promise<ChannelStatistics> {
    try {
      const response = await this.client.get(`/channels/${channelId}/statistics`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get channel statistics ${channelId}`);
    }
  }

  async clearChannelStatistics(channelId: string): Promise<boolean> {
    try {
      const response = await this.client.delete(`/channels/${channelId}/statistics`);
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to clear channel statistics ${channelId}`);
    }
  }

  // Code Templates
  async getCodeTemplateLibraries(): Promise<CodeTemplateLibrary[]> {
    try {
      const response = await this.client.get('/codeTemplateLibraries');
      return response.data?.list?.codeTemplateLibrary || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get code template libraries');
    }
  }

  async getCodeTemplateLibrary(libraryId: string): Promise<CodeTemplateLibrary> {
    try {
      const response = await this.client.get(`/codeTemplateLibraries/${libraryId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get code template library ${libraryId}`);
    }
  }

  async getCodeTemplateLibraryXml(libraryId: string): Promise<string> {
    try {
      const response = await this.client.get(`/codeTemplateLibraries/${libraryId}`, {
        headers: { 'Accept': 'application/xml' }
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get code template library XML ${libraryId}`);
    }
  }

  async updateCodeTemplateLibraries(librariesXml: string, override: boolean = false): Promise<boolean> {
    try {
      const response = await this.client.put('/codeTemplateLibraries', librariesXml, {
        headers: { 'Content-Type': 'application/xml' },
        params: { override }
      });
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, 'Failed to update code template libraries');
    }
  }

  async getCodeTemplates(): Promise<CodeTemplate[]> {
    try {
      const response = await this.client.get('/codeTemplates');
      return response.data?.list?.codeTemplate || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get code templates');
    }
  }

  async getCodeTemplate(templateId: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.client.get(`/codeTemplates/${templateId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get code template ${templateId}`);
    }
  }

  async getCodeTemplateXml(templateId: string): Promise<string> {
    try {
      const response = await this.client.get(`/codeTemplates/${templateId}`, {
        headers: { 'Accept': 'application/xml' }
      });
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get code template XML ${templateId}`);
    }
  }

  // Events/Logs
  async getEvents(params?: {
    maxEventId?: number;
    minEventId?: number;
    level?: string;
    startDate?: string;
    endDate?: string;
    name?: string;
    outcome?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ServerEvent[]> {
    try {
      const response = await this.client.get('/events', { params });
      return response.data?.list?.serverEvent || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get events');
    }
  }

  async getEventCount(params?: {
    level?: string;
    startDate?: string;
    endDate?: string;
    name?: string;
    outcome?: string;
    userId?: string;
  }): Promise<number> {
    try {
      const response = await this.client.get('/events/_count', { params });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to get event count');
    }
  }

  // Messages
  async getMessages(channelId: string, params?: {
    minMessageId?: number;
    maxMessageId?: number;
    startDate?: string;
    endDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
    includeContent?: boolean;
  }): Promise<MessageSearchResult[]> {
    try {
      const response = await this.client.get(`/channels/${channelId}/messages`, { params });
      return response.data?.list?.message || response.data || [];
    } catch (error) {
      this.handleError(error, `Failed to get messages for channel ${channelId}`);
    }
  }

  async getMessage(channelId: string, messageId: number): Promise<MessageSearchResult> {
    try {
      const response = await this.client.get(`/channels/${channelId}/messages/${messageId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get message ${messageId} for channel ${channelId}`);
    }
  }

  async getMessageContent(channelId: string, messageId: number, metaDataId: number): Promise<ConnectorMessage> {
    try {
      const response = await this.client.get(`/channels/${channelId}/messages/${messageId}/connectorMessages/${metaDataId}`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to get message content for message ${messageId}`);
    }
  }

  async reprocessMessage(channelId: string, messageId: number, replace: boolean = false): Promise<boolean> {
    try {
      const response = await this.client.post(`/channels/${channelId}/messages/_reprocess`, null, {
        params: { minMessageId: messageId, maxMessageId: messageId, replace }
      });
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to reprocess message ${messageId}`);
    }
  }

  async clearMessages(channelId: string, params?: {
    clearStatistics?: boolean;
    restartRunningChannels?: boolean;
  }): Promise<boolean> {
    try {
      const response = await this.client.delete(`/channels/${channelId}/messages`, { params });
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, `Failed to clear messages for channel ${channelId}`);
    }
  }

  // Channel Groups
  async getChannelGroups(): Promise<unknown[]> {
    try {
      const response = await this.client.get('/channelgroups');
      return response.data?.set?.channelGroup || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get channel groups');
    }
  }

  // Alerts
  async getAlerts(): Promise<unknown[]> {
    try {
      const response = await this.client.get('/alerts');
      return response.data?.list?.alertModel || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get alerts');
    }
  }

  async getAlertInfo(): Promise<unknown[]> {
    try {
      const response = await this.client.get('/alerts/info');
      return response.data?.list?.alertInfo || response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to get alert info');
    }
  }

  // System
  async getGlobalScripts(): Promise<Record<string, unknown>> {
    try {
      const response = await this.client.get('/server/globalScripts');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to get global scripts');
    }
  }

  async getGlobalScriptsXml(): Promise<string> {
    try {
      const response = await this.client.get('/server/globalScripts', {
        headers: { 'Accept': 'application/xml' }
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to get global scripts XML');
    }
  }

  async updateGlobalScripts(scriptsXml: string): Promise<boolean> {
    try {
      const response = await this.client.put('/server/globalScripts', scriptsXml, {
        headers: { 'Content-Type': 'application/xml' }
      });
      return response.status === 204 || response.status === 200;
    } catch (error) {
      this.handleError(error, 'Failed to update global scripts');
    }
  }

  async getConfigurationMap(): Promise<Record<string, unknown>> {
    try {
      const response = await this.client.get('/server/configurationMap');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to get configuration map');
    }
  }
}
