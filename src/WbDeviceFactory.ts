/**
 * Фабрика устройств для преобразования устройств Wirenboard в Matter endpoints.
 */

import { contactSensor, dimmableLight, electricalSensor, humiditySensor, lightSensor, MatterbridgeEndpoint, onOffLight, temperatureSensor } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';

import type { WbControl, WbDevice } from './WbMqttClient.js';

type MatterDeviceType = 'onOffLight' | 'dimmableLight' | 'colorLight' | 'contactSensor' | 'temperatureSensor' | 'humiditySensor' | 'electricalSensor' | 'lightSensor';

interface WbDeviceMatcher {
  hasControlTypes: string[];
  hasControlUnits: string[];
  nameIncludes: string[];
}

const DEVICE_MATCHERS: { matcher: WbDeviceMatcher; type: MatterDeviceType; isSensor: boolean }[] = [
  { matcher: { hasControlTypes: ['switch', 'pushbutton'], hasControlUnits: [], nameIncludes: [] }, type: 'onOffLight', isSensor: false },
  { matcher: { hasControlTypes: ['switch', 'pushbutton'], hasControlUnits: [], nameIncludes: ['rgb'] }, type: 'colorLight', isSensor: false },
  { matcher: { hasControlTypes: ['switch', 'pushbutton'], hasControlUnits: [], nameIncludes: ['brightness'] }, type: 'dimmableLight', isSensor: false },
  { matcher: { hasControlTypes: ['range'], hasControlUnits: [], nameIncludes: [] }, type: 'dimmableLight', isSensor: false },
  { matcher: { hasControlTypes: [], hasControlUnits: ['deg C'], nameIncludes: [] }, type: 'temperatureSensor', isSensor: true },
  { matcher: { hasControlTypes: ['temperature'], hasControlUnits: [], nameIncludes: [] }, type: 'temperatureSensor', isSensor: true },
  { matcher: { hasControlTypes: [], hasControlUnits: ['%', 'RH'], nameIncludes: [] }, type: 'humiditySensor', isSensor: true },
  { matcher: { hasControlTypes: ['rel_humidity'], hasControlUnits: [], nameIncludes: [] }, type: 'humiditySensor', isSensor: true },
  { matcher: { hasControlTypes: [], hasControlUnits: ['W', 'kWh'], nameIncludes: [] }, type: 'electricalSensor', isSensor: true },
  { matcher: { hasControlTypes: [], hasControlUnits: ['lx'], nameIncludes: [] }, type: 'lightSensor', isSensor: true },
  { matcher: { hasControlTypes: ['text', 'alarm'], hasControlUnits: [], nameIncludes: [] }, type: 'contactSensor', isSensor: false },
];

/**
 * Проверяет, соответствуют ли controls условиям matcher.
 *
 * @param {WbControl[]} controls Массив контролов.
 * @param {WbDeviceMatcher} matcher Условия для проверки.
 * @param {string} deviceName Имя устройства.
 * @returns {boolean} True если соответствует.
 */
function matchControls(controls: WbControl[], matcher: WbDeviceMatcher, deviceName: string): boolean {
  const controlTypes = controls.map((c) => c.type);
  const units = controls.map((c) => c.units || '');

  if (matcher.hasControlTypes.length > 0) {
    for (const t of matcher.hasControlTypes) {
      if (controlTypes.includes(t)) return true;
    }
  }
  if (matcher.hasControlUnits.length > 0) {
    for (const u of matcher.hasControlUnits) {
      if (units.some((cu) => cu.includes(u))) return true;
    }
  }
  if (matcher.nameIncludes.length > 0) {
    for (const p of matcher.nameIncludes) {
      if (deviceName.toLowerCase().includes(p.toLowerCase())) return true;
    }
  }
  return false;
}

export class WbDeviceFactory {
  private log: AnsiLogger;
  private matterbridge: { aggregatorVendorId: number };
  private language: string;

  constructor(log: AnsiLogger, matterbridge: { aggregatorVendorId: number; language?: string }) {
    this.log = log;
    this.matterbridge = matterbridge;
    this.language = matterbridge.language || 'ru';
  }

