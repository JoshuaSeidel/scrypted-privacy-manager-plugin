import sdk, {
  Camera,
  MediaObject,
  MotionSensor,
  ObjectDetectionSession,
  ObjectsDetected,
  RequestMediaStreamOptions,
  RequestPictureOptions,
  ResponseMediaStreamOptions,
  ResponsePictureOptions,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
  VideoCamera,
} from '@scrypted/sdk';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/sdk/settings-mixin';
import {
  CameraPrivacyConfig,
  PrivacySettings,
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_SCHEDULE,
  FULL_PRIVACY_SETTINGS,
  STORAGE_KEYS,
  DayOfWeek,
  ScheduleType,
} from './types';
import { safeJsonParse, describeSettings, getDaysForScheduleType } from './utils';
import type { PrivacyManagerPlugin } from './main';

/**
 * Combined type for camera devices we support
 */
type SupportedDevice = VideoCamera & Camera & MotionSensor & Settings;

/**
 * Privacy Mixin - wraps a camera device to add privacy controls
 */
export class PrivacyMixin
  extends SettingsMixinDeviceBase<SupportedDevice>
  implements VideoCamera, Camera, Settings
{
  private plugin: PrivacyManagerPlugin;
  private config: CameraPrivacyConfig;
  private effectiveSettings: PrivacySettings;
  private originalMotionDetected: boolean | undefined;

  constructor(
    options: SettingsMixinDeviceOptions<SupportedDevice>,
    plugin: PrivacyManagerPlugin
  ) {
    super(options);
    this.plugin = plugin;

    // Load config from storage
    this.config = this.loadConfig();

    // Calculate initial effective settings
    this.effectiveSettings = this.calculateEffectiveSettings();

    this.console.log(
      `[Privacy] Initialized mixin for ${this.name}: ${describeSettings(this.effectiveSettings)}`
    );

    // Register with schedule manager
    if (this.config.schedule.enabled) {
      this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
    }
  }

  /**
   * Load configuration from storage
   */
  private loadConfig(): CameraPrivacyConfig {
    const key = `${STORAGE_KEYS.CAMERA_CONFIG_PREFIX}${this.id}`;
    const stored = this.storage.getItem(key);

    const defaultConfig: CameraPrivacyConfig = {
      enabled: true,
      manualSettings: { ...DEFAULT_PRIVACY_SETTINGS },
      schedule: { ...DEFAULT_SCHEDULE },
      profileIds: [],
    };

    return safeJsonParse(stored, defaultConfig);
  }

  /**
   * Save configuration to storage
   */
  private saveConfig(): void {
    const key = `${STORAGE_KEYS.CAMERA_CONFIG_PREFIX}${this.id}`;
    this.storage.setItem(key, JSON.stringify(this.config));
  }

  /**
   * Calculate effective privacy settings considering panic mode, profiles, and schedules
   */
  private calculateEffectiveSettings(): PrivacySettings {
    // Panic mode overrides everything
    if (this.plugin.isPanicModeActive()) {
      return { ...FULL_PRIVACY_SETTINGS };
    }

    // If privacy controls are disabled for this camera, allow everything
    if (!this.config.enabled) {
      return { ...DEFAULT_PRIVACY_SETTINGS };
    }

    // Check schedule
    const scheduleSettings = this.plugin.scheduleManager.getEffectiveSettings(
      this.id,
      this.config.manualSettings
    );

    // Check active profiles
    const activeProfile = this.plugin.getActiveProfileForCamera(this.id);
    if (activeProfile) {
      return { ...activeProfile.settings };
    }

    return scheduleSettings;
  }

  /**
   * Update effective settings and notify if changed
   */
  updateEffectiveSettings(): void {
    const previous = this.effectiveSettings;
    this.effectiveSettings = this.calculateEffectiveSettings();

    // Check if settings actually changed
    const changed = JSON.stringify(previous) !== JSON.stringify(this.effectiveSettings);

    if (changed) {
      this.console.log(
        `[Privacy] Settings changed for ${this.name}: ${describeSettings(this.effectiveSettings)}`
      );

      // Notify plugin of change for audit logging and webhooks
      this.plugin.onCameraSettingsChanged(
        this.id,
        this.name,
        previous,
        this.effectiveSettings
      );
    }
  }

  /**
   * Get current effective settings
   */
  getEffectiveSettings(): PrivacySettings {
    return this.effectiveSettings;
  }

  // ============ VideoCamera Interface ============

  async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
    // Check streaming block
    if (this.effectiveSettings.blockStreaming) {
      throw new Error('Streaming is blocked by privacy policy');
    }

    // Check recording block - modify destination if needed
    if (this.effectiveSettings.blockRecording && options?.destination) {
      const blockedDestinations = ['local-recorder', 'remote-recorder'];
      if (blockedDestinations.includes(options.destination as string)) {
        throw new Error('Recording is blocked by privacy policy');
      }
    }

    // Pass through to underlying device
    return this.mixinDevice.getVideoStream(options);
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    // If streaming is blocked, return empty options
    if (this.effectiveSettings.blockStreaming) {
      return [];
    }

    return this.mixinDevice.getVideoStreamOptions?.() || [];
  }

  // ============ Camera Interface ============

  async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    // Check streaming block (snapshots are considered streaming)
    if (this.effectiveSettings.blockStreaming) {
      throw new Error('Snapshots are blocked by privacy policy');
    }

    return this.mixinDevice.takePicture(options);
  }

  async getPictureOptions(): Promise<ResponsePictureOptions[]> {
    if (this.effectiveSettings.blockStreaming) {
      return [];
    }

    return this.mixinDevice.getPictureOptions?.() || [];
  }

  // ============ Settings Interface ============

  async getMixinSettings(): Promise<Setting[]> {
    const scheduleInfo = this.plugin.scheduleManager.getScheduleInfo(this.id);
    const activeProfile = this.plugin.getActiveProfileForCamera(this.id);
    const isPanicMode = this.plugin.isPanicModeActive();

    // Build status description
    let statusDescription = '';
    if (isPanicMode) {
      statusDescription = '⚠️ PANIC MODE ACTIVE - All cameras are in full privacy mode';
    } else if (activeProfile) {
      statusDescription = `📋 Profile "${activeProfile.name}" is active`;
    } else if (scheduleInfo.isActive) {
      statusDescription = `⏰ Schedule is active: ${scheduleInfo.description}`;
    } else {
      statusDescription = describeSettings(this.effectiveSettings);
    }

    const settings: Setting[] = [
      // Status display
      {
        key: 'privacyStatus',
        title: 'Current Status',
        description: statusDescription,
        type: 'string',
        readonly: true,
        value: '',
        group: 'Privacy Controls',
      },

      // Master enable switch
      {
        key: 'privacyEnabled',
        title: 'Enable Privacy Controls',
        description: 'Enable privacy controls for this camera',
        type: 'boolean',
        value: this.config.enabled,
        group: 'Privacy Controls',
      },

      // Individual controls
      {
        key: 'blockRecording',
        title: 'Block Recording',
        description: 'Prevent this camera from recording video',
        type: 'boolean',
        value: this.config.manualSettings.blockRecording,
        group: 'Privacy Controls',
      },
      {
        key: 'blockEvents',
        title: 'Block Events',
        description: 'Suppress motion and detection events',
        type: 'boolean',
        value: this.config.manualSettings.blockEvents,
        group: 'Privacy Controls',
      },
      {
        key: 'blockStreaming',
        title: 'Block Streaming',
        description: 'Block live video streaming and snapshots',
        type: 'boolean',
        value: this.config.manualSettings.blockStreaming,
        group: 'Privacy Controls',
      },
      {
        key: 'blockDetection',
        title: 'Block Detection',
        description: 'Disable object detection processing',
        type: 'boolean',
        value: this.config.manualSettings.blockDetection,
        group: 'Privacy Controls',
      },
      {
        key: 'blockMotionAlerts',
        title: 'Block Motion Alerts',
        description: 'Suppress motion detection alerts',
        type: 'boolean',
        value: this.config.manualSettings.blockMotionAlerts,
        group: 'Privacy Controls',
      },

      // Schedule settings
      {
        key: 'scheduleEnabled',
        title: 'Enable Schedule',
        description: 'Automatically apply privacy settings on a schedule',
        type: 'boolean',
        value: this.config.schedule.enabled,
        group: 'Schedule',
      },
      {
        key: 'scheduleType',
        title: 'Schedule Type',
        description: 'When to apply scheduled privacy settings',
        type: 'string',
        choices: ['daily', 'weekdays', 'weekends', 'custom'],
        value: this.config.schedule.type,
        group: 'Schedule',
      },
      {
        key: 'scheduleStartTime',
        title: 'Privacy Start Time',
        description: 'Time when privacy mode activates (HH:MM)',
        type: 'string',
        placeholder: '08:00',
        value: this.config.schedule.startTime,
        group: 'Schedule',
      },
      {
        key: 'scheduleEndTime',
        title: 'Privacy End Time',
        description: 'Time when privacy mode deactivates (HH:MM)',
        type: 'string',
        placeholder: '22:00',
        value: this.config.schedule.endTime,
        group: 'Schedule',
      },
    ];

    // Add custom days setting if type is custom
    if (this.config.schedule.type === 'custom') {
      settings.push({
        key: 'scheduleDays',
        title: 'Schedule Days',
        description: 'Days when schedule is active (0=Sun, 6=Sat)',
        type: 'string',
        value: this.config.schedule.days.join(','),
        group: 'Schedule',
      });
    }

    // Add schedule info
    if (this.config.schedule.enabled) {
      settings.push({
        key: 'scheduleInfo',
        title: 'Schedule Status',
        description: scheduleInfo.nextChange
          ? `Next change: ${scheduleInfo.nextChange.toLocaleString()}`
          : 'No upcoming changes',
        type: 'string',
        readonly: true,
        value: '',
        group: 'Schedule',
      });
    }

    return settings;
  }

  async putMixinSetting(key: string, value: SettingValue): Promise<void> {
    const previousSettings = { ...this.config.manualSettings };

    switch (key) {
      case 'privacyEnabled':
        this.config.enabled = value === true || value === 'true';
        break;

      case 'blockRecording':
        this.config.manualSettings.blockRecording = value === true || value === 'true';
        break;

      case 'blockEvents':
        this.config.manualSettings.blockEvents = value === true || value === 'true';
        break;

      case 'blockStreaming':
        this.config.manualSettings.blockStreaming = value === true || value === 'true';
        break;

      case 'blockDetection':
        this.config.manualSettings.blockDetection = value === true || value === 'true';
        break;

      case 'blockMotionAlerts':
        this.config.manualSettings.blockMotionAlerts = value === true || value === 'true';
        break;

      case 'scheduleEnabled':
        this.config.schedule.enabled = value === true || value === 'true';
        if (this.config.schedule.enabled) {
          this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
        } else {
          this.plugin.scheduleManager.removeSchedule(this.id);
        }
        break;

      case 'scheduleType':
        this.config.schedule.type = value as ScheduleType;
        if (this.config.schedule.type !== 'custom') {
          this.config.schedule.days = getDaysForScheduleType(this.config.schedule.type);
        }
        if (this.config.schedule.enabled) {
          this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
        }
        break;

      case 'scheduleStartTime':
        if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
          this.config.schedule.startTime = value;
          if (this.config.schedule.enabled) {
            this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
          }
        }
        break;

      case 'scheduleEndTime':
        if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
          this.config.schedule.endTime = value;
          if (this.config.schedule.enabled) {
            this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
          }
        }
        break;

      case 'scheduleDays':
        if (typeof value === 'string') {
          const days = value.split(',')
            .map(d => parseInt(d.trim(), 10))
            .filter(d => d >= 0 && d <= 6) as DayOfWeek[];
          this.config.schedule.days = days;
          if (this.config.schedule.enabled) {
            this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
          }
        }
        break;
    }

    // Save config
    this.saveConfig();

    // Update effective settings
    this.updateEffectiveSettings();

    // Log manual change if privacy settings changed
    if (JSON.stringify(previousSettings) !== JSON.stringify(this.config.manualSettings)) {
      this.plugin.auditLogger.logManualChange(
        this.id,
        this.name,
        previousSettings,
        this.config.manualSettings
      );
    }
  }

  // ============ Lifecycle ============

  async release(): Promise<void> {
    this.plugin.scheduleManager.removeSchedule(this.id);
    this.console.log(`[Privacy] Released mixin for ${this.name}`);
  }
}
