/**
 * MQTT клиент для Wirenboard.
 *
 * @file WbMqttClient.ts
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

import { connectAsync, ErrorWithReasonCode, IClientOptions, IDisconnectPacket, IPublishPacket, MqttClient } from 'mqtt';
import { AnsiLogger, LogLevel, TimestampFormat } from 'node-ansi-logger';

/**
 * Устройство Wirenboard из MQTT метаданных.
 */
export interface WbDevice {
  id: string;
  name: string;
  driver: string;
  title: { en: string; ru: string };
}

/**
 * Управление (канал) устройства Wirenboard.
 */
export interface WbControl {
  id: string;
  deviceId: string;
  name?: string;
  type: string;
  title: { en: string; ru: string };
  units?: string;
  min?: number;
  max?: number;
  precision?: number;
  readonly?: boolean;
  hidden?: boolean;
  enum?: Record<string, { en: string; ru: string }>;
  error?: string;
}

/**
 * Состояние устройства Wirenboard.
 */
export interface WbState {
  value: string | number;
  updatedAt: number;
}

/**
 * Ошибка устройства Wirenboard.
 */
export interface WbError {
  deviceId: string;
  controlId?: string;
  error: string;
  timestamp: number;
}

export declare interface WbMqttClientEvents {
  device: (device: WbDevice) => void;
  control: (deviceId: string, control: WbControl) => void;
  state: (deviceId: string, controlId: string, value: string | number) => void;
  error: (error: WbError) => void;
  mqtt_connect: () => void;
  mqtt_disconnect: () => void;
  mqtt_error: (error: Error) => void;
}

/**
 * MQTT клиент для подключения к Wirenboard.
 */
export class WbMqttClient extends EventEmitter {
  private log: AnsiLogger;

  public mqttHost: string;
  public mqttPort: number;
  public mqttUsername: string | undefined;
  public mqttPassword: string | undefined;
  public language: string;
  private mqttClient: MqttClient | undefined;
  private mqttIsConnected = false;
  private mqttIsReconnecting = false;
  private mqttIsEnding = false;

  private devices: WbDevice[] = [];
  private controls: Map<string, WbControl[]> = new Map();
  private states: Map<string, WbState> = new Map();

  private options: IClientOptions = {
    clientId: 'matterbridge_wirenboard_' + crypto.randomBytes(8).toString('hex'),
    keepalive: 60,
    protocolVersion: 5,
    reconnectPeriod: 5000,
    connectTimeout: 60 * 1000,
    username: undefined,
    password: undefined,
    clean: true,
  };

  constructor(
    mqttHost: string,
    mqttPort: number,
    mqttUsername?: string,
    mqttPassword?: string,
    mqttClientId?: string,
    protocolVersion: 3 | 4 | 5 = 5,
    debug: boolean = false,
    language: string = 'ru',
  ) {
    super();

    this.log = new AnsiLogger({
      logName: 'WirenboardMQTT',
      logTimestampFormat: TimestampFormat.TIME_MILLIS,
      logLevel: debug ? LogLevel.DEBUG : LogLevel.INFO,
    });

    this.mqttHost = mqttHost;
    this.mqttPort = mqttPort;
    this.mqttUsername = mqttUsername;
    this.mqttPassword = mqttPassword;
    this.language = language;

    this.options.username = mqttUsername !== undefined && mqttUsername !== '' ? mqttUsername : undefined;
    this.options.password = mqttPassword !== undefined && mqttPassword !== '' ? mqttPassword : undefined;
    if (mqttClientId) this.options.clientId = mqttClientId;
    this.options.protocolVersion = protocolVersion;

    this.log.debug(`Created WirenboardMQTT client: host=${mqttHost} port=${mqttPort} protocol=${protocolVersion}`);
  }

  public setLogLevel(logLevel: LogLevel): void {
    this.log.logLevel = logLevel;
  }

  public getUrl(): string {
    return this.mqttHost.includes('unix://') ? this.mqttHost : this.mqttHost + ':' + this.mqttPort.toString();
  }

