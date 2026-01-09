import sdk, {
  DeviceCreator,
  DeviceCreatorSettings,
  DeviceProvider,
  HttpRequest,
  HttpRequestHandler,
  HttpResponse,
  MixinDeviceOptions,
  MixinProvider,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedNativeId,
  Setting,
  Settings,
  SettingValue,
  WritableDeviceState,
} from '@scrypted/sdk';

import {
  PluginSettings,
  PrivacyProfile,
  PrivacySettings,
  WebhookConfig,
  DEFAULT_PLUGIN_SETTINGS,
  DEFAULT_PRIVACY_SETTINGS,
  FULL_PRIVACY_SETTINGS,
  STORAGE_KEYS,
} from './types';
import { safeJsonParse, generateId, describeSettings } from './utils';
import { AuditLogger } from './audit-logger';
import { ScheduleManager } from './schedule-manager';
import { WebhookManager } from './webhook-manager';
import { PrivacyMixin } from './privacy-mixin';
import { PrivacyProfileDevice, PanicModeDevice } from './privacy-profile';

const { deviceManager, systemManager } = sdk;

/**
 * Native IDs for built-in devices
 */
const PANIC_MODE_NATIVE_ID = 'panic-mode';

/**
 * Privacy Manager Plugin
 *
 * Provides granular privacy controls for cameras with:
 * - Per-camera settings (recording, events, streaming, detection)
 * - Time-based scheduling
 * - Named profiles (Night Mode, Away Mode, etc.)
 * - Global panic button
 * - Home Assistant integration
 * - Webhook notifications
 * - Audit logging
 */
