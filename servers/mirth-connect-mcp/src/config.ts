// Configuration for Mirth Connect MCP Server

export interface MirthConfig {
  baseUrl: string;
  username: string;
  password: string;
  rejectUnauthorized: boolean;
}

export interface BackupConfig {
  backupDir: string;
  maxVersions: number;
}

export interface ServerConfig {
  mirth: MirthConfig;
  backup: BackupConfig;
  requireConfirmation: boolean; // Require confirmation for destructive operations
}

// Default configuration - can be overridden via environment variables
export function loadConfig(): ServerConfig {
  return {
    mirth: {
      baseUrl: process.env.MIRTH_URL || 'https://localhost:8444/api',
      username: process.env.MIRTH_USERNAME || 'admin',
      password: process.env.MIRTH_PASSWORD || 'admin',
      rejectUnauthorized: process.env.MIRTH_REJECT_UNAUTHORIZED !== 'false'
    },
    backup: {
      backupDir: process.env.BACKUP_DIR || './backups',
      maxVersions: parseInt(process.env.BACKUP_MAX_VERSIONS || '10', 10)
    },
    requireConfirmation: process.env.REQUIRE_CONFIRMATION !== 'false'
  };
}
