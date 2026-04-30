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
  version: '0.5.0',
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