  public async start(): Promise<void> {
    this.log.info(`Connecting to Wirenboard MQTT at ${this.getUrl()}...`);

    connectAsync(this.getUrl(), this.options)
      .then((client) => {
        this.log.info('MQTT connection established');
        this.mqttClient = client;

        this.mqttIsConnected = true;
        this.mqttIsReconnecting = false;
        this.mqttIsEnding = false;
        this.emit('mqtt_connect');

        // Подписываемся сразу после получения клиента
        this.subscribeToTopics();

        this.mqttClient.on('reconnect', () => {
          this.log.debug('MQTT reconnecting');
          this.mqttIsReconnecting = true;
          this.emit('mqtt_reconnect');
        });

        this.mqttClient.on('disconnect', (_packet: IDisconnectPacket) => {
          this.log.debug('MQTT disconnected');
          this.emit('mqtt_disconnect');
        });

        this.mqttClient.on('close', () => {
          this.log.debug('MQTT connection closed');
          this.mqttIsConnected = false;
          this.emit('mqtt_close');
        });

        this.mqttClient.on('end', () => {
          this.log.debug('MQTT ended');
          this.mqttIsConnected = false;
          this.emit('mqtt_end');
        });

        this.mqttClient.on('offline', () => {
          this.log.debug('MQTT offline');
          this.emit('mqtt_offline');
        });

        this.mqttClient.on('error', (error: Error | ErrorWithReasonCode) => {
          this.log.error('MQTT error:', error.message);
          this.emit('mqtt_error', error);
        });

        this.mqttClient.on('message', (topic: string, payload: Buffer, _packet: IPublishPacket) => {
          this.handleMessage(topic, payload);
        });

        this.log.info('Wirenboard MQTT client started');
      })
      .catch((error) => {
        this.log.error(`Error connecting to MQTT: ${error.message}`);
        this.emit('mqtt_error', error);
      });
  }

  public async stop(): Promise<void> {
    if (!this.mqttClient || this.mqttIsEnding) {
      this.log.debug('Already stopped!');
      return;
    }

    this.mqttIsEnding = true;
    this.log.info('Stopping MQTT client...');

    this.mqttClient
      .endAsync(true)
      .then(() => {
        this.mqttClient?.removeAllListeners();
        this.mqttIsConnected = false;
        this.mqttIsReconnecting = false;
        this.mqttIsEnding = false;
        this.mqttClient = undefined;
        this.log.info('MQTT client stopped');
      })
      .catch((error) => {
        this.log.error(`Error stopping MQTT: ${error.message}`);
      });
  }

  private async subscribeToTopics(): Promise<void> {
    if (!this.mqttClient || !this.mqttIsConnected) {
      this.log.error('Cannot subscribe: MQTT not connected');
      return;
    }

    this.log.debug('Subscribing to Wirenboard topics...');
    await this.mqttClient.subscribeAsync('/devices/+/meta', { qos: 1 });
    await this.mqttClient.subscribeAsync('/devices/+/controls/+/meta', { qos: 1 });
    await this.mqttClient.subscribeAsync('/devices/+/controls/+', { qos: 1 });
    this.log.info('Subscribed to Wirenboard topics');
  }

  private parseDeviceMeta(topic: string, payload: unknown): void {
    const match = topic.match(/^\/devices\/([^/]+)\/meta$/);
    if (!match) return;

    const deviceId = match[1];
    const meta = payload as { driver?: string; title?: { en?: string; ru?: string } };
    const title = meta.title || { en: deviceId, ru: deviceId };

    const langKey = this.language as 'en' | 'ru';
    const deviceName = title[langKey] || title.en || title.ru || deviceId;

    const existingIndex = this.devices.findIndex((d) => d.id === deviceId);
    const device: WbDevice = {
      id: deviceId,
      name: deviceName,
      driver: meta.driver || 'unknown',
      title: title as { en: string; ru: string },
    };

    if (existingIndex >= 0) {
      this.devices[existingIndex] = device;
    } else {
      this.devices.push(device);
    }

    this.emit('device', device);
    this.log.debug(`Device: ${deviceId} -> ${device.name} (driver: ${device.driver})`);
  }

