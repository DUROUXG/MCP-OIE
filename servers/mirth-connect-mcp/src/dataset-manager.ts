/**
 * DatasetManager - Temporary storage for large datasets with query capabilities
 *
 * Pattern:
 * 1. Tool fetches data → stores in DatasetManager → returns summary + datasetId
 * 2. AI queries dataset using datasetId with filters, pagination, search
 * 3. Datasets auto-expire after TTL (default 30 minutes)
 */

export interface DatasetMetadata {
  id: string;
  type: 'messages' | 'serverLogs' | 'connectionLogs' | 'events' | 'channels' | 'generic';
  channelId?: string;
  channelName?: string;
  createdAt: Date;
  expiresAt: Date;
  totalCount: number;
  pageSize: number;
  totalPages: number;
  summary: DatasetSummary;
}

export interface DatasetSummary {
  // Common fields
  totalCount: number;
  dateRange?: { earliest: string; latest: string };

  // For messages
  statusCounts?: Record<string, number>;
  errorCount?: number;

  // For logs
  levelCounts?: Record<string, number>;

  // For events
  outcomeCounts?: Record<string, number>;

  // Top items preview (first 5)
  preview?: Array<Record<string, unknown>>;
}

export interface DatasetQuery {
  datasetId: string;
  page?: number;           // 1-based page number
  pageSize?: number;       // Override default (max 50)
  sortBy?: string;         // Field to sort by
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, unknown>;  // Field filters
  search?: string;         // Text search across all fields
  ids?: number[];          // Get specific IDs
}

export interface DatasetPage<T = Record<string, unknown>> {
  datasetId: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  hasNext: boolean;
  hasPrev: boolean;
  items: T[];
}

interface StoredDataset {
  metadata: DatasetMetadata;
  data: Array<Record<string, unknown>>;
  sortedIds: number[];  // Pre-sorted IDs for fast lookup
}

export class DatasetManager {
  private datasets = new Map<string, StoredDataset>();
  private readonly DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly DEFAULT_PAGE_SIZE = 50;
  private readonly MAX_PAGE_SIZE = 100;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Auto-cleanup expired datasets every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Store a dataset and return metadata with summary
   */
  store(
    type: DatasetMetadata['type'],
    data: unknown[],
    options?: {
      channelId?: string;
      channelName?: string;
      ttlMs?: number;
      idField?: string;
    }
  ): DatasetMetadata {
    // Flatten nested structures from Mirth API responses
    const flattenedData = this.flattenApiResponse(data);
    const dataRecords = flattenedData as Array<Record<string, unknown>>;
    const id = this.generateId();
    const now = new Date();
    const ttl = options?.ttlMs || this.DEFAULT_TTL_MS;
    const idField = options?.idField || 'id';

    // Sort data by ID (descending - newest first)
    const sortedData = [...dataRecords].sort((a, b) => {
      const aId = (a[idField] as number) || (a['messageId'] as number) || 0;
      const bId = (b[idField] as number) || (b['messageId'] as number) || 0;
      return bId - aId;
    });

    // Extract sorted IDs for fast lookup
    const sortedIds = sortedData.map(item =>
      (item[idField] as number) || (item['messageId'] as number) || 0
    );

    // Generate summary based on type
    const summary = this.generateSummary(type, sortedData);

    const metadata: DatasetMetadata = {
      id,
      type,
      channelId: options?.channelId,
      channelName: options?.channelName,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      totalCount: dataRecords.length,
      pageSize: this.DEFAULT_PAGE_SIZE,
      totalPages: Math.ceil(dataRecords.length / this.DEFAULT_PAGE_SIZE),
      summary,
    };

    this.datasets.set(id, {
      metadata,
      data: sortedData,
      sortedIds,
    });

    return metadata;
  }

