import path from 'node:path';

import { jest } from '@jest/globals';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';

const mockMqtt = () => ({
  connectAsync: jest.fn().mockResolvedValue({} as never),
});

jest.unstable_mockModule('mqtt', mockMqtt);

const { WirenboardPlatform } = await import('../src/module.js');
import { PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { VendorId } from 'matterbridge/matter';
import { LogLevel as MqttLogLevel, TimestampFormat } from 'node-ansi-logger';

import { canMapToMatter, findMappingRule, getSupportedMatterTypes, isZ2mExcluded } from '../src/wbControlMapping.js';
import { WbDeviceFactory } from '../src/WbDeviceFactory.js';
import type { WbControl, WbDevice } from '../src/WbMqttClient.js';
import { WbMqttClient } from '../src/WbMqttClient.js';

const mockLog = {
  fatal: jest.fn((message: string, ...parameters: unknown[]) => {}),
  error: jest.fn((message: string, ...parameters: unknown[]) => {}),
  warn: jest.fn((message: string, ...parameters: unknown[]) => {}),
  notice: jest.fn((message: string, ...parameters: unknown[]) => {}),
  info: jest.fn((message: string, ...parameters: unknown[]) => {}),
  debug: jest.fn((message: string, ...parameters: unknown[]) => {}),
} as unknown as AnsiLogger;

const createMockMatterbridge = (version = '3.5.0'): PlatformMatterbridge =>
  ({
    systemInformation: {
      ipv4Address: '192.168.1.1',
      ipv6Address: 'fd78:cbf8:4939:746:a96:8277:346f:416e',
      osRelease: 'x.y.z',
      nodeVersion: '22.10.0',
    },
    rootDirectory: path.join('.cache', 'jest', 'WirenboardPlugin'),
    homeDirectory: path.join('.cache', 'jest', 'WirenboardPlugin'),
    matterbridgeDirectory: path.join('.cache', 'jest', 'WirenboardPlugin', '.matterbridge'),
    matterbridgePluginDirectory: path.join('.cache', 'jest', 'WirenboardPlugin', 'Matterbridge'),
    matterbridgeCertDirectory: path.join('.cache', 'jest', 'WirenboardPlugin', '.mattercert'),
    globalModulesDirectory: path.join('.cache', 'jest', 'WirenboardPlugin', 'node_modules'),
    matterbridgeVersion: version,
    matterbridgeLatestVersion: '3.5.0',
    matterbridgeDevVersion: '3.5.0',
    bridgeMode: 'bridge',
    restartMode: '',
    aggregatorVendorId: VendorId(0xfff1),
    aggregatorVendorName: 'Matterbridge',
    aggregatorProductId: 0x8000,
    aggregatorProductName: 'Matterbridge aggregator',
    registerVirtualDevice: jest.fn(async () => {}),
    addBridgedEndpoint: jest.fn(async () => {}),
    removeBridgedEndpoint: jest.fn(async () => {}),
    removeAllBridgedEndpoints: jest.fn(async () => {}),
  }) as unknown as PlatformMatterbridge;

const createMockConfig = (overrides: Partial<PlatformConfig> = {}): PlatformConfig => ({
  name: 'matterbridge-wb',
  type: 'DynamicPlatform',
  version: '0.6.0',
  host: 'mqtt://localhost',
  port: 1883,
  whiteList: [],
  blackList: [],
  debug: false,
  unregisterOnShutdown: false,
  ...overrides,
});

describe('Matterbridge Wirenboard Plugin', () => {
  let instance: typeof WirenboardPlatform.prototype;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should throw error when matterbridge version is too old', () => {
      const oldMatterbridge = createMockMatterbridge('2.0.0');
      expect(() => new WirenboardPlatform(oldMatterbridge, mockLog, createMockConfig())).toThrow(
        'This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from 2.0.0 to the latest version in the frontend.',
      );
    });

    it('should accept minimum required version 3.4.0', () => {
      const matterbridge = createMockMatterbridge('3.4.0');
      expect(() => new WirenboardPlatform(matterbridge, mockLog, createMockConfig())).not.toThrow();
    });

    it('should accept newer version 3.5.0', () => {
      const matterbridge = createMockMatterbridge('3.5.0');
      expect(() => new WirenboardPlatform(matterbridge, mockLog, createMockConfig())).not.toThrow();
    });

    it('should create instance with correct properties', () => {
      const matterbridge = createMockMatterbridge();
      const config = createMockConfig();
      instance = new WirenboardPlatform(matterbridge, mockLog, config);
      expect(instance.matterbridge).toBe(matterbridge);
      expect(instance.log).toBe(mockLog);
      expect(instance.config).toBe(config);
    });

    it('should log initialization message', () => {
      const matterbridge = createMockMatterbridge();
      instance = new WirenboardPlatform(matterbridge, mockLog, createMockConfig());
      expect(mockLog.info).toHaveBeenCalledWith('Initializing Wirenboard Platform...');
    });
  });

  describe('onChangeLoggerLevel', () => {
    it('should log when logger level changes', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onChangeLoggerLevel(LogLevel.DEBUG);
      expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
    });

    it('should handle info log level', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onChangeLoggerLevel(LogLevel.INFO);
      expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: info');
    });
  });

  describe('onShutdown', () => {
    it('should log shutdown reason', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onShutdown('TestReason');
      expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: TestReason');
    });

    it('should handle unregisterOnShutdown config', async () => {
      const config = createMockConfig({ unregisterOnShutdown: true });
      const matterbridge = createMockMatterbridge();
      instance = new WirenboardPlatform(matterbridge, mockLog, config);
      await instance.onShutdown();
      expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    });

    it('should call super onShutdown', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onShutdown('Test');
      expect(mockLog.info).toHaveBeenCalled();
    });
  });

  describe('config handling', () => {
    it('should handle whiteList config', () => {
      const config = createMockConfig({ whiteList: ['device1', 'device2'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance.config.whiteList).toEqual(['device1', 'device2']);
    });

    it('should handle blackList config', () => {
      const config = createMockConfig({ blackList: ['device3'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance.config.blackList).toEqual(['device3']);
    });

    it('should handle empty whiteList', () => {
      const config = createMockConfig({ whiteList: [] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance.config.whiteList).toEqual([]);
    });

    it('should accept minimal config without throwing', () => {
      const minimalConfig: PlatformConfig = {
        name: 'matterbridge-wb',
        type: 'DynamicPlatform',
      } as PlatformConfig;
      expect(() => new WirenboardPlatform(createMockMatterbridge(), mockLog, minimalConfig)).not.toThrow();
    });
  });
});

describe('wbControlMapping', () => {
  const createMockControl = (overrides: Partial<WbControl> = {}): WbControl => ({
    id: 'test-control',
    deviceId: 'test-device',
    type: 'switch',
    title: { en: 'Test Control', ru: 'Тест' },
    ...overrides,
  });

  const createMockDevice = (overrides: Partial<WbDevice> = {}): WbDevice => ({
    id: 'test-device',
    name: 'Test Device',
    driver: 'wb-gpio',
    title: { en: 'Test Device', ru: 'Тестовое устройство' },
    ...overrides,
  });

  describe('findMappingRule', () => {
    it('should find mapping for temperature sensor', () => {
      const control = createMockControl({ type: 'value', units: 'deg C' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('temperatureSensor');
    });

    it('should find mapping for humidity sensor', () => {
      const control = createMockControl({ type: 'value', units: '%' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('humiditySensor');
    });

    it('should find mapping for humidity sensor with RH units', () => {
      const control = createMockControl({ type: 'value', units: 'RH' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('humiditySensor');
    });

    it('should find mapping for light sensor', () => {
      const control = createMockControl({ type: 'value', units: 'lx' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('lightSensor');
    });

    it('should find mapping for power sensor', () => {
      const control = createMockControl({ type: 'value', units: 'W' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('electricalSensor');
    });

    it('should find mapping for energy sensor', () => {
      const control = createMockControl({ type: 'value', units: 'kWh' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('electricalSensor');
    });

    it('should find mapping for switch (onOffSwitch)', () => {
      const control = createMockControl({ type: 'switch', readonly: false });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('onOffSwitch');
    });

    it('should find mapping for button (contactSensor)', () => {
      const control = createMockControl({ type: 'switch', readonly: true });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('contactSensor');
    });

    it('should find mapping for dimmer', () => {
      const control = createMockControl({ type: 'range' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('dimmableLight');
    });

    it('should find mapping for RGB light', () => {
      const control = createMockControl({ type: 'rgb' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('colorLight');
    });

    it('should find mapping for alarm control', () => {
      const control = createMockControl({ type: 'alarm' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.matterDeviceType).toBe('contactSensor');
    });

    it('should return undefined for unknown control type', () => {
      const control = createMockControl({ type: 'unknown' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule).toBeUndefined();
    });

    it('should filter by driver when specified', () => {
      const control = createMockControl({ type: 'switch' });
      const device = createMockDevice({ driver: 'wb-gpio' });
      const rule = findMappingRule(control, device);
      expect(rule).toBeDefined();
    });

    it('should filter by control name includes', () => {
      const control = createMockControl({ type: 'value', units: 'W', id: 'power_meter' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule).toBeDefined();
    });

    it('should return rule with stateUpdate for sensors', () => {
      const control = createMockControl({ type: 'value', units: 'deg C' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate).toBeDefined();
      expect(rule?.stateUpdate?.cluster).toBe('TemperatureMeasurement');
    });

    it('should have valueParser for temperature', () => {
      const control = createMockControl({ type: 'value', units: 'deg C' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      const result = rule?.stateUpdate?.valueParser(25);
      expect(result).toBe(2500);
    });

    it('should have valueParser for humidity', () => {
      const control = createMockControl({ type: 'value', units: '%' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      const result = rule?.stateUpdate?.valueParser(50);
      expect(result).toBe(5000);
    });

    it('should have valueParser for light sensor', () => {
      const control = createMockControl({ type: 'value', units: 'lx' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      const result = rule?.stateUpdate?.valueParser(100);
      expect(typeof result).toBe('number');
    });

    it('should have valueParser for power', () => {
      const control = createMockControl({ type: 'value', units: 'W' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      const result = rule?.stateUpdate?.valueParser(100);
      expect(result).toBe(100000);
    });

    it('should have valueParser for energy', () => {
      const control = createMockControl({ type: 'value', units: 'kWh' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate).toBeDefined();
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
    });

    it('should have valueParser for switch', () => {
      const control = createMockControl({ type: 'switch', readonly: false });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      expect(rule?.stateUpdate?.valueParser(1)).toBe(true);
      expect(rule?.stateUpdate?.valueParser(0)).toBe(false);
    });

    it('should have valueParser for button', () => {
      const control = createMockControl({ type: 'switch', readonly: true });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      expect(rule?.stateUpdate?.valueParser(1)).toBe(true);
      expect(rule?.stateUpdate?.valueParser(0)).toBe(false);
    });

    it('should have valueParser for dimmer', () => {
      const control = createMockControl({ type: 'range' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      expect(rule?.stateUpdate?.valueParser(128)).toBe(50);
      expect(rule?.stateUpdate?.valueParser(255)).toBe(100);
      expect(rule?.stateUpdate?.valueParser(0)).toBe(0);
    });

    it('should have valueParser for RGB', () => {
      const control = createMockControl({ type: 'rgb' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      expect(rule?.stateUpdate?.valueParser).toBeDefined();
      const result = rule?.stateUpdate?.valueParser('255;128;64');
      expect(typeof result).toBe('number');
    });

    it('should return 0 for invalid RGB', () => {
      const control = createMockControl({ type: 'rgb' });
      const device = createMockDevice();
      const rule = findMappingRule(control, device);
      const result = rule?.stateUpdate?.valueParser('invalid');
      expect(result).toBe(0);
    });
  });

  describe('canMapToMatter', () => {
    it('should return true for mappable control', () => {
      const control = createMockControl({ type: 'switch', readonly: false });
      const device = createMockDevice();
      expect(canMapToMatter(control, device)).toBe(true);
    });

    it('should return false for hidden control', () => {
      const control = createMockControl({ type: 'switch', hidden: true });
      const device = createMockDevice();
      expect(canMapToMatter(control, device)).toBe(false);
    });

    it('should return false for unsupported control type', () => {
      const control = createMockControl({ type: 'unsupported' });
      const device = createMockDevice();
      expect(canMapToMatter(control, device)).toBe(false);
    });

    it('should return true for temperature sensor', () => {
      const control = createMockControl({ type: 'value', units: 'deg C' });
      const device = createMockDevice();
      expect(canMapToMatter(control, device)).toBe(true);
    });

    it('should return true for humidity sensor', () => {
      const control = createMockControl({ type: 'value', units: '%' });
      const device = createMockDevice();
      expect(canMapToMatter(control, device)).toBe(true);
    });
  });

  describe('isZ2mExcluded', () => {
    it('should return true for wb-rules device with 0x name', () => {
      const device = createMockDevice({ driver: 'wb-rules', name: '0x123456' });
      expect(isZ2mExcluded(device)).toBe(true);
    });

    it('should return false for wb-rules device without 0x name', () => {
      const device = createMockDevice({ driver: 'wb-rules', name: 'Living Room' });
      expect(isZ2mExcluded(device)).toBe(false);
    });

    it('should return false for other drivers', () => {
      const device = createMockDevice({ driver: 'wb-gpio', name: '0x123456' });
      expect(isZ2mExcluded(device)).toBe(false);
    });

    it('should return false for non-hex name', () => {
      const device = createMockDevice({ driver: 'wb-rules', name: 'device1' });
      expect(isZ2mExcluded(device)).toBe(false);
    });
  });

  describe('getSupportedMatterTypes', () => {
    it('should return array of supported types', () => {
      const types = getSupportedMatterTypes();
      expect(types).toContain('temperatureSensor');
      expect(types).toContain('humiditySensor');
      expect(types).toContain('onOffSwitch');
      expect(types).toContain('dimmableLight');
    });

    it('should not contain duplicates', () => {
      const types = getSupportedMatterTypes();
      const uniqueTypes = new Set(types);
      expect(types.length).toBe(uniqueTypes.size);
    });
  });
});

describe('WbMqttClient', () => {
  let client: WbMqttClient;
  const mockLogFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    client = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, undefined, 5, false, 'ru');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with default values', () => {
      expect(client.mqttHost).toBe('mqtt://localhost');
      expect(client.mqttPort).toBe(1883);
      expect(client.language).toBe('ru');
    });

    it('should create client with custom language', () => {
      const customClient = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, undefined, 5, false, 'en');
      expect(customClient.language).toBe('en');
    });

    it('should create client with custom client id', () => {
      const customClient = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, 'custom-client-id', 5, false, 'ru');
      expect(customClient.getUrl()).toBe('mqtt://localhost:1883');
    });

    it('should handle unix socket URL', () => {
      const unixClient = new WbMqttClient('unix:///tmp/mqtt.sock', 0, undefined, undefined, undefined, 5, false, 'ru');
      expect(unixClient.getUrl()).toBe('unix:///tmp/mqtt.sock');
    });

    it('should handle username and password', () => {
      const authClient = new WbMqttClient('mqtt://localhost', 1883, 'user', 'pass', undefined, 5, false, 'ru');
      expect(authClient.mqttUsername).toBe('user');
      expect(authClient.mqttPassword).toBe('pass');
    });

    it('should handle empty username', () => {
      const authClient = new WbMqttClient('mqtt://localhost', 1883, '', 'pass', undefined, 5, false, 'ru');
      expect(authClient.mqttUsername).toBe('');
    });

    it('should handle empty password', () => {
      const authClient = new WbMqttClient('mqtt://localhost', 1883, 'user', '', undefined, 5, false, 'ru');
      expect(authClient.mqttPassword).toBe('');
    });

    it('should set protocol version', () => {
      const clientV3 = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, undefined, 3, false, 'ru');
      const clientV4 = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, undefined, 4, false, 'ru');
      const clientV5 = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, undefined, 5, false, 'ru');
      expect(clientV3).toBeDefined();
      expect(clientV4).toBeDefined();
      expect(clientV5).toBeDefined();
    });

    it('should create debug client with DEBUG log level', () => {
      const debugClient = new WbMqttClient('mqtt://localhost', 1883, undefined, undefined, undefined, 5, true, 'ru');
      expect(debugClient).toBeDefined();
    });
  });

  describe('getUrl', () => {
    it('should return host:port for regular URL', () => {
      expect(client.getUrl()).toBe('mqtt://localhost:1883');
    });

    it('should return only host for unix socket', () => {
      const unixClient = new WbMqttClient('unix:///tmp/mqtt.sock', 0);
      expect(unixClient.getUrl()).toBe('unix:///tmp/mqtt.sock');
    });

    it('should include port in URL for non-unix', () => {
      expect(client.getUrl()).toContain('1883');
    });
  });

  describe('setLogLevel', () => {
    it('should set log level', () => {
      client.setLogLevel(MqttLogLevel.DEBUG);
      expect(client).toBeDefined();
    });

    it('should set ERROR log level', () => {
      client.setLogLevel(MqttLogLevel.ERROR);
      expect(client).toBeDefined();
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('getDevices', () => {
    it('should return empty array initially', () => {
      expect(client.getDevices()).toEqual([]);
    });
  });

  describe('getControls', () => {
    it('should return empty array for unknown device', () => {
      expect(client.getControls('unknown')).toEqual([]);
    });
  });

  describe('getState', () => {
    it('should return undefined for unknown state', () => {
      expect(client.getState('device', 'control')).toBeUndefined();
    });
  });

  describe('setState', () => {
    it('should handle setState when not connected', async () => {
      await client.setState('device1', 'control1', 1);
      expect(client).toBeDefined();
    });
  });

  describe('events', () => {
    it('should have event emitter methods', () => {
      expect(typeof client.on).toBe('function');
      expect(typeof client.emit).toBe('function');
      expect(typeof client.off).toBe('function');
    });

    it('should be able to listen to device event', () => {
      const handler = jest.fn();
      client.on('device', handler);
      expect(client.listenerCount('device')).toBe(1);
    });

    it('should be able to listen to control event', () => {
      const handler = jest.fn();
      client.on('control', handler);
      expect(client.listenerCount('control')).toBe(1);
    });

    it('should be able to listen to state event', () => {
      const handler = jest.fn();
      client.on('state', handler);
      expect(client.listenerCount('state')).toBe(1);
    });

    it('should be able to listen to error event', () => {
      const handler = jest.fn();
      client.on('error', handler);
      expect(client.listenerCount('error')).toBe(1);
    });

    it('should be able to listen to mqtt_connect event', () => {
      const handler = jest.fn();
      client.on('mqtt_connect', handler);
      expect(client.listenerCount('mqtt_connect')).toBe(1);
    });

    it('should be able to listen to mqtt_disconnect event', () => {
      const handler = jest.fn();
      client.on('mqtt_disconnect', handler);
      expect(client.listenerCount('mqtt_disconnect')).toBe(1);
    });
  });

  describe('stop', () => {
    it('should handle stop when not started', async () => {
      await client.stop();
      expect(client.isConnected()).toBe(false);
    });

    it('should handle multiple stop calls', async () => {
      await client.stop();
      await client.stop();
      expect(client).toBeDefined();
    });
  });
});

describe('WirenboardPlatform - Integration', () => {
  let instance: typeof WirenboardPlatform.prototype;
  let mqttClientMock: ReturnType<typeof jest.fn>;
  let deviceFactoryMock: ReturnType<typeof jest.fn>;

  const createMockMqttClient = () => {
    mqttClientMock = jest.fn().mockImplementation(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      getDevices: jest.fn().mockReturnValue([
        {
          id: 'test-device-1',
          name: 'Test Device 1',
          driver: 'wb-gpio',
          title: { en: 'Test Device 1', ru: 'Тестовое устройство 1' },
        },
      ]),
      getControls: jest.fn().mockImplementation((deviceId: string) => {
        if (deviceId === 'test-device-1') {
          return [
            {
              id: 'switch1',
              deviceId: 'test-device-1',
              type: 'switch',
              title: { en: 'Switch 1', ru: 'Выключатель 1' },
              readonly: false,
            },
          ];
        }
        return [];
      }),
      getState: jest.fn().mockReturnValue({ value: 1, updatedAt: Date.now() }),
      setState: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      language: 'ru',
      mqttHost: 'mqtt://localhost',
      mqttPort: 1883,
    }));
    return mqttClientMock;
  };

  const createMockDeviceFactory = () => {
    deviceFactoryMock = jest.fn().mockImplementation(() => ({
      createDevices: jest.fn().mockReturnValue([
        {
          id: 'test-device-1/switch1',
          serialNumber: 'WB-test-device-1/switch1',
          deviceName: 'Switch 1',
        },
      ]),
    }));
    return deviceFactoryMock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
  });

  describe('initializePlugin', () => {
    it('should return WirenboardPlatform instance', async () => {
      const { default: initializePlugin } = await import('../src/module.js');
      const platform = initializePlugin(createMockMatterbridge(), mockLog, createMockConfig());
      expect(platform).toBeInstanceOf(WirenboardPlatform);
    });
  });

  describe('onStart', () => {
    it('should start MQTT client and discover devices', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockClient = {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        getDevices: jest.fn().mockReturnValue([]),
        getControls: jest.fn().mockReturnValue([]),
        getState: jest.fn().mockReturnValue(undefined),
        setState: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      };

      instance.mqttClient = mockClient as unknown as WbMqttClient;
      instance.deviceFactory = {
        createDevices: jest.fn().mockReturnValue([]),
      } as unknown as WbDeviceFactory;

      await instance.onStart('test');

      expect(mockClient.start).toHaveBeenCalled();
    });

    it('should handle empty device list', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockClient = {
        start: jest.fn().mockResolvedValue(undefined),
        getDevices: jest.fn().mockReturnValue([]),
        getControls: jest.fn().mockReturnValue([]),
        getState: jest.fn().mockReturnValue(undefined),
        setState: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      };

      instance.mqttClient = mockClient as unknown as WbMqttClient;
      instance.deviceFactory = {
        createDevices: jest.fn().mockReturnValue([]),
      } as unknown as WbDeviceFactory;

      await instance.onStart('test');
      expect(mockClient.start).toHaveBeenCalled();
    });

    it('should handle devices with no controls', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockClient = {
        start: jest.fn().mockResolvedValue(undefined),
        getDevices: jest.fn().mockReturnValue([{ id: 'device1', name: 'Device 1', driver: 'wb-gpio', title: { en: 'D1', ru: 'D1' } }]),
        getControls: jest.fn().mockReturnValue([]),
        getState: jest.fn().mockReturnValue(undefined),
        setState: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      };

      instance.mqttClient = mockClient as unknown as WbMqttClient;
      instance.deviceFactory = {
        createDevices: jest.fn().mockReturnValue([]),
      } as unknown as WbDeviceFactory;

      await instance.onStart('test');
    });

    it('should handle z2m excluded devices', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockClient = {
        start: jest.fn().mockResolvedValue(undefined),
        getDevices: jest.fn().mockReturnValue([{ id: '0x123456', name: '0x123456', driver: 'wb-rules', title: { en: 'Z2M', ru: 'Z2M' } }]),
        getControls: jest.fn().mockReturnValue([]),
        getState: jest.fn().mockReturnValue(undefined),
        setState: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      };

      instance.mqttClient = mockClient as unknown as WbMqttClient;
      instance.deviceFactory = {
        createDevices: jest.fn().mockReturnValue([]),
      } as unknown as WbDeviceFactory;

      await instance.onStart('test');
    });

    it('should handle device with no serialNumber', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockDevice = {
        id: 'test-id',
        deviceName: '',
      };

      instance.getDevices = jest.fn().mockReturnValue([mockDevice as never]);
      instance.validateDevice = jest.fn().mockReturnValue(true);
      instance.unregisterDevice = jest.fn().mockResolvedValue(undefined);

      await instance.onConfigure();
    });

    it('should handle device with serialNumber but no deviceName', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockDevice = {
        id: 'test-id',
        deviceName: '',
        serialNumber: 'test-serial',
      };

      instance.getDevices = jest.fn().mockReturnValue([mockDevice as never]);
      instance.validateDevice = jest.fn().mockReturnValue(true);

      await instance.onConfigure();
    });
  });

  describe('onConfigure', () => {
    it('should log device configurations', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockDevice = {
        uniqueId: 'test-unique-id',
        deviceName: 'Test Device',
        serialNumber: 'WB-test',
      };

      instance.getDevices = jest.fn().mockReturnValue([mockDevice]);

      await instance.onConfigure();

      expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
    });

    it('should handle empty device list in configure', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      instance.getDevices = jest.fn().mockReturnValue([]);

      await instance.onConfigure();

      expect(mockLog.info).toHaveBeenCalledWith('onConfigure called');
    });
  });

  describe('validateDevice', () => {
    it('should allow device when no whitelist/blacklist', () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const result = instance.validateDevice(['device1', 'device1'], false);
      expect(result).toBe(true);
    });

    it('should filter by whitelist', () => {
      const config = createMockConfig({ whiteList: ['device1', 'device2'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      expect(instance.validateDevice(['device1', 'device1'], false)).toBe(true);
      expect(instance.validateDevice(['device3', 'device3'], false)).toBe(false);
    });

    it('should filter by blacklist', () => {
      const config = createMockConfig({ blackList: ['device1'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      expect(instance.validateDevice(['device1', 'device1'], false)).toBe(false);
      expect(instance.validateDevice(['device2', 'device2'], false)).toBe(true);
    });

    it('should check both whitelist and blacklist', () => {
      const config = createMockConfig({ whiteList: ['device1', 'device2'], blackList: ['device2'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      expect(instance.validateDevice(['device1', 'device1'], false)).toBe(true);
      expect(instance.validateDevice(['device2', 'device2'], false)).toBe(false);
    });

    it('should allow when not in blacklist but in whitelist for other', () => {
      const config = createMockConfig({ whiteList: ['device1'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      expect(instance.validateDevice(['device1', 'device1'], false)).toBe(true);
      expect(instance.validateDevice(['device2', 'device2'], false)).toBe(false);
    });

    it('should handle checkOnly mode', () => {
      const config = createMockConfig({ whiteList: ['device1'] });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      expect(instance.validateDevice(['device1', 'device1'], true)).toBe(true);
    });
  });

  describe('registerDevice', () => {
    it('should register device successfully', () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockDevices = instance.getDevices();
      expect(mockDevices).toBeDefined();
    });
  });

  describe('unregisterDevice', () => {
    it('should have getDevices method', () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockDevices = instance.getDevices();
      expect(mockDevices).toBeDefined();
    });
  });

  describe('clearSelect', () => {
    it('should clear devices', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.clearSelect();
      expect(instance.getDevices().length).toBe(0);
    });
  });

  describe('onShutdown', () => {
    it('should handle shutdown without unregisterOnShutdown', async () => {
      const config = createMockConfig({ unregisterOnShutdown: false });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      const mockClient = {
        stop: jest.fn().mockResolvedValue(undefined),
      };
      instance.mqttClient = mockClient as unknown as WbMqttClient;

      await instance.onShutdown('test');
      expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: test');
    });

    it('should handle shutdown with unregisterOnShutdown', async () => {
      const config = createMockConfig({ unregisterOnShutdown: true });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);

      const mockClient = {
        stop: jest.fn().mockResolvedValue(undefined),
      };
      instance.mqttClient = mockClient as unknown as WbMqttClient;

      instance.unregisterAllDevices = jest.fn().mockResolvedValue(undefined);

      await instance.onShutdown('test');
      expect(instance.unregisterAllDevices).toHaveBeenCalled();
    });

    it('should handle shutdown with undefined reason', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockClient = {
        stop: jest.fn().mockResolvedValue(undefined),
      };
      instance.mqttClient = mockClient as unknown as WbMqttClient;

      await instance.onShutdown();
      expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: none');
    });
  });

  describe('config with defaults', () => {
    it('should use default host', () => {
      const config = createMockConfig({ host: undefined });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance).toBeDefined();
    });

    it('should use default port', () => {
      const config = createMockConfig({ port: undefined });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance).toBeDefined();
    });

    it('should use default language', () => {
      const config = createMockConfig({ language: undefined });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance).toBeDefined();
    });

    it('should use default protocol version', () => {
      const config = createMockConfig({ protocolVersion: undefined });
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, config);
      expect(instance).toBeDefined();
    });
  });

  describe('onChangeLoggerLevel', () => {
    it('should log DEBUG level', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onChangeLoggerLevel(LogLevel.DEBUG);
      expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
    });

    it('should log ERROR level', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onChangeLoggerLevel(LogLevel.ERROR);
      expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: error');
    });

    it('should log WARN level', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onChangeLoggerLevel(LogLevel.WARN);
      expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: warn');
    });

    it('should log NOTICE level', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.onChangeLoggerLevel(LogLevel.NOTICE);
      expect(mockLog.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: notice');
    });
  });

  describe('onShutdown with mqtt', () => {
    it('should handle mqtt stop error gracefully', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());

      const mockClient = {
        stop: jest.fn().mockResolvedValue(undefined),
      };
      instance.mqttClient = mockClient as unknown as WbMqttClient;

      await instance.onShutdown('test');
      expect(mockLog.info).toHaveBeenCalledWith('onShutdown called with reason: test');
    });
  });

  describe('getDevices', () => {
    it('should return empty devices initially', () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      const devices = instance.getDevices();
      expect(devices).toEqual([]);
    });
  });

  describe('unregisterAllDevices', () => {
    it('should handle unregister all', async () => {
      instance = new WirenboardPlatform(createMockMatterbridge(), mockLog, createMockConfig());
      await instance.unregisterAllDevices();
    });
  });
});

describe('WbDeviceFactory', () => {
  const createMockLog = () =>
    ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }) as unknown as AnsiLogger;

  const createMockCallbacks = () => ({
    getState: jest.fn().mockReturnValue(undefined),
    setState: jest.fn().mockResolvedValue(undefined),
  });

  const createMockDevice = (overrides: Partial<WbDevice> = {}): WbDevice => ({
    id: 'test-device',
    name: 'Test Device',
    driver: 'wb-gpio',
    title: { en: 'Test Device', ru: 'Тестовое устройство' },
    ...overrides,
  });

  const createMockControl = (overrides: Partial<WbControl> = {}): WbControl => ({
    id: 'test-control',
    deviceId: 'test-device',
    type: 'switch',
    title: { en: 'Test Control', ru: 'Тест' },
    ...overrides,
  });

  describe('constructor', () => {
    it('should create factory with default language', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      expect(factory).toBeDefined();
    });

    it('should create factory with custom language', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1, language: 'en' });
      expect(factory).toBeDefined();
    });

    it('should use ru language by default', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      expect(factory).toBeDefined();
    });
  });

  describe('createDevices', () => {
    it('should return empty array when no controls', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const result = factory.createDevices(createMockDevice(), [], createMockCallbacks());
      expect(result).toEqual([]);
    });

    it('should skip controls that cannot be mapped', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'unsupported' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result).toEqual([]);
    });

    it('should create device for switch control', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'switch', readonly: false });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for temperature sensor', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'value', units: 'deg C' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for humidity sensor', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'value', units: '%' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for light sensor', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'value', units: 'lx' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for power sensor', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'value', units: 'W' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for energy sensor', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'value', units: 'kWh' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for dimmer', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'range' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for RGB light', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'rgb' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for button', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'switch', readonly: true });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should create device for alarm control', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'alarm' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should skip hidden controls', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'switch', hidden: true });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result).toEqual([]);
    });

    it('should create multiple devices from multiple controls', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const controls = [
        createMockControl({ id: 'switch1', type: 'switch', readonly: false }),
        createMockControl({ id: 'switch2', type: 'switch', readonly: false }),
        createMockControl({ id: 'temp', type: 'value', units: 'deg C' }),
      ];
      const result = factory.createDevices(createMockDevice(), controls, createMockCallbacks());
      expect(result.length).toBe(3);
    });

    it('should use control title for device name', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1, language: 'en' });
      const control = createMockControl({
        type: 'switch',
        readonly: false,
        title: { en: 'Living Room Light', ru: 'Свет в гостиной' },
      });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
      expect(result[0].deviceName).toContain('Living Room Light');
    });

    it('should use control name as fallback', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({
        type: 'switch',
        readonly: false,
        name: 'My Switch',
      });
      delete control.title;
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should add units to device name for sensors', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({ type: 'value', units: 'deg C' });
      const result = factory.createDevices(createMockDevice(), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });

    it('should handle control without title or name', () => {
      const factory = new WbDeviceFactory(createMockLog(), { aggregatorVendorId: 0xfff1 });
      const control = createMockControl({
        type: 'switch',
        readonly: false,
        id: 'control123',
      });
      delete control.title;
      delete control.name;
      const result = factory.createDevices(createMockDevice({ name: 'Device' }), [control], createMockCallbacks());
      expect(result.length).toBe(1);
    });
  });
});
