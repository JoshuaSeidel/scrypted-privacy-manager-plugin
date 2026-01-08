import sdk, {
  MixinProvider,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
  WritableDeviceState,
  MixinDeviceBase,
  MixinDeviceOptions,
} from '@scrypted/sdk';

const { deviceManager } = sdk;

class MinimalMixin extends MixinDeviceBase<any> implements Settings {
  constructor(options: MixinDeviceOptions<any>) {
    super(options);
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        key: 'test',
        title: 'Test Setting',
        type: 'boolean',
        value: false,
      }
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    // noop
  }
}

export class PrivacyManagerPlugin extends ScryptedDeviceBase implements MixinProvider, Settings {
  constructor() {
    super();
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[] | null> {
    if (type !== ScryptedDeviceType.Camera && type !== ScryptedDeviceType.Doorbell) {
      return null;
    }
    if (!interfaces.includes(ScryptedInterface.VideoCamera)) {
      return null;
    }
    return [ScryptedInterface.Settings];
  }

  async getMixin(
    mixinDevice: any,
    mixinDeviceInterfaces: ScryptedInterface[],
    mixinDeviceState: WritableDeviceState
  ): Promise<any> {
    return new MinimalMixin({
      mixinDevice,
      mixinDeviceInterfaces,
      mixinDeviceState,
      mixinProviderNativeId: this.nativeId,
    });
  }

  async releaseMixin(id: string, mixinDevice: any): Promise<void> {
    // noop
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        key: 'status',
        title: 'Status',
        description: 'Plugin is running',
        type: 'string',
        readonly: true,
        value: 'OK',
      }
    ];
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    // noop
  }
}

export default PrivacyManagerPlugin;
