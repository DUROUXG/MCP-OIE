// Backup Manager for Mirth Connect resources
import fs from 'fs/promises';
import path from 'path';
import { BackupConfig } from './config.js';

export interface BackupMetadata {
  id: string;
  timestamp: string;
  type: 'channel' | 'codeTemplate' | 'codeTemplateLibrary' | 'globalScripts' | 'full';
  resourceId: string;
  resourceName: string;
  description?: string;
  checksum?: string;
}

export interface BackupInfo {
  metadata: BackupMetadata;
  path: string;
}

export class BackupManager {
  private backupDir: string;
  private maxVersions: number;

  constructor(config: BackupConfig) {
    this.backupDir = config.backupDir;
    this.maxVersions = config.maxVersions;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'channels'), { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'codeTemplates'), { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'codeTemplateLibraries'), { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'globalScripts'), { recursive: true });
    await fs.mkdir(path.join(this.backupDir, 'full'), { recursive: true });
  }

  private generateBackupId(): string {
    return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getTypeDir(type: BackupMetadata['type']): string {
    const dirs: Record<BackupMetadata['type'], string> = {
      channel: 'channels',
      codeTemplate: 'codeTemplates',
      codeTemplateLibrary: 'codeTemplateLibraries',
      globalScripts: 'globalScripts',
      full: 'full'
    };
    return path.join(this.backupDir, dirs[type]);
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  }

  private simpleChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  async createBackup(
    type: BackupMetadata['type'],
    resourceId: string,
    resourceName: string,
    content: string,
    description?: string
  ): Promise<BackupInfo> {
    await this.initialize();

    const timestamp = new Date().toISOString();
    const backupId = this.generateBackupId();
    const safeName = this.sanitizeName(resourceName);
    const checksum = this.simpleChecksum(content);

    const metadata: BackupMetadata = {
      id: backupId,
      timestamp,
      type,
      resourceId,
      resourceName,
      description,
      checksum
    };

    const typeDir = this.getTypeDir(type);
    const resourceDir = path.join(typeDir, `${resourceId}_${safeName}`);
    await fs.mkdir(resourceDir, { recursive: true });

    const backupFileName = `${timestamp.replace(/[:.]/g, '-')}_${backupId}`;
    const contentPath = path.join(resourceDir, `${backupFileName}.xml`);
    const metadataPath = path.join(resourceDir, `${backupFileName}.meta.json`);

    await fs.writeFile(contentPath, content, 'utf-8');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // Cleanup old versions
    await this.cleanupOldVersions(resourceDir);

    return { metadata, path: contentPath };
  }

  private async cleanupOldVersions(resourceDir: string): Promise<void> {
    try {
      const files = await fs.readdir(resourceDir);
      const metaFiles = files.filter(f => f.endsWith('.meta.json')).sort().reverse();

      if (metaFiles.length > this.maxVersions) {
        const toDelete = metaFiles.slice(this.maxVersions);
        for (const metaFile of toDelete) {
          const baseName = metaFile.replace('.meta.json', '');
          await fs.unlink(path.join(resourceDir, metaFile)).catch(() => {});
          await fs.unlink(path.join(resourceDir, `${baseName}.xml`)).catch(() => {});
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  async listBackups(type?: BackupMetadata['type'], resourceId?: string): Promise<BackupInfo[]> {
    await this.initialize();
    const backups: BackupInfo[] = [];

    const types: BackupMetadata['type'][] = type
      ? [type]
      : ['channel', 'codeTemplate', 'codeTemplateLibrary', 'globalScripts', 'full'];

    for (const t of types) {
      const typeDir = this.getTypeDir(t);
      try {
        const resourceDirs = await fs.readdir(typeDir);

        for (const resourceDirName of resourceDirs) {
          if (resourceId && !resourceDirName.startsWith(resourceId)) continue;

          const resourceDir = path.join(typeDir, resourceDirName);
          const stat = await fs.stat(resourceDir);
          if (!stat.isDirectory()) continue;

          const files = await fs.readdir(resourceDir);
          const metaFiles = files.filter(f => f.endsWith('.meta.json'));

          for (const metaFile of metaFiles) {
            try {
              const metaPath = path.join(resourceDir, metaFile);
              const metaContent = await fs.readFile(metaPath, 'utf-8');
              const metadata = JSON.parse(metaContent) as BackupMetadata;
              const contentPath = path.join(resourceDir, metaFile.replace('.meta.json', '.xml'));
              backups.push({ metadata, path: contentPath });
            } catch {
              // Skip invalid metadata files
            }
          }
        }
      } catch {
        // Type directory doesn't exist yet
      }
    }

    return backups.sort((a, b) =>
      new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime()
    );
  }

  async getBackup(backupId: string): Promise<{ metadata: BackupMetadata; content: string } | null> {
    const allBackups = await this.listBackups();
    const backup = allBackups.find(b => b.metadata.id === backupId);

    if (!backup) return null;

    try {
      const content = await fs.readFile(backup.path, 'utf-8');
      return { metadata: backup.metadata, content };
    } catch {
      return null;
    }
  }

  async getLatestBackup(type: BackupMetadata['type'], resourceId: string): Promise<{ metadata: BackupMetadata; content: string } | null> {
    const backups = await this.listBackups(type, resourceId);
    if (backups.length === 0) return null;

    const latest = backups[0];
    try {
      const content = await fs.readFile(latest.path, 'utf-8');
      return { metadata: latest.metadata, content };
    } catch {
      return null;
    }
  }

  async deleteBackup(backupId: string): Promise<boolean> {
    const allBackups = await this.listBackups();
    const backup = allBackups.find(b => b.metadata.id === backupId);

    if (!backup) return false;

    try {
      await fs.unlink(backup.path);
      await fs.unlink(backup.path.replace('.xml', '.meta.json'));
      return true;
    } catch {
      return false;
    }
  }

  async compareBackups(backupId1: string, backupId2: string): Promise<{
    backup1: BackupMetadata;
    backup2: BackupMetadata;
    identical: boolean;
    sizeDiff: number;
  } | null> {
    const backup1 = await this.getBackup(backupId1);
    const backup2 = await this.getBackup(backupId2);

    if (!backup1 || !backup2) return null;

    return {
      backup1: backup1.metadata,
      backup2: backup2.metadata,
      identical: backup1.content === backup2.content,
      sizeDiff: backup1.content.length - backup2.content.length
    };
  }

  async getBackupStats(): Promise<{
    totalBackups: number;
    byType: Record<string, number>;
    oldestBackup?: string;
    newestBackup?: string;
    totalSizeBytes: number;
  }> {
    const allBackups = await this.listBackups();

    const byType: Record<string, number> = {};
    let totalSize = 0;

    for (const backup of allBackups) {
      byType[backup.metadata.type] = (byType[backup.metadata.type] || 0) + 1;
      try {
        const stat = await fs.stat(backup.path);
        totalSize += stat.size;
      } catch {
        // Ignore
      }
    }

    return {
      totalBackups: allBackups.length,
      byType,
      oldestBackup: allBackups.length > 0 ? allBackups[allBackups.length - 1].metadata.timestamp : undefined,
      newestBackup: allBackups.length > 0 ? allBackups[0].metadata.timestamp : undefined,
      totalSizeBytes: totalSize
    };
  }
}