  /**
   * Query a dataset with filters, pagination, search
   */
  query(query: DatasetQuery): DatasetPage {
    const dataset = this.datasets.get(query.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${query.datasetId}. It may have expired.`);
    }

    // Check expiration
    if (new Date() > dataset.metadata.expiresAt) {
      this.datasets.delete(query.datasetId);
      throw new Error(`Dataset expired: ${query.datasetId}`);
    }

    let filteredData = [...dataset.data];

    // Apply ID filter (fast path)
    if (query.ids && query.ids.length > 0) {
      const idSet = new Set(query.ids);
      filteredData = filteredData.filter(item => {
        const itemId = (item['id'] as number) || (item['messageId'] as number) || 0;
        return idSet.has(itemId);
      });
    }

    // Apply field filters
    if (query.filters) {
      for (const [field, value] of Object.entries(query.filters)) {
        if (value !== undefined && value !== null) {
          filteredData = filteredData.filter(item => {
            const itemValue = item[field];
            if (typeof value === 'string' && typeof itemValue === 'string') {
              return itemValue.toLowerCase().includes(value.toLowerCase());
            }
            return itemValue === value;
          });
        }
      }
    }

    // Apply text search
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      filteredData = filteredData.filter(item => {
        return Object.values(item).some(val => {
          if (typeof val === 'string') {
            return val.toLowerCase().includes(searchLower);
          }
          if (typeof val === 'number') {
            return val.toString().includes(searchLower);
          }
          return false;
        });
      });
    }

    // Apply sorting
    if (query.sortBy) {
      const order = query.sortOrder === 'asc' ? 1 : -1;
      filteredData.sort((a, b) => {
        const aVal = a[query.sortBy!];
        const bVal = b[query.sortBy!];
        if (aVal === bVal) return 0;
        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        return aVal < bVal ? -order : order;
      });
    }

    // Apply pagination
    const pageSize = Math.min(query.pageSize || this.DEFAULT_PAGE_SIZE, this.MAX_PAGE_SIZE);
    const totalPages = Math.ceil(filteredData.length / pageSize);
    const page = Math.max(1, Math.min(query.page || 1, totalPages || 1));
    const startIndex = (page - 1) * pageSize;
    const items = filteredData.slice(startIndex, startIndex + pageSize);

    return {
      datasetId: query.datasetId,
      page,
      pageSize,
      totalPages,
      totalCount: filteredData.length,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      items,
    };
  }

  /**
   * Get a single item by ID from a dataset
   */
  getById(datasetId: string, itemId: number): Record<string, unknown> | null {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    const item = dataset.data.find(item => {
      const id = (item['id'] as number) || (item['messageId'] as number) || 0;
      return id === itemId;
    });

    return item || null;
  }

  /**
   * Get dataset metadata (without data)
   */
  getMetadata(datasetId: string): DatasetMetadata | null {
    const dataset = this.datasets.get(datasetId);
    return dataset?.metadata || null;
  }

  /**
   * List all active datasets
   */
  listDatasets(): DatasetMetadata[] {
    this.cleanup(); // Clean expired first
    return Array.from(this.datasets.values()).map(d => d.metadata);
  }

  /**
   * Delete a dataset
   */
  delete(datasetId: string): boolean {
    return this.datasets.delete(datasetId);
  }

  /**
   * Clean up expired datasets
   */
  private cleanup(): void {
    const now = new Date();
    for (const [id, dataset] of this.datasets.entries()) {
      if (now > dataset.metadata.expiresAt) {
        this.datasets.delete(id);
      }
    }
  }

  /**
   * Generate unique dataset ID
   */
  private generateId(): string {
    return `ds_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Flatten nested API responses from Mirth
   * Mirth API returns data in formats like:
   * - { list: { event: [...] } }
   * - { list: { serverLogItem: [...] } }
   * - { list: { message: [...] } }
   * - Or just an array when already flat
   */
  private flattenApiResponse(data: unknown[]): Array<Record<string, unknown>> {
    if (!data || data.length === 0) {
      return [];
    }

    // Check if first element is a wrapper object with 'list' property
    const first = data[0] as Record<string, unknown>;
    if (first && typeof first === 'object' && 'list' in first) {
      const list = first['list'] as Record<string, unknown>;
      if (list && typeof list === 'object') {
        // Find the array inside list (event, message, serverLogItem, etc.)
        for (const key of Object.keys(list)) {
          const value = list[key];
          if (Array.isArray(value)) {
            return value as Array<Record<string, unknown>>;
          }
          // Single item case - wrap in array
          if (value && typeof value === 'object') {
            return [value as Record<string, unknown>];
          }
        }
      }
    }

    // Already flat array or simple objects
    return data as Array<Record<string, unknown>>;
  }

  /**
   * Generate summary based on dataset type
   */
  private generateSummary(
    type: DatasetMetadata['type'],
    data: Array<Record<string, unknown>>
  ): DatasetSummary {
    const summary: DatasetSummary = {
      totalCount: data.length,
      preview: data.slice(0, 5).map(item => this.compactItem(type, item)),
    };

    if (data.length === 0) return summary;

    // Extract date range
    const dates = data
      .map(item => item['receivedDate'] || item['dateTime'] || item['dateCreated'])
      .filter(d => d)
      .map(d => {
        try {
          // Handle different date formats: string, number (timestamp), or object with 'time' property
          if (typeof d === 'number') {
            return d;
          }
          if (typeof d === 'object' && d !== null && 'time' in (d as Record<string, unknown>)) {
            return (d as Record<string, number>)['time'];
          }
          const parsed = new Date(d as string).getTime();
          return isNaN(parsed) ? null : parsed;
        } catch {
          return null;
        }
      })
      .filter((d): d is number => d !== null);

    if (dates.length > 0) {
      summary.dateRange = {
        earliest: new Date(Math.min(...dates)).toISOString(),
        latest: new Date(Math.max(...dates)).toISOString(),
      };
    }

    // Type-specific summaries
    switch (type) {
      case 'messages': {
        summary.statusCounts = this.countByField(data, 'status');
        summary.errorCount = data.filter(m => {
          const connectors = m['connectorMessages'] as Record<string, unknown>[] | undefined;
          if (Array.isArray(connectors)) {
            return connectors.some(c => c['status'] === 'ERROR');
          }
          return m['status'] === 'ERROR';
        }).length;
        break;
      }
      case 'serverLogs':
      case 'connectionLogs': {
        summary.levelCounts = this.countByField(data, 'level');
        break;
      }
      case 'events': {
        summary.levelCounts = this.countByField(data, 'level');
        summary.outcomeCounts = this.countByField(data, 'outcome');
        break;
      }
    }

    return summary;
  }

  /**
   * Count items by field value
   */
  private countByField(data: Array<Record<string, unknown>>, field: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of data) {
      const value = String(item[field] || 'UNKNOWN');
      counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  }

  /**
   * Create compact version of item for preview
   */
  private compactItem(type: DatasetMetadata['type'], item: Record<string, unknown>): Record<string, unknown> {
    switch (type) {
      case 'messages':
        return {
          messageId: item['messageId'],
          receivedDate: item['receivedDate'],
          processed: item['processed'],
          status: this.extractMessageStatus(item),
        };
      case 'serverLogs':
        return {
          id: item['id'],
          level: item['level'],
          dateCreated: item['dateCreated'],
          logMessage: this.truncate(item['logMessage'] as string, 100),
        };
      case 'connectionLogs':
        return {
          id: item['id'],
          channelName: item['channelName'],
          eventState: item['eventState'],
          dateCreated: item['dateCreated'],
          information: this.truncate(item['information'] as string, 100),
        };
      case 'events':
        return {
          id: item['id'],
          level: item['level'],
          name: item['name'],
          outcome: item['outcome'],
          dateTime: item['dateTime'],
        };
      default:
        // Return first 5 fields
        const keys = Object.keys(item).slice(0, 5);
        const compact: Record<string, unknown> = {};
        for (const key of keys) {
          compact[key] = item[key];
        }
        return compact;
    }
  }

  /**
   * Extract message status from connector messages
   */
  private extractMessageStatus(message: Record<string, unknown>): string {
    const connectors = message['connectorMessages'];
    if (Array.isArray(connectors) && connectors.length > 0) {
      return connectors[0]['status'] as string || 'UNKNOWN';
    }
    // Handle nested structure
    const entry = (connectors as Record<string, unknown>)?.['entry'];
    if (entry) {
      const cm = (entry as Record<string, unknown>)['connectorMessage'];
      if (cm) {
        return (cm as Record<string, unknown>)['status'] as string || 'UNKNOWN';
      }
    }
    return 'UNKNOWN';
  }

  /**
   * Truncate string with ellipsis
   */
  private truncate(str: string | undefined, maxLength: number): string {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.datasets.clear();
  }
}

// Singleton instance
export const datasetManager = new DatasetManager();
