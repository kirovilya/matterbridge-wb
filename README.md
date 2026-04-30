<img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge Wirenboard plugin

[![npm version](https://img.shields.io/npm/v/matterbridge-wb.svg)](https://www.npmjs.com/package/matterbridge-wb)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-wb.svg)](https://www.npmjs.com/package/matterbridge-wb)
![Node.js CI](https://github.com/kirovilya/matterbridge-wb/actions/workflows/build.yml/badge.svg)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/api/esm.html)
[![matterbridge.io](https://img.shields.io/badge/matterbridge.io-online-brightgreen)](https://matterbridge.io)

[![powered by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)
[![powered by](https://img.shields.io/badge/powered%20by-node--ansi--logger-blue)](https://www.npmjs.com/package/node-ansi-logger)
[![powered by](https://img.shields.io/badge/powered%20by-node--persist--manager-blue)](https://www.npmjs.com/package/node-persist-manager)

---

Matterbridge Wirenboard is a Matterbridge production-level plugin that exposes Wirenboard devices to Matter.

No hub or dedicated hardware needed.

No cloud: all is local and fast.

The connection to the MQTT broker is possible with **mqtt** (tcp), **mqtts** (tls), and **mqtt+unix** (Unix socket).

## Introduction

Matterbridge enables non-Matter devices to integrate with the Matter communication protocol. Bridges allow platforms that use other protocol standards to interoperate with the Matter ecosystem by integrating a Matter server into, or between, existing smart gateways, controllers, and hubs.

The Matterbridge Wirenboard plugin acts as a Matter Bridge, exposing all devices from [Wirenboard](https://wirenboard.com/) as Matter devices to third-party Matter controllers like Apple Home, Google Home, Amazon Alexa, and SmartThings, all while remaining local on the user's network.

## Prerequisites

### Matterbridge

See the guidelines on [Matterbridge](https://matterbridge.io/README.html) for more information.

### Wirenboard

See the guidelines on [Wirenboard](https://wirenboard.com/) for more information.

## How to install the plugin

### With the frontend (preferred method)

Just open the frontend, select the matterbridge-wb plugin and click on install.

### Without the frontend

On Windows:

```bash
cd %USERPROFILE%\Matterbridge
npm install -g matterbridge-wb --omit=dev
matterbridge -add matterbridge-wb
```

On Linux and macOS:

```bash
cd ~/Matterbridge
sudo npm install -g matterbridge-wb --omit=dev
matterbridge -add matterbridge-wb
```

Then start Matterbridge

```bash
matterbridge
```

## If you want to contribute to the plugin

Clone the plugin

```bash
cd ~/Matterbridge
git clone https://github.com/kirovilya/matterbridge-wb
cd matterbridge-wb
npm ci
npm run dev:link
npm run build
matterbridge -add .
```

Then start Matterbridge

```bash
matterbridge
```

# Config file

All configurations can (and should) be done with the frontend.

If needed you can configure the MQTT host, port, username, password, and protocol version.

If the whiteList is defined, only the devices included are exposed to Matter.

If the blackList is defined, the devices included will not be exposed to Matter.

The debug option allows you to set the debug mode only for the plugin.

The unregisterOnShutdown option allows you to remove from the bridge all Wirenboard devices when you shut down Matterbridge.

These are the default values:

```json
{
  "name": "matterbridge-wb",
  "type": "DynamicPlatform",
  "host": "mqtt://localhost",
  "port": 1883,
  "username": "",
  "password": "",
  "clientId": "",
  "protocolVersion": 5,
  "whiteList": [],
  "blackList": [],
  "postfix": "",
  "language": "ru",
  "debug": false,
  "unregisterOnShutdown": false
}
```

## Supported devices and controls

The plugin supports various device types from Wirenboard, including:

- **Switches** - on/off control
- **Lights** - on/off and brightness
- **Temperature sensors** - temperature measurement
- **Humidity sensors** - humidity measurement
- **Binary sensors** - door, window, motion sensors
- **and more...**

## Language support

You can select the device title language:

- Russian (`ru`) - default
- English (`en`)

## Known issues

For general controller issues, check the Matterbridge Known issues section.

---

## Описание плагина

Matterbridge Wirenboard — это плагин Matterbridge для интеграции устройств Wirenboard в экосистему Matter.

Не требует дополнительных хабов или оборудования.

Всё работает локально, без облака.

Подключение к MQTT брокеру возможно через **mqtt** (tcp), **mqtts** (tls) и **mqtt+unix** (Unix сокет).

## Введение

Matterbridge позволяет устройствам без поддержки протокола Matter интегрироваться в экосистему Matter. Мосты позволяют платформам, использующим другие протоколы, взаимодействовать с экосистемой Matter через интеграцию Matter-сервера в существующие шлюзы, контроллеры и хабы.

Плагин Matterbridge Wirenboard выступает как Matter Bridge, предоставляя все устройства с [Wirenboard](https://wirenboard.com/) как Matter-устройства для сторонних Matter-контроллеров, таких как Apple Home, Google Home, Amazon Alexa и SmartThings, при этом всё остаётся локально в сети пользователя.

## Требования

### Matterbridge

Подробности на [Matterbridge](https://matterbridge.io/README.html).

### Wirenboard

Подробности на [Wirenboard](https://wirenboard.com/).

## Установка плагина

### Через веб-интерфейс (рекомендуется)

Откройте веб-интерфейс, выберите плагин matterbridge-wb и нажмите "Установить".

### Без веб-интерфейса

На Windows:

```bash
cd %USERPROFILE%\Matterbridge
npm install -g matterbridge-wb --omit=dev
matterbridge -add matterbridge-wb
```

На Linux и macOS:

```bash
cd ~/Matterbridge
sudo npm install -g matterbridge-wb --omit=dev
matterbridge -add matterbridge-wb
```

Затем запустите Matterbridge:

```bash
matterbridge
```

## Конфигурация

Все настройки можно (и рекомендуется) сделать через веб-интерфейс.

При необходимости можно настроить MQTT-хост, порт, имя пользователя, пароль и версию протокола.

Если задан whiteList, только включённые устройства будут добавлены в Matter.

Если задан blackList, включённые устройства не будут добавлены в Matter.

Опция debug позволяет включить режим отладки только для плагина.

Опция unregisterOnShutdown позволяет удалить из моста все устройства Wirenboard при выключении Matterbridge.

Значения по умолчанию:

```json
{
  "name": "matterbridge-wb",
  "type": "DynamicPlatform",
  "host": "mqtt://localhost",
  "port": 1883,
  "username": "",
  "password": "",
  "clientId": "",
  "protocolVersion": 5,
  "whiteList": [],
  "blackList": [],
  "postfix": "",
  "language": "ru",
  "debug": false,
  "unregisterOnShutdown": false
}
```

## Поддерживаемые устройства и элементы управления

Плагин поддерживает различные типы устройств Wirenboard:

- **Выключатели** — вкл/выкл
- **Светильники** — вкл/выкл и яркость
- **Температурные датчики** — измерение температуры
- **Датчики влажности** — измерение влажности
- **Бинарные датчики** — двери, окна, движение
- **и многое другое...**

## Выбор языка названий устройств

Можно выбрать язык для названий устройств:

- Русский (`ru`) — по умолчанию
- Английский (`en`)
