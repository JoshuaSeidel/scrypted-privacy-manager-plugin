import {
  PrivacySchedule,
  PrivacySettings,
  CameraPrivacyConfig,
  DEFAULT_PRIVACY_SETTINGS,
} from './types';
import {
  isWithinSchedule,
  getNextScheduleChange,
  describeSchedule,
} from './utils';

/**
 * Callback type for schedule changes
 */
export type ScheduleChangeCallback = (
  cameraId: string,
  newSettings: PrivacySettings,
  reason: 'schedule_start' | 'schedule_end'
) => void;

/**
 * Schedule entry for tracking
 */
interface ScheduleEntry {
  cameraId: string;
  schedule: PrivacySchedule;
  currentlyActive: boolean;
  lastCheck: number;
}

/**
 * Manages time-based privacy schedules
 */
export class ScheduleManager {
  private schedules: Map<string, ScheduleEntry> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: Set<ScheduleChangeCallback> = new Set();
  private console: Console;
  private checkIntervalMs: number;

  constructor(console: Console, checkIntervalMs: number = 60000) {
    this.console = console;
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Start the schedule manager
   */
  start(): void {
    if (this.checkInterval) {
      return;
    }

    this.console.log('[Schedule] Starting schedule manager');
    this.checkInterval = setInterval(() => this.checkSchedules(), this.checkIntervalMs);

    // Do an initial check
    this.checkSchedules();
  }

  /**
   * Stop the schedule manager
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.console.log('[Schedule] Stopped schedule manager');
    }
  }

  /**
   * Register a callback for schedule changes
   */
  onScheduleChange(callback: ScheduleChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Register or update a camera's schedule
   */
  setSchedule(cameraId: string, schedule: PrivacySchedule): void {
    const wasActive = this.schedules.get(cameraId)?.currentlyActive ?? false;
    const isActive = schedule.enabled && isWithinSchedule(schedule);

    this.schedules.set(cameraId, {
      cameraId,
      schedule,
      currentlyActive: isActive,
      lastCheck: Date.now(),
    });

    if (schedule.enabled) {
      const nextChange = getNextScheduleChange(schedule);
      this.console.log(
        `[Schedule] Registered schedule for camera ${cameraId}: ` +
        `${describeSchedule(schedule)}, currently ${isActive ? 'ACTIVE' : 'inactive'}` +
        (nextChange ? `, next change at ${nextChange.toLocaleString()}` : '')
      );

      // If schedule is newly enabled and we're already within the active window,
      // trigger an immediate callback to apply the settings
      if (isActive && !wasActive) {
        this.console.log(`[Schedule] Camera ${cameraId} schedule immediately ACTIVATED (within active window)`);
        for (const callback of this.callbacks) {
          try {
            callback(cameraId, schedule.settings, 'schedule_start');
          } catch (error) {
            this.console.error('[Schedule] Callback error:', error);
          }
        }
      }
    }
  }

  /**
   * Remove a camera's schedule
   */
  removeSchedule(cameraId: string): void {
    this.schedules.delete(cameraId);
    this.console.log(`[Schedule] Removed schedule for camera ${cameraId}`);
  }

  /**
   * Check if a camera's schedule is currently active
   */
  isScheduleActive(cameraId: string): boolean {
    const entry = this.schedules.get(cameraId);
    if (!entry || !entry.schedule.enabled) {
      return false;
    }
    return isWithinSchedule(entry.schedule);
  }

  /**
   * Get the effective privacy settings for a camera based on schedule
   */
  getEffectiveSettings(
    cameraId: string,
    baseSettings: PrivacySettings
  ): PrivacySettings {
    const entry = this.schedules.get(cameraId);

    if (!entry || !entry.schedule.enabled) {
      return baseSettings;
    }

    if (isWithinSchedule(entry.schedule)) {
      // Schedule is active, apply schedule's settings
      return entry.schedule.settings;
    }

    // Schedule is not active, use base settings
    return baseSettings;
  }

  /**
   * Get schedule info for a camera
   */
  getScheduleInfo(cameraId: string): {
    schedule: PrivacySchedule | null;
    isActive: boolean;
    nextChange: Date | null;
    description: string;
  } {
    const entry = this.schedules.get(cameraId);

    if (!entry) {
      return {
        schedule: null,
        isActive: false,
        nextChange: null,
        description: 'No schedule configured',
      };
    }

    const isActive = entry.schedule.enabled && isWithinSchedule(entry.schedule);
    const nextChange = entry.schedule.enabled
      ? getNextScheduleChange(entry.schedule)
      : null;

    return {
      schedule: entry.schedule,
      isActive,
      nextChange,
      description: describeSchedule(entry.schedule),
    };
  }

  /**
   * Get all active schedules
   */
  getActiveSchedules(): string[] {
    const active: string[] = [];

    for (const [cameraId, entry] of this.schedules) {
      if (entry.schedule.enabled && isWithinSchedule(entry.schedule)) {
        active.push(cameraId);
      }
    }

    return active;
  }

  /**
   * Check all schedules and fire callbacks for changes
   */
  private checkSchedules(): void {
    const now = Date.now();

    for (const [cameraId, entry] of this.schedules) {
      if (!entry.schedule.enabled) {
        continue;
      }

      const wasActive = entry.currentlyActive;
      const isActive = isWithinSchedule(entry.schedule);

      if (wasActive !== isActive) {
        entry.currentlyActive = isActive;
        entry.lastCheck = now;

        const reason = isActive ? 'schedule_start' : 'schedule_end';
        const settings = isActive
          ? entry.schedule.settings
          : DEFAULT_PRIVACY_SETTINGS;

        this.console.log(
          `[Schedule] Camera ${cameraId} schedule ${isActive ? 'ACTIVATED' : 'DEACTIVATED'}`
        );

        // Notify all callbacks
        for (const callback of this.callbacks) {
          try {
            callback(cameraId, settings, reason);
          } catch (error) {
            this.console.error('[Schedule] Callback error:', error);
          }
        }
      }
    }
  }

  /**
   * Force a schedule check (useful after time changes)
   */
  forceCheck(): void {
    this.checkSchedules();
  }

  /**
   * Get status summary
   */
  getStatus(): {
    totalSchedules: number;
    activeSchedules: number;
    entries: Array<{
      cameraId: string;
      description: string;
      isActive: boolean;
      nextChange: string | null;
    }>;
  } {
    const entries: Array<{
      cameraId: string;
      description: string;
      isActive: boolean;
      nextChange: string | null;
    }> = [];

    let activeCount = 0;

    for (const [cameraId, entry] of this.schedules) {
      const isActive = entry.schedule.enabled && isWithinSchedule(entry.schedule);
      if (isActive) activeCount++;

      const nextChange = entry.schedule.enabled
        ? getNextScheduleChange(entry.schedule)
        : null;

      entries.push({
        cameraId,
        description: describeSchedule(entry.schedule),
        isActive,
        nextChange: nextChange?.toLocaleString() || null,
      });
    }

    return {
      totalSchedules: this.schedules.size,
      activeSchedules: activeCount,
      entries,
    };
  }
}
