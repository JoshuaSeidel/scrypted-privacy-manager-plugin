import {
  WebhookPayload,
  WebhookConfig,
  PrivacySettings,
} from './types';

/**
 * Manages webhook notifications for privacy events
 */
export class WebhookManager {
  private config: WebhookConfig | null = null;
  private console: Console;
  private pendingRequests: Set<Promise<void>> = new Set();
  private retryCount: number = 3;
  private retryDelayMs: number = 1000;

  constructor(console: Console) {
    this.console = console;
  }

  /**
   * Configure the webhook
   */
  setConfig(config: WebhookConfig | null): void {
    this.config = config;

    if (config) {
      this.console.log(
        `[Webhook] Configured webhook to ${config.url} for events: ${config.events.join(', ')}`
      );
    } else {
      this.console.log('[Webhook] Webhook disabled');
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): WebhookConfig | null {
    return this.config;
  }

  /**
   * Check if webhook is enabled for a specific event
   */
  isEnabledFor(event: WebhookPayload['event']): boolean {
    return this.config !== null && this.config.events.includes(event);
  }

  /**
   * Send a privacy change notification
   */
  async notifyPrivacyChange(
    camera: string,
    cameraId: string,
    settings: PrivacySettings,
    trigger: WebhookPayload['trigger']
  ): Promise<void> {
    if (!this.isEnabledFor('privacy_changed')) {
      return;
    }

    const payload: WebhookPayload = {
      event: 'privacy_changed',
      timestamp: new Date().toISOString(),
      camera,
      cameraId,
      settings,
      trigger,
    };

    await this.send(payload);
  }

  /**
   * Send a profile activation notification
   */
  async notifyProfileActivated(
    profile: string,
    trigger: WebhookPayload['trigger'],
    details?: Record<string, any>
  ): Promise<void> {
    if (!this.isEnabledFor('profile_activated')) {
      return;
    }

    const payload: WebhookPayload = {
      event: 'profile_activated',
      timestamp: new Date().toISOString(),
      profile,
      trigger,
      details,
    };

    await this.send(payload);
  }

  /**
   * Send a panic mode notification
   */
  async notifyPanicMode(
    enabled: boolean,
    trigger: WebhookPayload['trigger']
  ): Promise<void> {
    if (!this.isEnabledFor('panic_mode')) {
      return;
    }

    const payload: WebhookPayload = {
      event: 'panic_mode',
      timestamp: new Date().toISOString(),
      trigger,
      details: { enabled },
    };

    await this.send(payload);
  }

  /**
   * Send a schedule trigger notification
   */
  async notifyScheduleTriggered(
    camera: string,
    cameraId: string,
    settings: PrivacySettings,
    action: 'start' | 'end'
  ): Promise<void> {
    if (!this.isEnabledFor('schedule_triggered')) {
      return;
    }

    const payload: WebhookPayload = {
      event: 'schedule_triggered',
      timestamp: new Date().toISOString(),
      camera,
      cameraId,
      settings,
      trigger: 'schedule',
      details: { action },
    };

    await this.send(payload);
  }

  /**
   * Send a webhook payload
   */
  private async send(payload: WebhookPayload): Promise<void> {
    if (!this.config) {
      return;
    }

    const request = this.sendWithRetry(payload);
    this.pendingRequests.add(request);

    try {
      await request;
    } finally {
      this.pendingRequests.delete(request);
    }
  }

  /**
   * Send with retry logic
   */
  private async sendWithRetry(payload: WebhookPayload): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        await this.doSend(payload);
        this.console.log(`[Webhook] Sent ${payload.event} notification`);
        return;
      } catch (error) {
        lastError = error as Error;
        this.console.warn(
          `[Webhook] Attempt ${attempt}/${this.retryCount} failed: ${lastError.message}`
        );

        if (attempt < this.retryCount) {
          await this.sleep(this.retryDelayMs * attempt);
        }
      }
    }

    this.console.error(`[Webhook] Failed to send ${payload.event} after ${this.retryCount} attempts`);
  }

  /**
   * Actually send the HTTP request
   */
  private async doSend(payload: WebhookPayload): Promise<void> {
    if (!this.config) {
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Scrypted-Privacy-Manager/1.0',
      ...this.config.headers,
    };

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  /**
   * Wait for all pending requests to complete
   */
  async flush(): Promise<void> {
    await Promise.all(this.pendingRequests);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test webhook connectivity
   */
  async test(): Promise<{ success: boolean; message: string }> {
    if (!this.config) {
      return { success: false, message: 'Webhook not configured' };
    }

    try {
      const testPayload: WebhookPayload = {
        event: 'privacy_changed',
        timestamp: new Date().toISOString(),
        trigger: 'manual',
        details: { test: true },
      };

      await this.doSend(testPayload);
      return { success: true, message: 'Webhook test successful' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Webhook test failed: ${message}` };
    }
  }
}
