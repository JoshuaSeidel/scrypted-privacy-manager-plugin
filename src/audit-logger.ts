import {
  AuditLogEntry,
  PrivacySettings,
  STORAGE_KEYS,
} from './types';
import { formatDate, safeJsonParse } from './utils';

/**
 * Storage interface matching Scrypted's Storage
 */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Maximum number of audit log entries to keep in memory
 */
const MAX_LOG_ENTRIES = 1000;

/**
 * Audit logger for tracking privacy setting changes
 */
export class AuditLogger {
  private storage: StorageLike;
  private console: Console;
  private retentionDays: number;
  private logCache: AuditLogEntry[] | null = null;

  constructor(storage: StorageLike, console: Console, retentionDays: number = 30) {
    this.storage = storage;
    this.console = console;
    this.retentionDays = retentionDays;
  }

  /**
   * Set retention period in days
   */
  setRetentionDays(days: number): void {
    this.retentionDays = days;
  }

  /**
   * Log a privacy settings change
   */
  async log(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: Date.now(),
    };

    try {
      const logs = await this.getLogs();
      logs.unshift(fullEntry);

      // Trim to max entries
      if (logs.length > MAX_LOG_ENTRIES) {
        logs.length = MAX_LOG_ENTRIES;
      }

      // Apply retention policy
      const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
      const filteredLogs = logs.filter(log => log.timestamp > cutoffTime);

      this.logCache = filteredLogs;
      this.storage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(filteredLogs));

      this.console.log(
        `[Audit] ${entry.trigger}: ${entry.cameraName || 'Global'} - ` +
        `${this.describeChange(entry.previousSettings, entry.newSettings)}`
      );
    } catch (error) {
      this.console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Log a manual settings change
   */
  async logManualChange(
    cameraId: string | null,
    cameraName: string | null,
    previousSettings: PrivacySettings | null,
    newSettings: PrivacySettings
  ): Promise<void> {
    await this.log({
      cameraId,
      cameraName,
      previousSettings,
      newSettings,
      trigger: 'manual',
    });
  }

  /**
   * Log a schedule-triggered change
   */
  async logScheduleChange(
    cameraId: string,
    cameraName: string,
    previousSettings: PrivacySettings | null,
    newSettings: PrivacySettings
  ): Promise<void> {
    await this.log({
      cameraId,
      cameraName,
      previousSettings,
      newSettings,
      trigger: 'schedule',
    });
  }

  /**
   * Log a profile activation
   */
  async logProfileActivation(
    cameraId: string,
    cameraName: string,
    previousSettings: PrivacySettings | null,
    newSettings: PrivacySettings,
    profileName: string
  ): Promise<void> {
    await this.log({
      cameraId,
      cameraName,
      previousSettings,
      newSettings,
      trigger: 'profile',
      profileName,
    });
  }

  /**
   * Log panic mode activation/deactivation
   */
  async logPanicMode(
    enabled: boolean,
    previousSettings: PrivacySettings | null,
    newSettings: PrivacySettings
  ): Promise<void> {
    await this.log({
      cameraId: null,
      cameraName: 'All Cameras',
      previousSettings,
      newSettings,
      trigger: 'panic',
    });
  }

  /**
   * Get all audit logs
   */
  async getLogs(): Promise<AuditLogEntry[]> {
    if (this.logCache) {
      return this.logCache;
    }

    const stored = this.storage.getItem(STORAGE_KEYS.AUDIT_LOG);
    const logs = safeJsonParse<AuditLogEntry[]>(stored, []);
    this.logCache = logs;
    return logs;
  }

  /**
   * Get logs for a specific camera
   */
  async getLogsForCamera(cameraId: string): Promise<AuditLogEntry[]> {
    const logs = await this.getLogs();
    return logs.filter(log => log.cameraId === cameraId);
  }

  /**
   * Get logs within a time range
   */
  async getLogsInRange(startTime: number, endTime: number): Promise<AuditLogEntry[]> {
    const logs = await this.getLogs();
    return logs.filter(log => log.timestamp >= startTime && log.timestamp <= endTime);
  }

  /**
   * Get recent logs (last N entries)
   */
  async getRecentLogs(count: number = 50): Promise<AuditLogEntry[]> {
    const logs = await this.getLogs();
    return logs.slice(0, count);
  }

  /**
   * Clear all logs
   */
  async clearLogs(): Promise<void> {
    this.logCache = [];
    this.storage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify([]));
    this.console.log('[Audit] Logs cleared');
  }

  /**
   * Export logs as formatted string
   */
  async exportLogs(): Promise<string> {
    const logs = await this.getLogs();

    const lines = logs.map(log => {
      const timestamp = formatDate(log.timestamp);
      const camera = log.cameraName || 'Global';
      const trigger = log.trigger.toUpperCase();
      const profile = log.profileName ? ` (${log.profileName})` : '';
      const change = this.describeChange(log.previousSettings, log.newSettings);

      return `[${timestamp}] ${trigger}${profile}: ${camera} - ${change}`;
    });

    return lines.join('\n');
  }

  /**
   * Export logs as JSON
   */
  async exportLogsJson(): Promise<string> {
    const logs = await this.getLogs();
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Apply retention policy to existing logs
   */
  async applyRetention(): Promise<number> {
    const logs = await this.getLogs();
    const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    const filteredLogs = logs.filter(log => log.timestamp > cutoffTime);
    const removed = logs.length - filteredLogs.length;

    if (removed > 0) {
      this.logCache = filteredLogs;
      this.storage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(filteredLogs));
      this.console.log(`[Audit] Removed ${removed} old log entries`);
    }

    return removed;
  }

  /**
   * Describe a settings change
   */
  private describeChange(
    previous: PrivacySettings | null,
    current: PrivacySettings
  ): string {
    if (!previous) {
      return this.describeSettings(current);
    }

    const changes: string[] = [];

    if (previous.blockRecording !== current.blockRecording) {
      changes.push(`Recording: ${current.blockRecording ? 'BLOCKED' : 'allowed'}`);
    }
    if (previous.blockEvents !== current.blockEvents) {
      changes.push(`Events: ${current.blockEvents ? 'BLOCKED' : 'allowed'}`);
    }
    if (previous.blockStreaming !== current.blockStreaming) {
      changes.push(`Streaming: ${current.blockStreaming ? 'BLOCKED' : 'allowed'}`);
    }
    if (previous.blockDetection !== current.blockDetection) {
      changes.push(`Detection: ${current.blockDetection ? 'BLOCKED' : 'allowed'}`);
    }
    if (previous.blockMotionAlerts !== current.blockMotionAlerts) {
      changes.push(`Motion Alerts: ${current.blockMotionAlerts ? 'BLOCKED' : 'allowed'}`);
    }

    return changes.length > 0 ? changes.join(', ') : 'No changes';
  }

  /**
   * Describe settings state
   */
  private describeSettings(settings: PrivacySettings): string {
    const blocked: string[] = [];

    if (settings.blockRecording) blocked.push('Recording');
    if (settings.blockEvents) blocked.push('Events');
    if (settings.blockStreaming) blocked.push('Streaming');
    if (settings.blockDetection) blocked.push('Detection');
    if (settings.blockMotionAlerts) blocked.push('Motion Alerts');

    if (blocked.length === 0) return 'All allowed';
    if (blocked.length === 5) return 'All BLOCKED';

    return `BLOCKED: ${blocked.join(', ')}`;
  }
}
