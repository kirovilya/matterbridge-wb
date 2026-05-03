/**
 * Фабрика устройств для преобразования контролов Wirenboard в Matter endpoints.
 *
 * Основной принцип: КАЖДЫЙ контрол = отдельное Matter устройство.
 * Это позволяет правильно работать с whiteList/blackList в интерфейсе Matterbridge.
 */

import { contactSensor, dimmableLight, electricalSensor, genericSwitch, humiditySensor, lightSensor, MatterbridgeEndpoint, onOffLight, temperatureSensor } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';

import { canMapToMatter, type ControlMappingRule, findMappingRule } from './wbControlMapping.js';
import type { WbControl, WbDevice, WbState } from './WbMqttClient.js';

/**
 * Интерфейс для получения состояния контрола.
 */
type GetStateFn = (deviceId: string, controlId: string) => WbState | undefined;

/**
 * Интерфейс для установки состояния контрола (команды из Matter -> MQTT).
 */
type SetStateFn = (deviceId: string, controlId: string, value: string | number) => Promise<void>;

/**
 * Интерфейс коллбэков для работы с MQTT.
 */
interface MqttCallbacks {
  getState: GetStateFn;
  setState: SetStateFn;
}

/**
 * Фабрика для создания Matter устройств из контролов Wirenboard.
 */
export class WbDeviceFactory {
  private log: AnsiLogger;
  private matterbridge: { aggregatorVendorId: number };
  private language: string;

  constructor(log: AnsiLogger, matterbridge: { aggregatorVendorId: number; language?: string }) {
    this.log = log;
    this.matterbridge = matterbridge;
    this.language = matterbridge.language || 'ru';
  }

  /**
   * Создаёт массив Matter устройств из массива контролов.
   *
   * Внутренняя логика:
   * - По умолчанию: создаём по одному устройству на контрол
   * - Фильтруем только поддерживаемые контролы (canMapToMatter)
   * - Применяем мэппинг (findMappingRule)
   *
   * Для будущего: можно добавить логику группировки нескольких контролов в одно устройство.
   *
   * @param device - родительское устройство WB
   * @param controls - массив контролов
   * @param callbacks - коллбэки для работы с MQTT
   * @returns массив Matter устройств (может быть пустым)
   */
  public createDevices(device: WbDevice, controls: WbControl[], callbacks: MqttCallbacks): MatterbridgeEndpoint[] {
    const result: MatterbridgeEndpoint[] = [];

    // Перебираем контролы и создаём Matter устройства
    for (const control of controls) {
      // Проверяем, можно ли отобразить контрол в Matter
      if (!canMapToMatter(control, device)) {
        this.log.debug(`Control ${device.id}/${control.id} not supported - skipping`);
        continue;
      }

      // Находим правило мэппинга
      const mapping = findMappingRule(control, device);
      if (!mapping) {
        this.log.debug(`No mapping for control ${device.id}/${control.id}`);
        continue;
      }

      // Генерируем уникальный ID для Matter устройства
      // Формат: deviceId/controlId - позволяет каждому контролу быть отдельным устройством
      const uniqueId = `${device.id}/${control.id}`;

      // Определяем имя устройства
      const deviceName = this.getControlName(control, device);

      // Создаём Matter устройство
      const endpoint = this.createFromMapping(uniqueId, deviceName, device, control, mapping, callbacks);

      if (!endpoint) {
        continue;
      }

      result.push(endpoint);
      this.log.info(`Matter device: ${deviceName} (${uniqueId}) -> ${mapping.matterDeviceType}`);
    }

    // === RESERVED FOR FUTURE GROUPING LOGIC ===
    // Здесь можно будет добавить логику для группировки:
    // const groupedDevice = tryCreateGroupedDevice(device, controls, callbacks);
    // if (groupedDevice) return [groupedDevice];

    return result;
  }

