/**
 * Мэппинг контролов Wirenboard в типы Matter устройств.
 *
 * Определяет правила преобразования:
 * - Какие контролы Wirenboard можно отобразить в Matter
 * - Какой тип Matter устройства создавать
 * - Как парсить значение из MQTT при синхронизации состояния
 */

import type { WbControl, WbDevice } from './WbMqttClient.js';

/** Типы Matter устройств, которые поддерживаются плагином. */
export type MatterDeviceType =
  | 'onOffSwitch'
  | 'genericSwitch'
  | 'dimmableLight'
  | 'colorLight'
  | 'contactSensor'
  | 'temperatureSensor'
  | 'humiditySensor'
  | 'electricalSensor'
  | 'lightSensor';

/** Правило мэппинга: определяет как контрол Wirenboard преобразуется в Matter. */
export interface ControlMappingRule {
  /** Драйвер устройства (wb-gpio, wb-rules, ...) */
  driver?: string;
  /** Тип контрола (switch, range, value, rgb, text, ...) */
  controlType?: string;
  /** Единицы измерения (deg C, %, W, kWh, lx, ...) */
  controlUnits?: string | string[];
  /** Контрол только для чтения (true = кнопка, false = реле) */
  controlReadonly?: boolean;
  /** Часть названия контрола для доп. фильтрации */
  controlNameIncludes?: string;

  /** Какой тип Matter устройства создавать */
  matterDeviceType: MatterDeviceType;

  /**
   * Как обновлять состояние в Matter при изменении значения в MQTT.
   * Определяет кластер Matter и атрибут для обновления.
   */
  stateUpdate?: {
    cluster: string; // Имя кластера Matter (TemperatureMeasurement, OnOff, ...)
    attribute: string; // Имя атрибута (measuredValue, onOff, currentLevel, ...)
    /** Функция парсинга значения из MQTT в формат Matter */
    valueParser: (value: string | number, units?: string) => number | boolean;
  };

  /**
   * Группировать несколько контролов в одно устройство.
   * ПОКА НЕ ИСПОЛЬЗУЕТСЯ - зарезервировано для будущего.
   */
  grouped?: boolean;
}

/**
 * Проверяет, соответствует ли контрол условиям правила мэппинга.
 *
 * @param control
 * @param device
 * @param rule
 */