export class PrivacyManagerPlugin
  extends ScryptedDeviceBase
  implements DeviceProvider, MixinProvider, Settings, DeviceCreator, HttpRequestHandler
{
  // Managers (initialized lazily)
  public auditLogger!: AuditLogger;
  public scheduleManager!: ScheduleManager;
  public webhookManager!: WebhookManager;

  // Plugin storage
  private pluginSettings: PluginSettings = { ...DEFAULT_PLUGIN_SETTINGS };
  private initialized = false;

  /**
   * Get the plugin's storage for shared access by mixins
   */
  getPluginStorage(): Storage {
    return this.storage;
  }

  // Device tracking
  private privacyMixins: Map<string, PrivacyMixin> = new Map();
  private profileDevices: Map<string, PrivacyProfileDevice> = new Map();
  private panicModeDevice: PanicModeDevice | null = null;

  constructor() {
    super();

    // Initialize with defaults first
    this.pluginSettings = { ...DEFAULT_PLUGIN_SETTINGS };

    // Deferred initialization to ensure storage is ready
    setImmediate(() => this.initializePlugin());
  }

  /**
   * Initialize plugin after constructor completes
   */
  private initializePlugin(): void {
    try {
      // Load plugin settings from storage
      this.pluginSettings = this.loadPluginSettings();

      // Initialize managers
      this.auditLogger = new AuditLogger(
        this.storage,
        this.console,
        this.pluginSettings.auditLogRetentionDays
      );

      this.scheduleManager = new ScheduleManager(this.console);
      this.webhookManager = new WebhookManager(this.console);

      // Configure webhook if set
      if (this.pluginSettings.webhook) {
        this.webhookManager.setConfig(this.pluginSettings.webhook);
      }

      // Continue with async initialization
      this.initialize().catch(e => this.console.error('Initialize error:', e));
    } catch (e) {
      this.console?.error?.('Plugin initialization error:', e);
    }
  }

  /**
   * Initialize the plugin
   */
  private async initialize(): Promise<void> {
    this.console.log('[Privacy Manager] Initializing...');

    // Discover built-in devices
    await this.discoverDevices();

    // Start the schedule manager
    if (this.scheduleManager) {
      this.scheduleManager.start();

      // Register for schedule changes
      this.scheduleManager.onScheduleChange((cameraId, settings, reason) => {
        this.onScheduleTriggered(cameraId, settings, reason);
      });
    }

    // Apply retention policy to audit log
    if (this.auditLogger) {
      this.auditLogger.applyRetention();
    }

    this.initialized = true;
    this.console.log('[Privacy Manager] Initialized successfully');
  }

  /**
   * Load plugin settings from storage
   */
  private loadPluginSettings(): PluginSettings {
    const stored = this.storage.getItem(STORAGE_KEYS.PLUGIN_SETTINGS);
    return safeJsonParse(stored, DEFAULT_PLUGIN_SETTINGS);
  }

  /**
   * Save plugin settings to storage
   */
  private savePluginSettings(): void {
    this.storage.setItem(STORAGE_KEYS.PLUGIN_SETTINGS, JSON.stringify(this.pluginSettings));
  }

  /**
   * Discover built-in devices (panic mode, profiles)
   */
  private async discoverDevices(): Promise<void> {
    // Discover panic mode device
    await deviceManager.onDeviceDiscovered({
      nativeId: PANIC_MODE_NATIVE_ID,
      name: 'Privacy: Panic Mode',
      type: ScryptedDeviceType.Switch,
      interfaces: [
        ScryptedInterface.OnOff,
        ScryptedInterface.Settings,
      ],
    });

    // Discover profile devices
    for (const profile of this.pluginSettings.profiles) {
      await deviceManager.onDeviceDiscovered({
        nativeId: profile.id,
        name: `Privacy: ${profile.name}`,
        type: ScryptedDeviceType.Switch,
        interfaces: [
          ScryptedInterface.OnOff,
          ScryptedInterface.Settings,
        ],
      });
    }

    this.console.log(
      `[Privacy Manager] Discovered ${this.pluginSettings.profiles.length + 1} devices`
    );
  }

  // ============ MixinProvider Interface ============

  async canMixin(
    type: ScryptedDeviceType,
    interfaces: string[]
  ): Promise<string[] | null> {
    // Only mixin cameras and doorbells
    if (type !== ScryptedDeviceType.Camera && type !== ScryptedDeviceType.Doorbell) {
      return null;
    }

    // Must have VideoCamera interface
    if (!interfaces.includes(ScryptedInterface.VideoCamera)) {
      return null;
    }

    // Return interfaces we add
    return [
      ScryptedInterface.Settings,
      ScryptedInterface.VideoCamera,
      ScryptedInterface.Online,
    ];
  }

  async getMixin(
    mixinDevice: any,
    mixinDeviceInterfaces: ScryptedInterface[],
    mixinDeviceState: WritableDeviceState
  ): Promise<any> {
    const options: MixinDeviceOptions<any> = {
      mixinDevice,
      mixinDeviceInterfaces,
      mixinDeviceState,
      mixinProviderNativeId: this.nativeId,
    };

    const mixin = new PrivacyMixin(options, this);
    this.privacyMixins.set(mixinDeviceState.id, mixin);

    this.console.log(`[Privacy Manager] getMixin called for ${mixinDeviceState.id}, total mixins: ${this.privacyMixins.size}`);

    return mixin;
  }

  async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    const mixin = this.privacyMixins.get(id);
    if (mixin) {
      await mixin.release();
      this.privacyMixins.delete(id);
    }
  }

  // ============ DeviceProvider Interface ============

  async getDevice(nativeId: ScryptedNativeId): Promise<any> {
    if (nativeId === PANIC_MODE_NATIVE_ID) {
      if (!this.panicModeDevice) {
        this.panicModeDevice = new PanicModeDevice(nativeId, this);
      }
      return this.panicModeDevice;
    }

    // Check if it's a profile device
    if (!this.profileDevices.has(nativeId)) {
      const device = new PrivacyProfileDevice(nativeId, this);
      this.profileDevices.set(nativeId, device);
    }

    return this.profileDevices.get(nativeId);
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
    this.profileDevices.delete(nativeId);
    this.console.log(`[Privacy Manager] Released device: ${nativeId}`);
  }

  // ============ DeviceCreator Interface ============

  async getCreateDeviceSettings(): Promise<Setting[]> {
    return [
      {
        key: 'profileName',
        title: 'Profile Name',
        description: 'Name for the new privacy profile',
        type: 'string',
        placeholder: 'Night Mode',
      },
    ];
  }

  async createDevice(settings: DeviceCreatorSettings): Promise<string> {
    const profileName = settings.profileName?.toString() || 'New Profile';
    const nativeId = `profile-${generateId()}`;

    // Create profile
    const profile: PrivacyProfile = {
      id: nativeId,
      name: profileName,
      cameraIds: [],
      settings: { ...FULL_PRIVACY_SETTINGS },
      active: false,
    };

    // Add to plugin settings
    this.pluginSettings.profiles.push(profile);
    this.savePluginSettings();

    // Discover the device
    await deviceManager.onDeviceDiscovered({
      nativeId,
      name: `Privacy: ${profileName}`,
      type: ScryptedDeviceType.Switch,
      interfaces: [
        ScryptedInterface.OnOff,
        ScryptedInterface.Settings,
      ],
    });

    this.console.log(`[Privacy Manager] Created profile: ${profileName}`);

    return nativeId;
  }

  // ============ Settings Interface ============

  async getSettings(): Promise<Setting[]> {
    // Count cameras that have privacy controls enabled by checking storage
    // We can't rely on privacyMixins.size because mixins are created/destroyed dynamically
    let cameraCount = 0;
    try {
      // Get all devices and count those with our config prefix in storage
      const devices = Object.keys(systemManager.getSystemState());
      for (const deviceId of devices) {
        const key = `${STORAGE_KEYS.CAMERA_CONFIG_PREFIX}${deviceId}`;
        const config = this.storage.getItem(key);
        if (config) {
          cameraCount++;
        }
      }
    } catch (e) {
      // Fallback to mixin count if storage check fails
      cameraCount = this.privacyMixins.size;
    }
    const activeProfiles = this.pluginSettings.profiles?.filter(p => p.active) ?? [];

    // Count schedules from storage since schedule manager only tracks active mixins
    let totalSchedules = 0;
    let activeSchedules = 0;
    try {
      const devices = Object.keys(systemManager.getSystemState());
      for (const deviceId of devices) {
        const key = `${STORAGE_KEYS.CAMERA_CONFIG_PREFIX}${deviceId}`;
        const configStr = this.storage.getItem(key);
        if (configStr) {
          const config = safeJsonParse(configStr, null);
          if (config?.schedule?.enabled) {
            totalSchedules++;
            // Check if schedule is currently active using the utility
            const { isWithinSchedule } = require('./utils');
            if (isWithinSchedule(config.schedule)) {
              activeSchedules++;
            }
          }
        }
      }
    } catch (e) {
      // Fallback to schedule manager if storage check fails
      const scheduleStatus = this.scheduleManager?.getStatus() ?? { activeSchedules: 0, totalSchedules: 0 };
      totalSchedules = scheduleStatus.totalSchedules;
      activeSchedules = scheduleStatus.activeSchedules;
    }

    this.console.log(`[Privacy Manager] getSettings called, cameras with config: ${cameraCount}, schedules: ${activeSchedules}/${totalSchedules}`);

    const settings: Setting[] = [
      // Status
      {
        key: 'status',
        title: 'Status',
        description: this.pluginSettings.panicMode
          ? `🚨 PANIC MODE ACTIVE`
          : activeProfiles.length > 0
            ? `📋 Active profiles: ${activeProfiles.map(p => p.name).join(', ')}`
            : `✅ Normal operation`,
        type: 'string',
        readonly: true,
        value: '',
        group: 'Status',
      },
      {
        key: 'cameraCount',
        title: 'Cameras',
        description: `${cameraCount} camera(s) with privacy controls`,
        type: 'string',
        readonly: true,
        value: '',
        group: 'Status',
      },
      {
        key: 'scheduleStatus',
        title: 'Schedules',
        description: `${activeSchedules}/${totalSchedules} schedules active`,
        type: 'string',
        readonly: true,
        value: '',
        group: 'Status',
      },

      // Panic Mode
      {
        key: 'panicMode',
        title: 'Panic Mode',
        description: 'Emergency: Block ALL cameras immediately',
        type: 'boolean',
        value: this.pluginSettings.panicMode,
        group: 'Global Controls',
      },

      // Default Settings
      {
        key: 'defaultBlockRecording',
        title: 'Default: Block Recording',
        description: 'Default setting for new cameras',
        type: 'boolean',
        value: this.pluginSettings.defaultSettings.blockRecording,
        group: 'Default Settings',
      },
      {
        key: 'defaultBlockEvents',
        title: 'Default: Block Events',
        type: 'boolean',
        value: this.pluginSettings.defaultSettings.blockEvents,
        group: 'Default Settings',
      },
      {
        key: 'defaultBlockStreaming',
        title: 'Default: Block Streaming',
        type: 'boolean',
        value: this.pluginSettings.defaultSettings.blockStreaming,
        group: 'Default Settings',
      },
      {
        key: 'defaultBlockDetection',
        title: 'Default: Block Detection',
        type: 'boolean',
        value: this.pluginSettings.defaultSettings.blockDetection,
        group: 'Default Settings',
      },
      {
        key: 'defaultBlockMotionAlerts',
        title: 'Default: Block Motion Alerts',
        type: 'boolean',
        value: this.pluginSettings.defaultSettings.blockMotionAlerts,
        group: 'Default Settings',
      },

      // Webhook Settings
      {
        key: 'webhookUrl',
        title: 'Webhook URL',
        description: 'HTTP endpoint for privacy event notifications',
        type: 'string',
        placeholder: 'https://your-server.com/webhook',
        value: this.pluginSettings.webhook?.url || '',
        group: 'Webhook',
      },
      {
        key: 'webhookEvents',
        title: 'Webhook Events',
        description: 'Events to send to webhook',
        type: 'string',
        choices: ['privacy_changed', 'profile_activated', 'panic_mode', 'schedule_triggered'],
        multiple: true,
        value: this.pluginSettings.webhook?.events || [],
        group: 'Webhook',
      },
      {
        key: 'webhookTest',
        title: 'Test Webhook',
        description: 'Send a test notification to verify webhook configuration',
        type: 'button',
        group: 'Webhook',
      },

      // Audit Settings
      {
        key: 'auditLogRetention',
        title: 'Audit Log Retention (days)',
        description: 'How long to keep audit log entries',
        type: 'number',
        value: this.pluginSettings.auditLogRetentionDays,
        group: 'Audit',
      },
      {
        key: 'viewAuditLog',
        title: 'View Audit Log',
        description: 'View recent privacy setting changes',
        type: 'button',
        group: 'Audit',
      },
      {
        key: 'clearAuditLog',
        title: 'Clear Audit Log',
        description: 'Delete all audit log entries',
        type: 'button',
        group: 'Audit',
      },
    ];

    return settings;
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    switch (key) {
      case 'panicMode':
        await this.setPanicMode(value === true || value === 'true');
        break;

      case 'defaultBlockRecording':
        this.pluginSettings.defaultSettings.blockRecording = value === true || value === 'true';
        break;

      case 'defaultBlockEvents':
        this.pluginSettings.defaultSettings.blockEvents = value === true || value === 'true';
        break;

      case 'defaultBlockStreaming':
        this.pluginSettings.defaultSettings.blockStreaming = value === true || value === 'true';
        break;

      case 'defaultBlockDetection':
        this.pluginSettings.defaultSettings.blockDetection = value === true || value === 'true';
        break;

      case 'defaultBlockMotionAlerts':
        this.pluginSettings.defaultSettings.blockMotionAlerts = value === true || value === 'true';
        break;

      case 'webhookUrl':
        this.updateWebhookConfig({ url: value as string });
        break;

      case 'webhookEvents':
        const events = Array.isArray(value) ? value : [];
        this.updateWebhookConfig({ events: events as any[] });
        break;

      case 'webhookTest':
        if (this.webhookManager) {
          const result = await this.webhookManager.test();
          this.console.log(`[Webhook Test] ${result.message}`);
        }
        break;

      case 'auditLogRetention':
        const days = parseInt(value as string, 10) || 30;
        this.pluginSettings.auditLogRetentionDays = days;
        this.auditLogger?.setRetentionDays(days);
        break;

      case 'viewAuditLog':
        if (this.auditLogger) {
          const logs = await this.auditLogger.exportLogs();
          this.console.log('=== AUDIT LOG ===\n' + logs);
        }
        break;

      case 'clearAuditLog':
        await this.auditLogger?.clearLogs();
        break;
    }

    this.savePluginSettings();
  }

  // ============ HttpRequestHandler Interface ============

  async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;

    try {
      if (path === '/status') {
        const status = {
          panicMode: this.pluginSettings?.panicMode ?? false,
          profiles: (this.pluginSettings?.profiles ?? []).map(p => ({
            id: p.id,
            name: p.name,
            active: p.active,
            cameraCount: p.cameraIds.length,
          })),
          schedules: this.scheduleManager?.getStatus() ?? { activeSchedules: 0, totalSchedules: 0 },
        };

        response.send(JSON.stringify(status, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
        return;
      }

      if (path === '/audit') {
        const logs = this.auditLogger ? await this.auditLogger.exportLogsJson() : '[]';
        response.send(logs, {
          headers: { 'Content-Type': 'application/json' },
        });
        return;
      }

      if (path === '/panic' && request.method === 'POST') {
        const body = request.body ? JSON.parse(request.body) : {};
        await this.setPanicMode(body.enabled !== false);
        response.send(JSON.stringify({ success: true, panicMode: this.pluginSettings.panicMode }), {
          headers: { 'Content-Type': 'application/json' },
        });
        return;
      }

      response.send('Not Found', { code: 404 });
    } catch (error) {
      this.console.error('[HTTP] Request error:', error);
      response.send(JSON.stringify({ error: String(error) }), {
        code: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ============ Public API ============

  /**
   * Check if panic mode is active
   */
  isPanicModeActive(): boolean {
    return this.pluginSettings?.panicMode ?? false;
  }

  /**
   * Set panic mode
   */
  async setPanicMode(enabled: boolean): Promise<void> {
    if (this.pluginSettings.panicMode === enabled) {
      return;
    }

    this.pluginSettings.panicMode = enabled;
    this.savePluginSettings();

    // Update panic mode device
    if (this.panicModeDevice) {
      this.panicModeDevice.syncState(enabled);
    }

    // Update all mixins
    for (const mixin of this.privacyMixins.values()) {
      mixin.updateEffectiveSettings();
    }

    // Log and notify
    await this.auditLogger?.logPanicMode(
      enabled,
      null,
      enabled ? FULL_PRIVACY_SETTINGS : DEFAULT_PRIVACY_SETTINGS
    );

    await this.webhookManager?.notifyPanicMode(enabled, 'manual');

    this.console.log(`[Privacy Manager] Panic mode ${enabled ? 'ACTIVATED' : 'deactivated'}`);
  }

  /**
   * Get active profile for a camera
   */
  getActiveProfileForCamera(cameraId: string): PrivacyProfile | null {
    const profiles = this.pluginSettings?.profiles ?? [];
    for (const profile of profiles) {
      if (profile.active && profile.cameraIds.includes(cameraId)) {
        return profile;
      }
    }
    return null;
  }

  /**
   * Deactivate all profiles
   */
  async deactivateAllProfiles(): Promise<void> {
    const profiles = this.pluginSettings?.profiles ?? [];
    for (const profile of profiles) {
      if (profile.active) {
        profile.active = false;

        const device = this.profileDevices.get(profile.id);
        if (device) {
          await device.turnOff();
        }
      }
    }
    this.savePluginSettings();
  }

  /**
   * Get mixin for a camera
   */
  getMixinForCamera(cameraId: string): PrivacyMixin | undefined {
    return this.privacyMixins.get(cameraId);
  }

  /**
   * Called when a camera's settings change
   */
  onCameraSettingsChanged(
    cameraId: string,
    cameraName: string,
    previousSettings: PrivacySettings,
    newSettings: PrivacySettings
  ): void {
    // Notify via webhook
    this.webhookManager?.notifyPrivacyChange(
      cameraName,
      cameraId,
      newSettings,
      'manual'
    );
  }

  /**
   * Called when a schedule triggers
   */
  private onScheduleTriggered(
    cameraId: string,
    _settings: PrivacySettings,
    reason: 'schedule_start' | 'schedule_end'
  ): void {
    const mixin = this.privacyMixins.get(cameraId);
    if (!mixin) return;

    const cameraName = mixin.name;

    // Update the mixin - this recalculates effective settings
    mixin.updateEffectiveSettings();

    // Get the actual effective settings from the mixin
    const effectiveSettings = mixin.getEffectiveSettings();

    // Log the change
    this.auditLogger?.logScheduleChange(
      cameraId,
      cameraName,
      null,
      effectiveSettings
    );

    // Notify via webhook
    this.webhookManager?.notifyScheduleTriggered(
      cameraName,
      cameraId,
      effectiveSettings,
      reason === 'schedule_start' ? 'start' : 'end'
    );
  }

  /**
   * Update webhook configuration
   */
  private updateWebhookConfig(updates: Partial<WebhookConfig>): void {
    if (!this.pluginSettings.webhook) {
      this.pluginSettings.webhook = {
        url: '',
        events: ['privacy_changed'],
        includeCameraDetails: true,
      };
    }

    Object.assign(this.pluginSettings.webhook, updates);

    if (this.webhookManager) {
      if (this.pluginSettings.webhook.url) {
        this.webhookManager.setConfig(this.pluginSettings.webhook);
      } else {
        this.webhookManager.setConfig(null);
      }
    }

    this.savePluginSettings();
  }
}

export default PrivacyManagerPlugin;