  public createDevices(
    device: WbDevice,
    controls: WbControl[],
    _getState: (deviceId: string, controlId: string) => { value: string | number } | undefined,
    mqttClient: { setState: (deviceId: string, controlId: string, value: string | number) => Promise<void> },
  ): MatterbridgeEndpoint[] {
    if (controls.length === 0) {
      this.log.warn(`Device ${device.id} has no controls, skipping`);
      return [];
    }

    const result: MatterbridgeEndpoint[] = [];
    const deviceName = this.getDeviceName(device);
    const deviceId = device.id;

    for (const profile of DEVICE_MATCHERS) {
      const isMatch = matchControls(controls, profile.matcher, deviceName);

      if (!isMatch) continue;

      if (profile.isSensor) {
        for (const control of controls) {
          const controlType = control.type;
          const units = control.units || '';
          const name = control.name || control.id;
          const id = `${deviceId}-${control.id}`;

          const isTemp = controlType === 'temperature' || units.includes('deg C');
          const isHumid = controlType === 'rel_humidity' || units.includes('%') || units.includes('RH');
          const isPower = units.includes('W') || units.includes('kWh');
          const isLux = units.includes('lx');

          if (profile.type === 'temperatureSensor' && isTemp) {
            result.push(this.createTemperatureSensor(name, id));
          } else if (profile.type === 'humiditySensor' && isHumid) {
            result.push(this.createHumiditySensor(name, id));
          } else if (profile.type === 'electricalSensor' && isPower) {
            result.push(this.createPowerSensor(name, id));
          } else if (profile.type === 'lightSensor' && isLux) {
            result.push(this.createIlluminanceSensor(name, id));
          }
        }
      } else {
        const endpoint = this.createFromType(profile.type, deviceName, deviceId, mqttClient);
        if (endpoint) result.push(endpoint);
      }
    }

    if (result.length === 0) {
      this.log.warn(`Device ${device.id} has unsupported controls: ${controls.map((c) => c.type).join(', ')}`);
    }

    return result;
  }

  private getDeviceName(device: WbDevice): string {
    const langKey = this.language as 'en' | 'ru';
    const titleAny = device.title as { en?: string; ru?: string } | undefined;
    return device.name || titleAny?.[langKey] || titleAny?.en || titleAny?.ru || device.id;
  }

  private createFromType(
    type: MatterDeviceType,
    name: string,
    deviceId: string,
    mqttClient: { setState: (deviceId: string, controlId: string, value: string | number) => Promise<void> },
  ): MatterbridgeEndpoint | null {
    const vid = this.matterbridge.aggregatorVendorId;

    switch (type) {
      case 'onOffLight':
        return new MatterbridgeEndpoint(onOffLight, { id: deviceId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers()
          .addCommandHandler('on', async () => mqttClient.setState(deviceId, 'on', 1))
          .addCommandHandler('off', async () => mqttClient.setState(deviceId, 'on', 0));

      case 'dimmableLight':
        return new MatterbridgeEndpoint(dimmableLight, { id: deviceId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers()
          .addCommandHandler('on', async () => mqttClient.setState(deviceId, 'on', 1))
          .addCommandHandler('off', async () => mqttClient.setState(deviceId, 'on', 0));

      case 'colorLight':
        return new MatterbridgeEndpoint(onOffLight, { id: deviceId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers()
          .addCommandHandler('on', async () => mqttClient.setState(deviceId, 'on', 1))
          .addCommandHandler('off', async () => mqttClient.setState(deviceId, 'on', 0));

      case 'contactSensor':
        return new MatterbridgeEndpoint(contactSensor, { id: deviceId })
          .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
          .createDefaultPowerSourceWiredClusterServer()
          .addRequiredClusterServers();

      case 'temperatureSensor':
        return this.createTemperatureSensor(name, deviceId);

      case 'humiditySensor':
        return this.createHumiditySensor(name, deviceId);

      case 'electricalSensor':
        return this.createPowerSensor(name, deviceId);

      case 'lightSensor':
        return this.createIlluminanceSensor(name, deviceId);

      default:
        return null;
    }
  }

  private createTemperatureSensor(name: string, deviceId: string): MatterbridgeEndpoint {
    const vid = this.matterbridge.aggregatorVendorId;
    return new MatterbridgeEndpoint(temperatureSensor, { id: deviceId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusterServers();
  }

  private createHumiditySensor(name: string, deviceId: string): MatterbridgeEndpoint {
    const vid = this.matterbridge.aggregatorVendorId;
    return new MatterbridgeEndpoint(humiditySensor, { id: deviceId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusterServers();
  }

  private createPowerSensor(name: string, deviceId: string): MatterbridgeEndpoint {
    const vid = this.matterbridge.aggregatorVendorId;
    return new MatterbridgeEndpoint(electricalSensor, { id: deviceId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusterServers();
  }

  private createIlluminanceSensor(name: string, deviceId: string): MatterbridgeEndpoint {
    const vid = this.matterbridge.aggregatorVendorId;
    return new MatterbridgeEndpoint(lightSensor, { id: deviceId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(name, `WB-${deviceId}`, vid, 'Wirenboard', `Wirenboard ${name}`, 10000, '1.0.0')
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusterServers();
  }
}
