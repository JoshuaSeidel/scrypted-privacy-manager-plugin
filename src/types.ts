import { ScryptedInterface } from '@scrypted/sdk';

/**
 * Privacy settings that can be applied to a camera
 */
export interface PrivacySettings {
  /** Block video recording */
  blockRecording: boolean;
  /** Block motion/object detection events */
  blockEvents: boolean;
  /** Block live streaming access */
  blockStreaming: boolean;
  /** Block object detection processing */
  blockDetection: boolean;
  /** Block motion alerts/notifications */
  blockMotionAlerts: boolean;
}

/**
 * Default privacy settings - everything allowed
 */
export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  blockRecording: false,
  blockEvents: false,
  blockStreaming: false,
  blockDetection: false,
  blockMotionAlerts: false,
};

/**
 * Full privacy - everything blocked
 */
export const FULL_PRIVACY_SETTINGS: PrivacySettings = {
  blockRecording: true,
  blockEvents: true,
  blockStreaming: true,
  blockDetection: true,
  blockMotionAlerts: true,
};

/**
 * Schedule type options
 */
export type ScheduleType = 'daily' | 'weekdays' | 'weekends' | 'custom';

/**
 * Day of week (0 = Sunday, 6 = Saturday)
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Time-based schedule configuration
 */
export interface PrivacySchedule {
  /** Whether scheduling is enabled */
  enabled: boolean;
  /** Type of schedule */
  type: ScheduleType;
  /** Start time in HH:MM format */
  startTime: string;
  /** End time in HH:MM format */
  endTime: string;
  /** Days of week (0=Sun, 6=Sat) for custom schedules */
  days: DayOfWeek[];
  /** What privacy settings to apply when schedule is active */
  settings: PrivacySettings;
}

/**
 * Default schedule - disabled
 * Privacy ON at startTime, Privacy OFF at endTime
 */
export const DEFAULT_SCHEDULE: PrivacySchedule = {
  enabled: false,
  type: 'daily',
  startTime: '08:00',
  endTime: '22:00',
  days: [0, 1, 2, 3, 4, 5, 6],
  settings: FULL_PRIVACY_SETTINGS,
};

/**
 * Per-camera privacy configuration
 */
export interface CameraPrivacyConfig {
  /** Whether privacy controls are enabled for this camera */
  enabled: boolean;
  /** Manual privacy settings (when not using schedule) */
  manualSettings: PrivacySettings;
  /** Time-based schedule */
  schedule: PrivacySchedule;
  /** Profile IDs this camera belongs to */
  profileIds: string[];
}

/**
 * Privacy profile configuration
 */
export interface PrivacyProfile {
  /** Unique profile ID */
  id: string;
  /** Display name */
  name: string;
  /** Camera IDs included in this profile */
  cameraIds: string[];
  /** Privacy settings to apply when active */
  settings: PrivacySettings;
  /** Optional auto-activation schedule */
  schedule?: PrivacySchedule;
  /** Whether profile is currently active */
  active: boolean;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Timestamp of the change */
  timestamp: number;
  /** Camera ID (null for global changes) */
  cameraId: string | null;
  /** Camera name */
  cameraName: string | null;
  /** Previous settings */
  previousSettings: PrivacySettings | null;
  /** New settings */
  newSettings: PrivacySettings;
  /** What triggered the change */
  trigger: 'manual' | 'schedule' | 'profile' | 'panic';
  /** Profile name if triggered by profile */
  profileName?: string;
}

/**
 * Webhook event payload
 */
export interface WebhookPayload {
  /** Event type */
  event: 'privacy_changed' | 'profile_activated' | 'panic_mode' | 'schedule_triggered';
  /** ISO timestamp */
  timestamp: string;
  /** Camera name (if applicable) */
  camera?: string;
  /** Camera ID (if applicable) */
  cameraId?: string;
  /** Profile name (if applicable) */
  profile?: string;
  /** Current privacy settings */
  settings?: PrivacySettings;
  /** What triggered the change */
  trigger: 'manual' | 'schedule' | 'profile' | 'panic';
  /** Additional details */
  details?: Record<string, any>;
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  /** Webhook URL */
  url: string;
  /** Events to send */
  events: WebhookPayload['event'][];
  /** Include camera details */
  includeCameraDetails: boolean;
  /** Custom headers */
  headers?: Record<string, string>;
}

/**
 * Global plugin settings stored in plugin storage
 */
export interface PluginSettings {
  /** Global panic mode - overrides everything */
  panicMode: boolean;
  /** Default settings for new cameras */
  defaultSettings: PrivacySettings;
  /** Webhook configuration */
  webhook: WebhookConfig | null;
  /** Audit log retention in days */
  auditLogRetentionDays: number;
  /** Created profiles */
  profiles: PrivacyProfile[];
}

/**
 * Default plugin settings
 */
export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  panicMode: false,
  defaultSettings: DEFAULT_PRIVACY_SETTINGS,
  webhook: null,
  auditLogRetentionDays: 30,
  profiles: [],
};

/**
 * Scrypted interfaces we add to cameras
 */
export const PRIVACY_MIXIN_INTERFACES = [
  ScryptedInterface.Settings,
  ScryptedInterface.VideoCamera,
  ScryptedInterface.Online,
];

/**
 * Storage keys
 */
export const STORAGE_KEYS = {
  PLUGIN_SETTINGS: 'pluginSettings',
  AUDIT_LOG: 'auditLog',
  CAMERA_CONFIG_PREFIX: 'cameraConfig:',
} as const;
