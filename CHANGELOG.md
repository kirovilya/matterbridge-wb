# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-05-03

[0.6.0]: https://github.com/kirovilya/matterbridge-wb/releases/tag/v0.6.0

### Added

- Двусторонняя передача состояний между MQTT и Matter
  - MQTT → Matter: автоматическое обновление атрибутов при изменении значений в MQTT
  - Matter → MQTT: команды вкл/выкл/диммирование отправляются в MQTT топики
- Синхронизация устройств при старте с whiteList/blackList

### Features

- Расширенный мэппинг: switch (readonly=true) → contactSensor для кнопок
- Улучшенная конвертация RGB → XY для цветных ламп
- Исправлена обработка readonly (number/string/boolean)


## [0.5.0] - 2026-04-30

[0.5.0]: https://github.com/kirovilya/matterbridge-wb/releases/tag/v0.5.0

### Added

- Initial release of Matterbridge Wirenboard plugin
- MQTT client for connecting to Wirenboard MQTT broker
- Device factory for creating Matter devices from Wirenboard devices
- Support for multiple MQTT connection types: mqtt, mqtts, mqtt+unix
- Support for whiteList and blackList filtering
- Support for device title language selection (Russian/English)
- Support for debug logging
- Support for unregisterOnShutdown option

### Features

- Exposes Wirenboard devices to Matter controllers (Apple Home, Google Home, Amazon Alexa, SmartThings)
- Supports various device types: switches, lights, temperature sensors, humidity sensors, binary sensors
- Works locally without cloud connectivity
- Connection via TCP, TLS, or Unix socket

### Configuration

- `host` - MQTT broker URL (mqtt://, mqtts://, mqtt+unix://), default: mqtt://localhost
- `port` - MQTT broker port, default: 1883
- `username` - MQTT username (optional)
- `password` - MQTT password (optional)
- `clientId` - MQTT client ID (optional, auto-generated if empty)
- `protocolVersion` - MQTT protocol version (3, 4, or 5), default: 5
- `whiteList` - Only expose listed devices to Matter
- `blackList` - Do not expose listed devices to Matter
- `postfix` - Append postfix to device names in Matter
- `language` - Device title language (ru or en), default: ru
- `debug` - Enable debug logging, default: false
- `unregisterOnShutdown` - Remove devices on shutdown, default: false

### Requirements

- Matterbridge >= 3.4.0
- Node.js >= 20.19.0, 22.13.0, or 24.0.0
