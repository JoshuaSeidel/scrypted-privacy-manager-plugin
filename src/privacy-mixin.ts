import sdk, {
  Camera,
  DeleteRecordingStreamOptions,
  MediaObject,
  MixinDeviceBase,
  MixinDeviceOptions,
  RecordingStreamThumbnailOptions,
  RequestMediaStreamOptions,
  RequestPictureOptions,
  RequestRecordingStreamOptions,
  ResponseMediaStreamOptions,
  ResponsePictureOptions,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
  VideoCamera,
  VideoRecorder,
  VideoRecorderManagement,
} from '@scrypted/sdk';
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

const { deviceManager } = sdk;

/**
 * Combined type for camera devices we support
 */
type SupportedDevice = VideoCamera & Camera & Settings & Partial<VideoRecorder> & Partial<VideoRecorderManagement>;

/**
 * Privacy Mixin - wraps a camera device to add privacy controls
 *
 * Note: We implement VideoRecorder to intercept recording requests and
 * control the recordingActive indicator when privacy mode blocks recording.
 */
export class PrivacyMixin
  extends MixinDeviceBase<SupportedDevice>
  implements VideoCamera, Camera, Settings
{
  private plugin: PrivacyManagerPlugin;
  private config: CameraPrivacyConfig;
  private effectiveSettings: PrivacySettings;

  constructor(
    options: MixinDeviceOptions<SupportedDevice>,
    plugin: PrivacyManagerPlugin
  ) {
    super(options);
    this.plugin = plugin;

    // Load config from storage (with migration support)
    const { config, migrated } = this.loadConfigWithMigration();
    this.config = config;

    // Only save if we migrated from old storage or this is first time setup
    if (migrated) {
      this.saveConfig();
    }

    // Calculate initial effective settings
    this.effectiveSettings = this.calculateEffectiveSettings();

    this.console.log(
      `[Privacy] Initialized mixin for ${this.name}: ${describeSettings(this.effectiveSettings)}`
    );

    // Register with schedule manager if available
    if (this.config.schedule.enabled && this.plugin?.scheduleManager) {
      this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
    }

    // Update NVR recording state based on initial settings
    // Use setImmediate to allow constructor to complete first
    setImmediate(() => this.updateRecordingIndicator());
  }

  /**
   * Get the shared plugin storage (not mixin storage)
   */
  private getPluginStorage(): Storage | undefined {
    return this.plugin?.getPluginStorage?.();
  }

  /**
   * Load configuration - tries plugin storage first, then migrates from mixin storage if needed
   * Returns both the config and whether migration occurred
   */
  private loadConfigWithMigration(): { config: CameraPrivacyConfig; migrated: boolean } {
    const key = `${STORAGE_KEYS.CAMERA_CONFIG_PREFIX}${this.id}`;
    const pluginStorage = this.getPluginStorage();

    const defaultConfig: CameraPrivacyConfig = {
      enabled: true,
      manualSettings: { ...DEFAULT_PRIVACY_SETTINGS },
      schedule: { ...DEFAULT_SCHEDULE },
      profileIds: [],
    };

    // Try plugin storage first (new location)
    const pluginStored = pluginStorage?.getItem(key);
    if (pluginStored) {
      this.console.log(`[Privacy] Loaded config from plugin storage for ${this.name}`);
      return { config: safeJsonParse(pluginStored, defaultConfig), migrated: false };
    }

    // Try mixin storage (old location) for migration
    const mixinStored = this.storage?.getItem(key);
    if (mixinStored) {
      this.console.log(`[Privacy] Migrating config from mixin storage for ${this.name}`);
      const config = safeJsonParse(mixinStored, defaultConfig);
      return { config, migrated: true };
    }

    this.console.log(`[Privacy] Using default config for ${this.name} (no existing config found)`);
    return { config: defaultConfig, migrated: false };
  }

  /**
   * Save configuration to plugin's storage (not mixin storage)
   * This ensures configs persist and are accessible from the main plugin
   */
  private saveConfig(): void {
    const key = `${STORAGE_KEYS.CAMERA_CONFIG_PREFIX}${this.id}`;
    const storage = this.getPluginStorage();
    if (storage) {
      storage.setItem(key, JSON.stringify(this.config));
      this.console.log(`[Privacy] Saved config to plugin storage for ${this.name}`);
    } else {
      // Fallback to mixin storage if plugin storage unavailable
      this.storage?.setItem(key, JSON.stringify(this.config));
      this.console.log(`[Privacy] Saved config to mixin storage for ${this.name} (fallback)`);
    }
  }

  /**
   * Calculate effective privacy settings considering panic mode, profiles, and schedules
   */
  private calculateEffectiveSettings(): PrivacySettings {
    // Panic mode overrides everything
    if (this.plugin?.isPanicModeActive?.()) {
      return { ...FULL_PRIVACY_SETTINGS };
    }

    // If privacy controls are disabled for this camera, allow everything
    if (!this.config?.enabled) {
      return { ...DEFAULT_PRIVACY_SETTINGS };
    }

    // Check schedule (if manager is initialized)
    let scheduleSettings = this.config.manualSettings;
    if (this.plugin?.scheduleManager) {
      scheduleSettings = this.plugin.scheduleManager.getEffectiveSettings(
        this.id,
        this.config.manualSettings
      );
    }

    // Check active profiles
    const activeProfile = this.plugin?.getActiveProfileForCamera?.(this.id);
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
      this.plugin?.onCameraSettingsChanged?.(
        this.id,
        this.name,
        previous,
        this.effectiveSettings
      );

      // When recording block state changes, update the recording indicator
      if (previous.blockRecording !== this.effectiveSettings.blockRecording) {
        this.console.log(
          `[Privacy] Recording block changed for ${this.name}: ${this.effectiveSettings.blockRecording ? 'BLOCKED' : 'allowed'}`
        );
        this.updateRecordingIndicator();
      }
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
    // Log stream requests for debugging
    this.console.log(`[Privacy] getVideoStream called for ${this.name}, destination: ${options?.destination}, blockRecording: ${this.effectiveSettings.blockRecording}, blockStreaming: ${this.effectiveSettings.blockStreaming}`);

    // Check streaming block
    if (this.effectiveSettings.blockStreaming) {
      this.console.log(`[Privacy] BLOCKED streaming for ${this.name}`);
      throw new Error('Streaming is blocked by privacy policy');
    }

    // Note: We no longer block recording via getVideoStream destination filtering.
    // Recording is now controlled via the 'recording:privacyMode' setting which
    // directly tells Scrypted NVR to stop recording. This is more reliable and
    // doesn't interfere with live streaming which may use similar destination names.

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

  // ============ VideoRecorder Interface ============
  // These methods intercept recording requests when privacy mode blocks recording.
  // Note: We don't implement VideoRecorder directly because MixinDeviceBase has
  // recordingActive as a property, not an accessor. Instead, we manually update
  // the property value when needed.

  /**
   * Update the NVR recording state based on privacy settings.
   * Uses the 'recording:privacyMode' setting to enable/disable Scrypted NVR recording.
   */
  private async updateRecordingIndicator(): Promise<void> {
    try {
      if (this.effectiveSettings.blockRecording) {
        // Enable NVR privacy mode to stop recording
        // This is the "Disable Scrypted NVR" setting in the camera's privacy options
        this.console.log(`[Privacy] Enabling NVR privacy mode for ${this.name} (recording blocked)`);
        await this.mixinDevice.putSetting('recording:privacyMode', true);

        // Also set our local recordingActive to false
        this.recordingActive = false;
      } else {
        // Disable NVR privacy mode to allow recording
        this.console.log(`[Privacy] Disabling NVR privacy mode for ${this.name} (recording allowed)`);
        await this.mixinDevice.putSetting('recording:privacyMode', false);
      }
    } catch (e) {
      this.console.log(`[Privacy] Could not update NVR privacy mode for ${this.name}: ${e}`);
    }
  }

  async getRecordingStream(
    options: RequestRecordingStreamOptions,
    recordingStream?: MediaObject
  ): Promise<MediaObject> {
    // Allow playback of existing recordings even when recording is blocked
    // We only want to prevent NEW recordings, not access to existing ones
    // The user should still be able to review footage from before privacy mode was enabled
    this.console.log(`[Privacy] getRecordingStream for ${this.name}, startTime: ${options?.startTime}`);

    if (!this.mixinDevice.getRecordingStream) {
      throw new Error('Device does not support recording streams');
    }

    return this.mixinDevice.getRecordingStream(options, recordingStream);
  }

  async getRecordingStreamCurrentTime(recordingStream: MediaObject): Promise<number> {
    // Allow getting current time for playback
    if (!this.mixinDevice.getRecordingStreamCurrentTime) {
      throw new Error('Device does not support recording streams');
    }

    return this.mixinDevice.getRecordingStreamCurrentTime(recordingStream);
  }

  async getRecordingStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    // Allow access to recording stream options for playback
    return this.mixinDevice.getRecordingStreamOptions?.() || [];
  }

  async getRecordingStreamThumbnail(
    time: number,
    options?: RecordingStreamThumbnailOptions
  ): Promise<MediaObject> {
    // Allow access to thumbnails from existing recordings
    if (!this.mixinDevice.getRecordingStreamThumbnail) {
      throw new Error('Device does not support recording thumbnails');
    }

    return this.mixinDevice.getRecordingStreamThumbnail(time, options);
  }

  // ============ VideoRecorderManagement Interface ============
  // This interface controls whether recording is active. By intercepting it,
  // we can prevent recording from being enabled when privacy mode blocks it.

  async setRecordingActive(recordingActive: boolean): Promise<void> {
    // If recording is blocked and someone is trying to enable it, block the request
    if (this.effectiveSettings.blockRecording && recordingActive) {
      this.console.log(`[Privacy] BLOCKED setRecordingActive(true) for ${this.name} - recording is blocked by privacy policy`);
      // Set our state to false
      this.recordingActive = false;
      return;
    }

    // Pass through to underlying device if it supports it
    if (this.mixinDevice.setRecordingActive) {
      this.console.log(`[Privacy] Passing setRecordingActive(${recordingActive}) to ${this.name}`);
      return this.mixinDevice.setRecordingActive(recordingActive);
    }
  }

  async deleteRecordingStream(options: DeleteRecordingStreamOptions): Promise<void> {
    // Allow deletion regardless of privacy settings
    if (this.mixinDevice.deleteRecordingStream) {
      return this.mixinDevice.deleteRecordingStream(options);
    }
    throw new Error('Device does not support recording stream deletion');
  }

  // ============ Settings Interface ============

  async getSettings(): Promise<Setting[]> {
    // Get base device settings first
    const baseSettings: Setting[] = [];
    if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Settings)) {
      try {
        const deviceSettings = await this.mixinDevice.getSettings();
        if (deviceSettings) {
          baseSettings.push(...deviceSettings);
        }
      } catch (e) {
        this.console.error('Failed to get device settings:', e);
      }
    }

    const scheduleInfo = this.plugin?.scheduleManager?.getScheduleInfo(this.id) ?? {
      isActive: false,
      nextChange: null,
      description: 'Not configured',
    };
    const activeProfile = this.plugin?.getActiveProfileForCamera?.(this.id);
    const isPanicMode = this.plugin?.isPanicModeActive?.() ?? false;

    // Build status value for display
    let statusValue = '';
    if (isPanicMode) {
      statusValue = '🚨 PANIC MODE ACTIVE';
    } else if (activeProfile) {
      statusValue = `📋 Profile "${activeProfile.name}" active`;
    } else if (scheduleInfo.isActive) {
      statusValue = `⏰ Schedule active: ${scheduleInfo.description}`;
    } else {
      statusValue = describeSettings(this.effectiveSettings);
    }

    const privacySettings: Setting[] = [
      // Status display
      {
        key: 'privacy:status',
        title: 'Current Status',
        description: 'Current effective privacy state for this camera',
        type: 'string',
        readonly: true,
        value: statusValue,
        group: 'Privacy Controls',
      },

      // Master enable switch
      {
        key: 'privacy:enabled',
        title: 'Enable Privacy Controls',
        description: 'Enable privacy controls for this camera',
        type: 'boolean',
        value: this.config.enabled,
        group: 'Privacy Controls',
      },

      // Individual controls
      {
        key: 'privacy:blockRecording',
        title: 'Block Recording',
        description: 'Prevent this camera from recording video',
        type: 'boolean',
        value: this.config.manualSettings.blockRecording,
        group: 'Privacy Controls',
      },
      {
        key: 'privacy:blockEvents',
        title: 'Block Events',
        description: 'Suppress motion and detection events',
        type: 'boolean',
        value: this.config.manualSettings.blockEvents,
        group: 'Privacy Controls',
      },
      {
        key: 'privacy:blockStreaming',
        title: 'Block Streaming',
        description: 'Block live video streaming and snapshots',
        type: 'boolean',
        value: this.config.manualSettings.blockStreaming,
        group: 'Privacy Controls',
      },
      {
        key: 'privacy:blockDetection',
        title: 'Block Detection',
        description: 'Disable object detection processing',
        type: 'boolean',
        value: this.config.manualSettings.blockDetection,
        group: 'Privacy Controls',
      },
      {
        key: 'privacy:blockMotionAlerts',
        title: 'Block Motion Alerts',
        description: 'Suppress motion detection alerts',
        type: 'boolean',
        value: this.config.manualSettings.blockMotionAlerts,
        group: 'Privacy Controls',
      },

      // Schedule settings
      {
        key: 'privacy:scheduleEnabled',
        title: 'Enable Schedule',
        description: 'Automatically apply privacy settings on a schedule',
        type: 'boolean',
        value: this.config.schedule.enabled,
        group: 'Privacy Schedule',
      },
      {
        key: 'privacy:scheduleType',
        title: 'Schedule Type',
        description: 'When to apply scheduled privacy settings',
        type: 'string',
        choices: ['daily', 'weekdays', 'weekends', 'custom'],
        value: this.config.schedule.type,
        group: 'Privacy Schedule',
      },
      {
        key: 'privacy:scheduleStartTime',
        title: 'Privacy ON at',
        description: 'Time when privacy mode turns ON and starts blocking (HH:MM)',
        type: 'string',
        placeholder: '08:00',
        value: this.config.schedule.startTime,
        group: 'Privacy Schedule',
      },
      {
        key: 'privacy:scheduleEndTime',
        title: 'Privacy OFF at',
        description: 'Time when privacy mode turns OFF and stops blocking (HH:MM)',
        type: 'string',
        placeholder: '22:00',
        value: this.config.schedule.endTime,
        group: 'Privacy Schedule',
      },
    ];

    // Add custom days setting if type is custom
    if (this.config.schedule.type === 'custom') {
      privacySettings.push({
        key: 'privacy:scheduleDays',
        title: 'Schedule Days',
        description: 'Days when schedule is active (0=Sun, 6=Sat)',
        type: 'string',
        value: this.config.schedule.days.join(','),
        group: 'Privacy Schedule',
      });
    }

    // Add schedule info
    if (this.config.schedule.enabled && scheduleInfo.nextChange) {
      privacySettings.push({
        key: 'privacy:scheduleInfo',
        title: 'Next Change',
        description: 'When the schedule will next toggle',
        type: 'string',
        readonly: true,
        value: scheduleInfo.nextChange.toLocaleString(),
        group: 'Privacy Schedule',
      });
    }

    return [...baseSettings, ...privacySettings];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    // Check if this is a privacy setting
    if (!key.startsWith('privacy:')) {
      // Pass through to underlying device
      return this.mixinDevice.putSetting(key, value);
    }

    const privacyKey = key.substring('privacy:'.length);
    const previousSettings = { ...this.config.manualSettings };

    switch (privacyKey) {
      case 'enabled':
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
        if (this.config.schedule.enabled && this.plugin?.scheduleManager) {
          this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
        } else if (this.plugin?.scheduleManager) {
          this.plugin.scheduleManager.removeSchedule(this.id);
        }
        break;

      case 'scheduleType':
        this.config.schedule.type = value as ScheduleType;
        if (this.config.schedule.type !== 'custom') {
          this.config.schedule.days = getDaysForScheduleType(this.config.schedule.type);
        }
        if (this.config.schedule.enabled && this.plugin?.scheduleManager) {
          this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
        }
        break;

      case 'scheduleStartTime':
        if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
          this.config.schedule.startTime = value;
          if (this.config.schedule.enabled && this.plugin?.scheduleManager) {
            this.plugin.scheduleManager.setSchedule(this.id, this.config.schedule);
          }
        }
        break;

      case 'scheduleEndTime':
        if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
          this.config.schedule.endTime = value;
          if (this.config.schedule.enabled && this.plugin?.scheduleManager) {
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
          if (this.config.schedule.enabled && this.plugin?.scheduleManager) {
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
      this.plugin?.auditLogger?.logManualChange(
        this.id,
        this.name,
        previousSettings,
        this.config.manualSettings
      );
    }

    // Notify settings changed
    deviceManager.onMixinEvent(this.id, this, ScryptedInterface.Settings, undefined);
  }

  // ============ Lifecycle ============

  async release(): Promise<void> {
    this.plugin?.scheduleManager?.removeSchedule(this.id);
    this.console.log(`[Privacy] Released mixin for ${this.name}`);
  }
}
