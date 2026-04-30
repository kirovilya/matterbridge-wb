/**
 * Matterbridge Wirenboard Plugin - подключение устройств Wirenboard к Matter.
 */

import { MatterbridgeDynamicPlatform, PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { WbDeviceFactory } from './WbDeviceFactory.js';
import { WbMqttClient } from './WbMqttClient.js';

/**
 * Инициализация плагина.
 *
 * @param {unknown} matterbridge Экземпляр matterbridge.
 * @param {AnsiLogger} log Логгер.
 * @param {PlatformConfig} config Конфигурация платформы.
 * @returns {WirenboardPlatform} Экземпляр платформы.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): WirenboardPlatform {
  return new WirenboardPlatform(matterbridge, log, config);
}

export class WirenboardPlatform extends MatterbridgeDynamicPlatform {
  private mqttClient: WbMqttClient | undefined;
  private deviceFactory: WbDeviceFactory | undefined;

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.4.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend."`,
      );
    }

    this.log.info(`Initializing Wirenboard Platform...`);

    const host = String(this.config.host || 'mqtt://localhost');
    const port = Number(this.config.port || 1883);
    const username = String(this.config.username || '');
    const password = String(this.config.password || '');
    const clientId = String(this.config.clientId || '');
    const protocolVersion = Number(this.config.protocolVersion || 5);
    const debug = Boolean(this.config.debug || false);
    const language = String(this.config.language || 'ru');

    this.mqttClient = new WbMqttClient(host, port, username, password, clientId, protocolVersion as 3 | 4 | 5, debug, language);

    this.deviceFactory = new WbDeviceFactory(log, {
      aggregatorVendorId: this.matterbridge.aggregatorVendorId,
      language: language,
    });
  }

  override async onStart(_reason?: string): Promise<void> {
    this.log.info(`Starting Wirenboard...`);

    await this.ready;
    await this.clearSelect();

    await this.mqttClient?.start();

    // Ждём подключения MQTT
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Повторный поиск после получения данных
    await this.discoverDevices();
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info('onConfigure called');

    for (const device of this.getDevices()) {
      this.log.info(`Configuring device: ${device.uniqueId}`);
    }
  }

  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    await super.onShutdown(reason);

    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);
    await this.mqttClient?.stop();
    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }

  private async discoverDevices(): Promise<void> {
    this.log.info('Discovering Wirenboard devices...');

    const devices = this.mqttClient?.getDevices() || [];
    this.log.info(`Found ${devices.length} Wirenboard devices:`);

    await this.clearSelect();

    for (const wbDevice of devices) {
      this.log.info(`  - ${wbDevice.name} (${wbDevice.id})`);

      const whiteList = (this.config.whiteList as string[]) || [];
      const blackList = (this.config.blackList as string[]) || [];

      const matchesWhiteList = whiteList.length === 0 || whiteList.includes(wbDevice.id) || whiteList.includes(wbDevice.name);
      const isBlacklisted = blackList.includes(wbDevice.id) || blackList.includes(wbDevice.name);

      if (!matchesWhiteList || isBlacklisted) {
        this.log.info(`    Skipping (not in whiteList or in blackList)`);
        continue;
      }

      const controls = this.mqttClient?.getControls(wbDevice.id) || [];
      if (controls.length === 0) {
        this.log.info(`    No controls, skipping`);
        continue;
      }

      const matterDevices = this.deviceFactory?.createDevices(wbDevice, controls, (deviceId, controlId) => this.mqttClient?.getState(deviceId, controlId), {
        setState: async (deviceId, controlId, value) => this.mqttClient?.setState(deviceId, controlId, value),
      });

      if (!matterDevices || matterDevices.length === 0) {
        continue;
      }

      this.setSelectDevice(wbDevice.id, wbDevice.name, undefined, 'wifi');
      if (!this.validateDevice([wbDevice.name, wbDevice.id], true)) {
        this.log.info(`    Skipping (not selected in UI)`);
        continue;
      }

      let deviceIndex = 0;

      for (const matterDevice of matterDevices) {
        if (deviceIndex > 0) {
          matterDevice.name = `${wbDevice.name}_${deviceIndex}`;
        }
        await this.registerDevice(matterDevice);
        deviceIndex++;
      }

      this.log.info(`    Registered ${matterDevices.length} Matter endpoint(s)`);
    }

    this.log.info(`Registered to Matter bridge`);
  }
}