  /**
   * Определяет имя контрола для отображения в Matter.
   * Использует localized title, name или fallback.
   *
   * @param control
   * @param device
   */
  private getControlName(control: WbControl, device: WbDevice): string {
    const langKey = this.language as 'en' | 'ru';

    // Пробуем взять title контрола
    const titleAny = control.title as { en?: string; ru?: string } | undefined;
    let name = titleAny?.[langKey] || titleAny?.en || titleAny?.ru;

    // Если нет title - пробуем name
    if (!name) {
      name = control.name || control.id;
    }

    // Для датчиков добавляем единицы измерения
    if (control.units && control.units !== 'value' && control.units !== '') {
      name = `${name}, ${control.units}`;
    }

    // Если ничего не найдено - используем device name + control id
    if (!name) {
      const deviceTitleAny = device.title as { en?: string; ru?: string } | undefined;
      const deviceName = deviceTitleAny?.[langKey] || deviceTitleAny?.en || deviceTitleAny?.ru || device.name;
      name = `${deviceName}/${control.id}`;
    }

    return name;
  }

  /**
   * Создаёт Matter устройство на основе правила мэппинга.
   *
   * @param uniqueId
   * @param deviceName
   * @param device
   * @param control
   * @param mapping
   * @param callbacks
   */
  private createFromMapping(
    uniqueId: string,
    deviceName: string,
    device: WbDevice,
    control: WbControl,
    mapping: ControlMappingRule,
    callbacks: MqttCallbacks,
  ): MatterbridgeEndpoint | null {
    const vid = this.matterbridge.aggregatorVendorId;
    const deviceId = device.id;
    const controlId = control.id;

    switch (mapping.matterDeviceType) {
      case 'onOffSwitch':
        return (
          new MatterbridgeEndpoint(onOffLight, { id: uniqueId })
            .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
            .createDefaultPowerSourceWiredClusterServer()
            .addRequiredClusterServers()
            // Команда включения - отправляем в MQTT
            .addCommandHandler('on', async () => {
              await callbacks.setState(deviceId, controlId, 1);
            })
            .addCommandHandler('off', async () => {
              await callbacks.setState(deviceId, controlId, 0);
            })
        );

      case 'genericSwitch':
        // Кнопка - использует Switch cluster
        // Не имеет команд управления (только передаёт состояние в Matter)
        return new MatterbridgeEndpoint(genericSwitch, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      case 'dimmableLight':
        return (
          new MatterbridgeEndpoint(dimmableLight, { id: uniqueId })
            .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
            .createDefaultPowerSourceWiredClusterServer()
            .addRequiredClusterServers()
            // Команда включения
            .addCommandHandler('on', async () => {
              await callbacks.setState(deviceId, controlId, 255);
            })
            // Команда выключения
            .addCommandHandler('off', async () => {
              await callbacks.setState(deviceId, controlId, 0);
            })
        );

      case 'colorLight':
        // Пока создаём как onOffLight - цветной свет требует дополнительной логики
        return new MatterbridgeEndpoint(onOffLight, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers()
          .addCommandHandler('on', async () => {
            await callbacks.setState(deviceId, controlId, '255;255;255');
          })
          .addCommandHandler('off', async () => {
            await callbacks.setState(deviceId, controlId, '0;0;0');
          });

      case 'temperatureSensor':
        return new MatterbridgeEndpoint(temperatureSensor, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      case 'humiditySensor':
        return new MatterbridgeEndpoint(humiditySensor, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      case 'lightSensor':
        return new MatterbridgeEndpoint(lightSensor, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      case 'electricalSensor':
        return new MatterbridgeEndpoint(electricalSensor, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      case 'contactSensor':
        return new MatterbridgeEndpoint(contactSensor, { id: uniqueId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(deviceName, `WB-${uniqueId}`, vid, 'Wirenboard', `WB ${deviceName}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      default:
        this.log.warn(`Неизвестный тип устройства: ${mapping.matterDeviceType}`);
        return null;
    }
  }
}
