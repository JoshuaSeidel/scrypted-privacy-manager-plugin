import sdk, {
  OnOff,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
} from '@scrypted/sdk';
import {
  PrivacyProfile,
  PrivacySettings,
  PrivacySchedule,
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_SCHEDULE,
  FULL_PRIVACY_SETTINGS,
} from './types';
import { describeSettings, describeSchedule, generateId, safeJsonParse } from './utils';
import type { PrivacyManagerPlugin } from './main';

const { deviceManager, systemManager } = sdk;

/**
 * Privacy Profile Device - represents a named privacy preset
 * Implements OnOff for Home Assistant integration
 */
export class PrivacyProfileDevice extends ScryptedDeviceBase implements OnOff, Settings {
  private plugin: PrivacyManagerPlugin;
  private profile: PrivacyProfile;

  constructor(nativeId: string, plugin: PrivacyManagerPlugin) {
    super(nativeId);
    this.plugin = plugin;

    // Load profile from storage
    const stored = this.storage.getItem('profile');
    this.profile = safeJsonParse<PrivacyProfile>(stored, {
      id: nativeId,
      name: 'New Profile',
      cameraIds: [],
      settings: { ...FULL_PRIVACY_SETTINGS },
      active: false,
    });

    // Sync the on state
    this.on = this.profile.active;
  }

  /**
   * Get the profile data
   */
  getProfile(): PrivacyProfile {
    return this.profile;
  }

  /**
   * Update the profile data
   */
  updateProfile(updates: Partial<PrivacyProfile>): void {
    this.profile = { ...this.profile, ...updates };
    this.saveProfile();
  }

  /**
   * Save profile to storage
   */
  private saveProfile(): void {
    this.storage.setItem('profile', JSON.stringify(this.profile));
  }

  // ============ OnOff Interface (for Home Assistant) ============

  async turnOn(): Promise<void> {
    if (this.profile.active) {
      return;
    }

    this.console.log(`[Profile] Activating profile: ${this.profile.name}`);

    // Deactivate other profiles first
    await this.plugin.deactivateAllProfiles();

    // Activate this profile
    this.profile.active = true;
    this.on = true;
    this.saveProfile();

    // Apply settings to all cameras in this profile
    for (const cameraId of this.profile.cameraIds) {
      const mixin = this.plugin.getMixinForCamera(cameraId);
      if (mixin) {
        mixin.updateEffectiveSettings();
      }
    }

    // Notify via webhook
    this.plugin.webhookManager.notifyProfileActivated(
      this.profile.name,
      'manual',
      { cameraCount: this.profile.cameraIds.length }
    );

    // Log to audit
    for (const cameraId of this.profile.cameraIds) {
      const camera = systemManager.getDeviceById(cameraId);
      if (camera) {
        this.plugin.auditLogger.logProfileActivation(
          cameraId,
          camera.name,
          null,
          this.profile.settings,
          this.profile.name
        );
      }
    }
  }

  async turnOff(): Promise<void> {
    if (!this.profile.active) {
      return;
    }

    this.console.log(`[Profile] Deactivating profile: ${this.profile.name}`);

    this.profile.active = false;
    this.on = false;
    this.saveProfile();

    // Update all cameras in this profile to recalculate their settings
    for (const cameraId of this.profile.cameraIds) {
      const mixin = this.plugin.getMixinForCamera(cameraId);
      if (mixin) {
        mixin.updateEffectiveSettings();
      }
    }
  }

  // ============ Settings Interface ============

