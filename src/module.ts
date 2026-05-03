/**
 * Matterbridge Wirenboard Plugin - подключение устройств Wirenboard к Matter.
 * 
 */

import { MatterbridgeDynamicPlatform, PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { WbDeviceFactory } from './WbDeviceFactory.js';
import { WbMqttClient } from './WbMqttClient.js';
import { 
  findMappingRule, 
  isZ2mExcluded
} from './wbControlMapping.js';

/**
 * Плагин для Wirenboard - подключает контролы WB как отдельные Matter устройства.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): WirenboardPlatform {
  return new WirenboardPlatform(matterbridge, log, config);
}

/**
 * Класс платформы Wirenboard.
 */
export class WirenboardPlatform extends MatterbridgeDynamicPlatform {
  private mqttClient: WbMqttClient | undefined;
  private deviceFactory: WbDeviceFactory | undefined;

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    // Проверяем версию Matterbridge
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.4.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.log.info(`Initializing Wirenboard Platform...`);

    // Читаем конфигурацию
    const host = String(this.config.host || 'mqtt://localhost');
    const port = Number(this.config.port || 1883);
    const username = String(this.config.username || '');
    const password = String(this.config.password || '');
    const clientId = String(this.config.clientId || '');
    const protocolVersion = Number(this.config.protocolVersion || 5);
    const debug = Boolean(this.config.debug || false);
    const language = String(this.config.language || 'ru');

    // Создаём MQTT клиент
    this.mqttClient = new WbMqttClient(host, port, username, password, clientId, protocolVersion as 3 | 4 | 5, debug, language);

    // Создаём фабрику устройств
    this.deviceFactory = new WbDeviceFactory(log, {
      aggregatorVendorId: this.matterbridge.aggregatorVendorId,
      language: language,
    });
  }

  /**
   * Запуск плагина.
   */
  override async onStart(_reason?: string): Promise<void> {
    this.log.info(`Starting Matterbridge Wirenboard plugin ...`);

    // Ждём готовности storage
    await this.ready;
    await this.clearSelect();

    // Запускаем MQTT клиент
    await this.mqttClient?.start();

    // Ждём получения данных с MQTT
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Запускаем обнаружение устройств
    await this.discoverDevices();
  }

  /**
   * Конфигурация - вызывается при запуске сервера Matter.
   */
  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info('onConfigure called');

    for (const device of this.getDevices()) {
      this.log.info(`Configuring device: ${device.uniqueId}`);
    }
  }

  /**
   * Изменение уровня логирования.
   */
  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  /**
   * Остановка плагина.
   */
  override async onShutdown(reason?: string): Promise<void> {
    await super.onShutdown(reason);

    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);
    
    // Останавливаем MQTT
    await this.mqttClient?.stop();
    
    // Если настроено - удаляем все устройства при остановке
    if (this.config.unregisterOnShutdown === true) {
      await this.unregisterAllDevices();
    }
  }

  /**
   * Основная функция обнаружения устройств.
   * Перебирает все WB устройства и их контролы, создаёт Matter устройства.
   */
  private async discoverDevices(): Promise<void> {
    this.log.info('Discovering Wirenboard devices...');

    // Получаем список WB устройств из MQTT
    const wbDevices = this.mqttClient?.getDevices() || [];
    this.log.info(`Found ${wbDevices.length} Wirenboard devices`);

    // Очищаем старые устройства
    await this.clearSelect();

    // Синхронизируем уже зарегистрированные устройства с whiteList/blackList
    this.log.info('Synchronizing registered devices with whiteList/blackList...');
    const existingDevices = this.getDevices();
    let unregisterCount = 0;
    
    for (const device of existingDevices) {
      const deviceName = device.deviceName;
      const serialNumber = device.serialNumber;
      
      if (!deviceName || !serialNumber) {
        this.log.warn(`Skipping device with missing deviceName or serialNumber`);
        continue;
      }
      
      // Проверяем whiteList/blackList
      // serialNumber имеет формат deviceId/controlId
      if (!this.validateDevice([deviceName, serialNumber], true)) {
        this.log.info(`Unregistering ${serialNumber} (not in whiteList or in blackList)`);
        await this.unregisterDevice(device);
        unregisterCount++;
      }
    }
    
    if (unregisterCount > 0) {
      this.log.info(`Unregistered ${unregisterCount} device(s)`);
    }

    // Перебираем WB устройства
    for (const wbDevice of wbDevices) {
      this.log.info(`  Device: ${wbDevice.id} | driver: ${wbDevice.driver} | name: ${wbDevice.name}`);

      // Исключаем z2m устройства (driver=wb-rules + name.startsWith('0x'))
      if (isZ2mExcluded(wbDevice)) {
        this.log.info(`Skipping ${wbDevice.id} (z2m device - excluded)`);
        continue;
      }

      // Получаем контролы этого устройства
      const controls = this.mqttClient?.getControls(wbDevice.id) || [];
      
      if (controls.length === 0) {
        this.log.info(`Skipping ${wbDevice.id} (no controls)`);
        continue;
      }

      // Логируем контролы для отладки
      for (const control of controls) {
        this.log.info(`    Control: ${control.id} | type: ${control.type} | name: ${control.name} | readonly: ${control.readonly}`);
      }

      // Создаём Matter устройства из всех контролов устройства
      // Логика выбора (какие контролы поддерживаются, как их маппить) - внутри createDevices()
      const matterDevices = this.deviceFactory?.createDevices(wbDevice, controls, {
        getState: (deviceId, controlId) => this.mqttClient?.getState(deviceId, controlId),
        setState: async (deviceId, controlId, value) => {
          await this.mqttClient?.setState(deviceId, controlId, value);
        },
      });

      if (!matterDevices || matterDevices.length === 0) {
        this.log.info(`Skipping ${wbDevice.id} (no supported controls)`);
        continue;
      }

      // Проверяем и регистрируем каждое созданное устройство
      for (const matterDevice of matterDevices) {
        // serialNumber уже установлен при создании (формат: deviceId/controlId)
        const serialNumber = matterDevice.serialNumber;
        
        if (!serialNumber) {
          this.log.warn(`Skipping device with missing serialNumber`);
          continue;
        }

        // Получаем displayName для validateDevice
        // Формат: deviceId/controlId -> берём part после /
        const displayName = serialNumber.split('/').pop() || serialNumber;

        // Проверяем whiteList/blackList
        if (!this.validateDevice([displayName, serialNumber], false)) {
          this.log.info(`Skipping ${serialNumber} (not in whiteList or in blackList)`);
          continue;
        }

        // Регистрируем устройство
        await this.registerDevice(matterDevice);
        this.log.info(`Registered: ${displayName} (${serialNumber})`);
      }
    }

    this.log.info(`Registered to Matter bridge`);

    // Подписываемся на изменения состояний из MQTT
    this.subscribeToStateChanges();
  }

  /**
   * Определяет отображаемое имя контрола.
   */
  private getDeviceDisplayName(control: { title?: { en?: string; ru?: string }; name?: string; id: string }, device: { name: string }): string {
    const langKey = this.config.language as 'en' | 'ru';
    
    // Пробуем взять title контрола
    const titleAny = control.title as { en?: string; ru?: string } | undefined;
    let name = titleAny?.[langKey] || titleAny?.en || titleAny?.ru;
    
    // Если нет title - пробуем name
    if (!name) {
      name = control.name || control.id;
    }

    // Если ничего не найдено - используем device name + control id
    if (!name) {
      name = `${device.name}/${control.id}`;
    }

    return name;
  }

  /**
   * Подписывается на изменения состояний из MQTT.
   * При изменении значения в MQTT топике обновляет Matter устройство.
   */
  private subscribeToStateChanges(): void {
    if (!this.mqttClient) {
      return;
    }

    // Подписываемся на событие изменения состояния
    this.mqttClient.on('state', async (deviceId, controlId, value) => {
      this.log.debug(`MQTT state change: ${deviceId}/${controlId} = ${value}`);
      
      // Формат serialNumber как при регистрации (с префиксом WB-)
      const serialNumber = `WB-${deviceId}/${controlId}`;
      
      // Ищем Matter устройство по serialNumber
      const matterDevice = this.getDevices().find(d => d.serialNumber === serialNumber);
      
      if (!matterDevice) {
        // Устройство не найдено - возможно отключено в whiteList/blackList
        this.log.debug(`Device ${serialNumber} not found in registered devices`);
        return;
      }

      this.log.debug(`Found matter device: ${matterDevice.uniqueId}, ${matterDevice.serialNumber}`);

      // Получаем контрол и устройство WB
      const wbDevice = this.mqttClient?.getDevices().find(d => d.id === deviceId);
      const control = this.mqttClient?.getControls(deviceId).find(c => c.id === controlId);
      
      if (!wbDevice || !control) {
        return;
      }

      // Находим правило мэппинга
      const mapping = findMappingRule(control, wbDevice);
      this.log.debug(`Mapping for ${control.type}: ${mapping?.matterDeviceType}, stateUpdate: ${!!mapping?.stateUpdate}`);
      
      if (!mapping?.stateUpdate) {
        this.log.debug(`No stateUpdate for ${serialNumber}`);
        return;
      }

      // Парсим значение используя функцию из мэппинга
      const { cluster, attribute, valueParser } = mapping.stateUpdate;
      const parsedValue = valueParser(value, control.units);
      this.log.debug(`Parsed value: ${parsedValue} for cluster ${cluster}.${attribute}`);

      // Обновляем атрибут в Matter устройстве
      try {
        await matterDevice.setAttribute(cluster, attribute, parsedValue);
        this.log.debug(`Updated ${cluster}.${attribute} = ${parsedValue} for ${serialNumber}`);
      } catch (err) {
        this.log.warn(`Failed to update ${serialNumber}: ${err}`);
      }
    });
  }
}
