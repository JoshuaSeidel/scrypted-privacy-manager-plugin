import {
  PrivacySettings,
  PrivacySchedule,
  DayOfWeek,
  ScheduleType,
  DEFAULT_PRIVACY_SETTINGS,
  FULL_PRIVACY_SETTINGS,
} from './types';

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Format minutes since midnight to HH:MM string
 */
export function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get current time as minutes since midnight
 */
export function getCurrentTimeMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Get current day of week (0 = Sunday, 6 = Saturday)
 */
export function getCurrentDayOfWeek(): DayOfWeek {
  return new Date().getDay() as DayOfWeek;
}

/**
 * Get days array for schedule type
 */
export function getDaysForScheduleType(type: ScheduleType): DayOfWeek[] {
  switch (type) {
    case 'daily':
      return [0, 1, 2, 3, 4, 5, 6];
    case 'weekdays':
      return [1, 2, 3, 4, 5];
    case 'weekends':
      return [0, 6];
    case 'custom':
    default:
      return [];
  }
}

/**
 * Check if current time is within a schedule
 */
export function isWithinSchedule(schedule: PrivacySchedule): boolean {
  if (!schedule.enabled) {
    return false;
  }

  const currentDay = getCurrentDayOfWeek();
  const currentTime = getCurrentTimeMinutes();

  // Get applicable days based on schedule type
  const applicableDays = schedule.type === 'custom'
    ? schedule.days
    : getDaysForScheduleType(schedule.type);

  // Check if today is an applicable day
  if (!applicableDays.includes(currentDay)) {
    return false;
  }

  const startMinutes = parseTimeToMinutes(schedule.startTime);
  const endMinutes = parseTimeToMinutes(schedule.endTime);

  // Handle overnight schedules (e.g., 22:00 - 06:00)
  if (startMinutes > endMinutes) {
    // Schedule spans midnight
    return currentTime >= startMinutes || currentTime < endMinutes;
  }

  // Normal schedule (e.g., 08:00 - 22:00)
  return currentTime >= startMinutes && currentTime < endMinutes;
}

/**
 * Calculate next schedule change time
 */
export function getNextScheduleChange(schedule: PrivacySchedule): Date | null {
  if (!schedule.enabled) {
    return null;
  }

  const now = new Date();
  const currentDay = getCurrentDayOfWeek();
  const currentTime = getCurrentTimeMinutes();

  const applicableDays = schedule.type === 'custom'
    ? schedule.days
    : getDaysForScheduleType(schedule.type);

  const startMinutes = parseTimeToMinutes(schedule.startTime);
  const endMinutes = parseTimeToMinutes(schedule.endTime);

  // Check if we're currently in schedule
  const inSchedule = isWithinSchedule(schedule);

  if (inSchedule) {
    // Return end time
    if (startMinutes > endMinutes && currentTime >= startMinutes) {
      // Overnight schedule, end is tomorrow
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
      return tomorrow;
    } else {
      // End is today
      const endTime = new Date(now);
      endTime.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
      return endTime;
    }
  } else {
    // Find next start time
    for (let i = 0; i < 7; i++) {
      const checkDay = ((currentDay + i) % 7) as DayOfWeek;
      if (applicableDays.includes(checkDay)) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + i);

        // If it's today, check if start time is in the future
        if (i === 0 && currentTime >= startMinutes) {
          continue; // Start time has passed today
        }

        targetDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
        return targetDate;
      }
    }
  }

  return null;
}

/**
 * Merge privacy settings (later settings override earlier)
 */
export function mergePrivacySettings(...settings: Partial<PrivacySettings>[]): PrivacySettings {
  return settings.reduce<PrivacySettings>(
    (merged, current) => ({ ...merged, ...current }),
    { ...DEFAULT_PRIVACY_SETTINGS }
  );
}

/**
 * Check if privacy settings are effectively "full privacy" (all blocked)
 */
export function isFullPrivacy(settings: PrivacySettings): boolean {
  return (
    settings.blockRecording &&
    settings.blockEvents &&
    settings.blockStreaming &&
    settings.blockDetection &&
    settings.blockMotionAlerts
  );
}

/**
 * Check if privacy settings are effectively "no privacy" (nothing blocked)
 */
export function isNoPrivacy(settings: PrivacySettings): boolean {
  return (
    !settings.blockRecording &&
    !settings.blockEvents &&
    !settings.blockStreaming &&
    !settings.blockDetection &&
    !settings.blockMotionAlerts
  );
}

/**
 * Check if two privacy settings objects are equal
 */
export function areSettingsEqual(a: PrivacySettings, b: PrivacySettings): boolean {
  return (
    a.blockRecording === b.blockRecording &&
    a.blockEvents === b.blockEvents &&
    a.blockStreaming === b.blockStreaming &&
    a.blockDetection === b.blockDetection &&
    a.blockMotionAlerts === b.blockMotionAlerts
  );
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format date for display
 */
export function formatDate(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format day names
 */
export function formatDays(days: DayOfWeek[]): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (days.length === 7) return 'Every day';
  if (days.length === 0) return 'Never';

  const sortedDays = [...days].sort((a, b) => a - b);

  // Check for weekdays
  if (sortedDays.length === 5 && sortedDays.every((d, i) => d === i + 1)) {
    return 'Weekdays';
  }

  // Check for weekends
  if (sortedDays.length === 2 && sortedDays[0] === 0 && sortedDays[1] === 6) {
    return 'Weekends';
  }

  return sortedDays.map(d => dayNames[d]).join(', ');
}

/**
 * Describe privacy settings in human-readable format
 */
export function describeSettings(settings: PrivacySettings): string {
  if (isFullPrivacy(settings)) {
    return 'Full Privacy (all blocked)';
  }
  if (isNoPrivacy(settings)) {
    return 'No Privacy (all allowed)';
  }

  const blocked: string[] = [];
  if (settings.blockRecording) blocked.push('Recording');
  if (settings.blockEvents) blocked.push('Events');
  if (settings.blockStreaming) blocked.push('Streaming');
  if (settings.blockDetection) blocked.push('Detection');
  if (settings.blockMotionAlerts) blocked.push('Motion Alerts');

  return `Blocking: ${blocked.join(', ')}`;
}

/**
 * Describe schedule in human-readable format
 */
export function describeSchedule(schedule: PrivacySchedule): string {
  if (!schedule.enabled) {
    return 'Schedule disabled';
  }

  const days = formatDays(
    schedule.type === 'custom' ? schedule.days : getDaysForScheduleType(schedule.type)
  );

  return `${days} ${schedule.startTime} - ${schedule.endTime}`;
}

/**
 * Safely parse JSON with a default value
 */
export function safeJsonParse<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (this: any, ...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