function matchesRule(control: WbControl, device: WbDevice, rule: ControlMappingRule): boolean {
  // Проверка driver
  if (rule.driver !== undefined && device.driver !== rule.driver) {
    return false;
  }

  // Проверка controlType
  if (rule.controlType !== undefined && control.type !== rule.controlType) {
    return false;
  }

  // Проверка controlUnits
  if (rule.controlUnits !== undefined) {
    const units = control.units || '';
    const expectedUnits = Array.isArray(rule.controlUnits) ? rule.controlUnits : [rule.controlUnits];
    if (!expectedUnits.some((u) => units.includes(u))) {
      return false;
    }
  }

  // Проверка controlReadonly
  if (rule.controlReadonly !== undefined && control.readonly !== rule.controlReadonly) {
    return false;
  }

  // Проверка controlNameIncludes
  if (rule.controlNameIncludes !== undefined) {
    const name = control.name || control.id;
    if (!name.toLowerCase().includes(rule.controlNameIncludes.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Находит первое подходящее правило мэппинга для контрола.
 * Правила проверяются по порядку, первое совпадение возвращается.
 *
 * @param control
 * @param device
 * @returns Правило или undefined, если контрол не поддерживается
 */
export function findMappingRule(control: WbControl, device: WbDevice): ControlMappingRule | undefined {
  return DEFAULT_MAPPINGS.find((rule) => matchesRule(control, device, rule));
}

/**
 * Проверяет, можно ли отобразить контрол в Matter.
 * Контрол игнорируется если:
 * - hidden = true (скрытый контрол)
 * - нет подходящего правила мэппинга
 *
 * @param control
 * @param device
 */
export function canMapToMatter(control: WbControl, device: WbDevice): boolean {
  if (control.hidden) {
    return false;
  }
  return findMappingRule(control, device) !== undefined;
}

/**
 * Проверяет, нужно ли исключить устройство z2m (zigbee2mqtt).
 * Исключаются если:
 * - driver = wb-rules
 * - name начинается с "0x" (hex адрес zigbee устройства)
 *
 * @param device
 */
export function isZ2mExcluded(device: WbDevice): boolean {
  return device.driver === 'wb-rules' && device.name.startsWith('0x');
}

/**
 * Дефолтные правила мэппинга.
 * Порядок важен - первое совпадение используется.
 */
const DEFAULT_MAPPINGS: ControlMappingRule[] = [
  // ==================== ДАТЧИКИ ====================

  // Температура (value + deg C)
  {
    controlType: 'value',
    controlUnits: 'deg C',
    matterDeviceType: 'temperatureSensor',
    stateUpdate: {
      cluster: 'TemperatureMeasurement',
      attribute: 'measuredValue',
      // Matter хранит температуру в centi-degrees (100 = 1 degree)
      valueParser: (v) => Math.round(Number(v) * 100),
    },
  },

  // Влажность (value + % или RH)
  {
    controlType: 'value',
    controlUnits: ['%', 'RH'],
    matterDeviceType: 'humiditySensor',
    stateUpdate: {
      cluster: 'RelativeHumidityMeasurement',
      attribute: 'measuredValue',
      // Matter хранит влажность в процентах * 100
      valueParser: (v) => Math.round(Number(v) * 100),
    },
  },

  // Освещённость (value + lx)
  {
    controlType: 'value',
    controlUnits: 'lx',
    matterDeviceType: 'lightSensor',
    stateUpdate: {
      cluster: 'IlluminanceMeasurement',
      attribute: 'measuredValue',
      // Lux -> Illuminance: Matter использует формулу log10(lux + 1) * 10000
      valueParser: (v) => Math.round(Math.log10(Math.max(Number(v), 1) + 1) * 10000),
    },
  },

  // Мощность (value + W)
  {
    controlType: 'value',
    controlUnits: 'W',
    matterDeviceType: 'electricalSensor',
    stateUpdate: {
      cluster: 'ElectricalMeasurement',
      attribute: 'activePower',
      // W -> mW
      valueParser: (v) => Math.round(Number(v) * 1000),
    },
  },

  // Энергия (value + kWh)
  {
    controlType: 'value',
    controlUnits: 'kWh',
    matterDeviceType: 'electricalSensor',
    stateUpdate: {
      cluster: 'ElectricalMeasurement',
      attribute: 'cumulativeEnergy',
      // kWh -> mWh
      valueParser: (v) => Math.round(Number(v) * 3600000),
    },
  },

  // ==================== УПРАВЛЯЕМЫЕ УСТРОЙСТВА ====================

  // Переключатель/реле (type=switch, readonly=false или 0) - управляемый
  {
    controlType: 'switch',
    controlReadonly: false,
    matterDeviceType: 'onOffSwitch',
    stateUpdate: {
      cluster: 'OnOff',
      attribute: 'onOff',
      valueParser: (v) => Number(v) === 1,
    },
  },

  // Кнопка (type=switch, readonly=true или 1) - только уведомление о нажатии
  // contactSensor использует BooleanState cluster - без команд управления
  {
    controlType: 'switch',
    controlReadonly: true,
    matterDeviceType: 'contactSensor',
    stateUpdate: {
      cluster: 'BooleanState',
      attribute: 'stateValue',
      // 1 = нажата (true), 0 = отпущена (false)
      valueParser: (v) => Number(v) === 1,
    },
  },

  // Диммер (range)
  {
    controlType: 'range',
    matterDeviceType: 'dimmableLight',
    stateUpdate: {
      cluster: 'LevelControl',
      attribute: 'currentLevel',
      // 0-255 -> 0-100%
      valueParser: (v) => Math.round((Math.min(Math.max(Number(v), 0), 255) / 255) * 100),
    },
  },

  // RGB свет (rgb)
  {
    controlType: 'rgb',
    matterDeviceType: 'colorLight',
    stateUpdate: {
      cluster: 'ColorControl',
      attribute: 'colorXY',
      // R;G;B -> XY coordinates (JSON строка)
      valueParser: (v) => {
        const parts = String(v).split(';').map(Number);
        if (parts.length >= 3) {
          const xy = rgbToXy(parts[0], parts[1], parts[2]);
          // JSON для XY - Matter ожидает число
          return Math.round(xy.x + xy.y * 65536);
        }
        return 0;
      },
    },
  },

  // // Текстовый контрол
  // {
  //   controlType: 'text',
  //   matterDeviceType: 'contactSensor',
  //   stateUpdate: {
  //     cluster: 'BooleanState',
  //     attribute: 'stateValue',
  //     // Пустая строка или "0" = false, иначе true
  //     valueParser: (v) => v !== '0' && v !== '' && String(v).toLowerCase() !== 'off',
  //   }
  // },

  // alarm контрол
  {
    controlType: 'alarm',
    matterDeviceType: 'contactSensor',
    stateUpdate: {
      cluster: 'BooleanState',
      attribute: 'stateValue',
      valueParser: (v) => Number(v) === 1,
    },
  },

  // ==================== ЗАГЛУШКИ (reserved for grouping) ====================

  // wb-gpio с несколькими switch - placeholder для будущей группировки
  // ПОКА НЕ ИСПОЛЬЗУЕТСЯ
  {
    driver: 'wb-gpio',
    controlType: 'switch',
    grouped: true,
    matterDeviceType: 'onOffSwitch',
  },
];

/**
 * Конвертирует RGB в XY для Matter ColorControl.
 *
 * @param r
 * @param g
 * @param b
 */
function rgbToXy(r: number, g: number, b: number): { x: number; y: number } {
  // Простая конверсия RGB -> XY (D65 illuminant)
  // Нормализация RGB (0-255 -> 0-1)
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;

  // Gamma correction
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  // RGB to XYZ (sRGB D65)
  const X = rr * 0.4124 + gg * 0.3576 + bb * 0.1805;
  const Y = rr * 0.2126 + gg * 0.7152 + bb * 0.0722;
  const Z = rr * 0.0193 + gg * 0.1192 + bb * 0.9505;

  // XYZ to XY
  const sum = X + Y + Z;
  if (sum === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.round((X / sum) * 65536),
    y: Math.round((Y / sum) * 65536),
  };
}

/**
 * Возвращает список всех поддерживаемых типов Matter устройств.
 * Используется для отладки и диагностики.
 */
export function getSupportedMatterTypes(): MatterDeviceType[] {
  return [...new Set(DEFAULT_MAPPINGS.map((r) => r.matterDeviceType))];
}