  async getSettings(): Promise<Setting[]> {
    const settings: Setting[] = [
      {
        key: 'profileName',
        title: 'Profile Name',
        description: 'Display name for this profile',
        type: 'string',
        value: this.profile.name,
        group: 'Profile Settings',
      },
      {
        key: 'profileCameras',
        title: 'Cameras',
        description: 'Cameras included in this profile',
        type: 'device',
        multiple: true,
        deviceFilter: `interfaces.includes("${ScryptedInterface.VideoCamera}")`,
        value: this.profile.cameraIds,
        group: 'Profile Settings',
      },

      // Privacy settings for this profile
      {
        key: 'profileBlockRecording',
        title: 'Block Recording',
        description: 'Block recording when profile is active',
        type: 'boolean',
        value: this.profile.settings.blockRecording,
        group: 'Privacy Settings',
      },
      {
        key: 'profileBlockEvents',
        title: 'Block Events',
        description: 'Block events when profile is active',
        type: 'boolean',
        value: this.profile.settings.blockEvents,
        group: 'Privacy Settings',
      },
      {
        key: 'profileBlockStreaming',
        title: 'Block Streaming',
        description: 'Block streaming when profile is active',
        type: 'boolean',
        value: this.profile.settings.blockStreaming,
        group: 'Privacy Settings',
      },
      {
        key: 'profileBlockDetection',
        title: 'Block Detection',
        description: 'Block detection when profile is active',
        type: 'boolean',
        value: this.profile.settings.blockDetection,
        group: 'Privacy Settings',
      },
      {
        key: 'profileBlockMotionAlerts',
        title: 'Block Motion Alerts',
        description: 'Block motion alerts when profile is active',
        type: 'boolean',
        value: this.profile.settings.blockMotionAlerts,
        group: 'Privacy Settings',
      },

      // Status
      {
        key: 'profileStatus',
        title: 'Status',
        description: this.profile.active
          ? `✅ Active - ${this.profile.cameraIds.length} camera(s)`
          : `⏸️ Inactive`,
        type: 'string',
        readonly: true,
        value: '',
        group: 'Status',
      },
    ];

    return settings;
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    switch (key) {
      case 'profileName':
        this.profile.name = value as string;
        // Update device name
        await deviceManager.onDeviceDiscovered({
          nativeId: this.nativeId,
          name: `Privacy: ${this.profile.name}`,
          type: ScryptedDeviceType.Switch,
          interfaces: [
            ScryptedInterface.OnOff,
            ScryptedInterface.Settings,
          ],
        });
        break;

      case 'profileCameras':
        this.profile.cameraIds = Array.isArray(value) ? value as string[] : [];
        break;

      case 'profileBlockRecording':
        this.profile.settings.blockRecording = value === true || value === 'true';
        break;

      case 'profileBlockEvents':
        this.profile.settings.blockEvents = value === true || value === 'true';
        break;

      case 'profileBlockStreaming':
        this.profile.settings.blockStreaming = value === true || value === 'true';
        break;

      case 'profileBlockDetection':
        this.profile.settings.blockDetection = value === true || value === 'true';
        break;

      case 'profileBlockMotionAlerts':
        this.profile.settings.blockMotionAlerts = value === true || value === 'true';
        break;
    }

    this.saveProfile();

    // If profile is active, update all affected cameras
    if (this.profile.active) {
      for (const cameraId of this.profile.cameraIds) {
        const mixin = this.plugin.getMixinForCamera(cameraId);
        if (mixin) {
          mixin.updateEffectiveSettings();
        }
      }
    }
  }
}

/**
 * Panic Mode Device - global emergency privacy switch
 */
export class PanicModeDevice extends ScryptedDeviceBase implements OnOff, Settings {
  private plugin: PrivacyManagerPlugin;

  constructor(nativeId: string, plugin: PrivacyManagerPlugin) {
    super(nativeId);
    this.plugin = plugin;

    // Sync state
    this.on = this.plugin.isPanicModeActive();
  }

  // ============ OnOff Interface ============

  async turnOn(): Promise<void> {
    this.console.log('[Panic] Activating PANIC MODE - All cameras going to full privacy');

    await this.plugin.setPanicMode(true);
    this.on = true;
  }

  async turnOff(): Promise<void> {
    this.console.log('[Panic] Deactivating panic mode - Cameras returning to normal');

    await this.plugin.setPanicMode(false);
    this.on = false;
  }

  // ============ Settings Interface ============

  async getSettings(): Promise<Setting[]> {
    return [
      {
        key: 'panicStatus',
        title: 'Status',
        description: this.on
          ? `🚨 PANIC MODE ACTIVE - All cameras are in full privacy mode`
          : `✅ Normal - Cameras are operating normally`,
        type: 'string',
        readonly: true,
        value: '',
        group: 'Panic Mode',
      },
      {
        key: 'panicInfo',
        title: 'About Panic Mode',
        description:
          'When activated, Panic Mode immediately blocks all recording, streaming, ' +
          'events, and detection on ALL cameras. This overrides all other settings, ' +
          'schedules, and profiles. Use this for immediate privacy when needed.',
        type: 'string',
        readonly: true,
        value: '',
        group: 'Panic Mode',
      },
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    // No writable settings
  }

  /**
   * Update the on state from plugin
   */
  syncState(panicActive: boolean): void {
    this.on = panicActive;
  }
}