  private parseControlMeta(topic: string, payload: unknown): void {
    const match = topic.match(/^\/devices\/([^/]+)\/controls\/([^/]+)\/meta$/);
    if (!match) return;

    const deviceId = match[1];
    const controlId = match[2];
    const meta = payload as WbControl;

    const langKey = this.language as 'en' | 'ru';

    if (!this.controls.has(deviceId)) {
      this.controls.set(deviceId, []);
    }

    const deviceControls = this.controls.get(deviceId) ?? [];
    const existingIndex = deviceControls.findIndex((c) => c.id === controlId);

    const control: WbControl = {
      id: controlId,
      deviceId: deviceId,
      type: meta.type || 'value',
      title: meta.title || { en: controlId, ru: controlId },
      units: meta.units,
      min: meta.min,
      max: meta.max,
      precision: meta.precision,
      // Преобразуем число/строку в boolean: 0/false = false, 1/true = true
      // Приводим к any потому что meta.readonly может быть number, string или boolean
      readonly: (meta.readonly as any) === 1 || (meta.readonly as any) === true || (meta.readonly as any) === '1' || (meta.readonly as any) === 'true',
      hidden: meta.hidden,
      enum: meta.enum,
    };

    const titleAny = meta.title as { en?: string; ru?: string } | undefined;
    const controlName = titleAny?.[langKey] || titleAny?.en || titleAny?.ru || controlId;
    control.name = controlName;

    if (existingIndex >= 0) {
      deviceControls[existingIndex] = control;
    } else {
      deviceControls.push(control);
    }

    this.log.debug(`Control: ${deviceId}/${controlId} -> type=${control.type}`);

    this.emit('control', deviceId, control);
  }

  private parseControlError(topic: string, payload: string): void {
    const match = topic.match(/^\/devices\/([^/]+)\/controls\/([^/]+)\/meta\/error$/);
    if (!match) return;

    const deviceId = match[1];
    const controlId = match[2];
    const error = payload.trim();

    if (error && error !== '0' && error !== '') {
      const WbError: WbError = {
        deviceId,
        controlId,
        error,
        timestamp: Date.now(),
      };
      this.emit('error', WbError);
      this.log.warn(`Error for ${deviceId}/${controlId}: ${error}`);
    }
  }

  private parseDeviceError(topic: string, payload: string): void {
    const match = topic.match(/^\/devices\/([^/]+)\/meta\/error$/);
    if (!match) return;

    const deviceId = match[1];
    const error = payload.trim();

    if (error && error !== '0' && error !== '') {
      const WbError: WbError = {
        deviceId,
        error,
        timestamp: Date.now(),
      };
      this.emit('error', WbError);
      this.log.warn(`Error for device ${deviceId}: ${error}`);
    }
  }

  private parseControlState(topic: string, payload: Buffer): void {
    const match = topic.match(/^\/devices\/([^/]+)\/controls\/([^/]+)$/);
    if (!match || topic.includes('/meta') || topic.includes('/on')) return;

    const deviceId = match[1];
    const controlId = match[2];
    const value = payload.toString();

    this.states.set(`${deviceId}/${controlId}`, {
      value: isNaN(Number(value)) ? value : Number(value),
      updatedAt: Date.now(),
    });

    this.emit('state', deviceId, controlId, value);
    this.log.debug(`State: ${deviceId}/${controlId} = ${value}`);
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const payloadString = payload.toString().trim();

    // Логируем все входящие топики для отладки
    this.log.debug(`MQTT received: ${topic} = ${payloadString.substring(0, 200)}`);

    if (topic.includes('/meta/error')) {
      if (topic.includes('/controls/')) {
        this.parseControlError(topic, payloadString);
      } else {
        this.parseDeviceError(topic, payloadString);
      }
      return;
    }

    if (payloadString.startsWith('{') && payloadString.endsWith('}')) {
      try {
        const json = JSON.parse(payloadString);
        if (topic.includes('/meta')) {
          if (topic.includes('/controls/')) {
            this.parseControlMeta(topic, json);
          } else {
            this.parseDeviceMeta(topic, json);
          }
        } else if (topic.includes('/controls/')) {
          this.parseControlState(topic, payload);
        }
      } catch {
        this.log.debug(`Failed to parse JSON for ${topic}`);
      }
    } else {
      if (topic.includes('/controls/') && !topic.includes('/meta') && !topic.includes('/on')) {
        this.parseControlState(topic, payload);
      }
    }
  }

  public getDevices(): WbDevice[] {
    return this.devices;
  }

  public getControls(deviceId: string): WbControl[] {
    return this.controls.get(deviceId) || [];
  }

  public getState(deviceId: string, controlId: string): WbState | undefined {
    return this.states.get(`${deviceId}/${controlId}`);
  }

  public async setState(deviceId: string, controlId: string, value: string | number): Promise<void> {
    if (!this.mqttClient || !this.mqttIsConnected) {
      this.log.error('Cannot publish: MQTT not connected');
      return;
    }

    const topic = `/devices/${deviceId}/controls/${controlId}/on`;
    const message = String(value);

    this.log.debug(`Publishing: ${topic} = ${message}`);
    await this.mqttClient.publishAsync(topic, message, { qos: 1 });
  }

  public isConnected(): boolean {
    return this.mqttIsConnected;
  }
}
