import { type CableInstance, type WireStripProfileLayer, type WireStripStep, type WireInstance, type WireCutLengthCalculation } from "./design-types";
import { requireNumber } from "./design-parse-primitives";

/** End corrections belong to the blank; stripping never adds a second material. */
export function calculateCableSheathStrip(cable: CableInstance) {
  const source = cable.sheathStrip;
  if (!source) return null;
  const end = (value: number | null, correction: number) => {
    if (value === null) return null;
    validateWirePhysicalLength(value, "Снятие оболочки");
    const result = value === 0 ? 0n : toExactMicrometres(value, "Снятие оболочки") + toExactMicrometres(correction, "Поправка");
    if (result < 0n) throw new Error("Снятие оболочки с поправкой не должно быть отрицательным.");
    return Number(result) / micrometresPerMillimetre;
  };
  const fromMm = end(source.fromMm, cable.endCorrectionFromMm);
  const toMm = end(source.toMm, cable.endCorrectionToMm);
  const totalMm = calculateWireCutLength(cable).unroundedTotalMm;
  if (cable.lengthMm !== null && toExactMicrometres(source.fromMm ?? 0, "Снятие оболочки") +
      toExactMicrometres(source.toMm ?? 0, "Снятие оболочки") > toExactMicrometres(cable.lengthMm, "Длина кабеля")) {
    throw new Error("Сумма снятия оболочки превышает длину кабеля.");
  }
  if (totalMm !== null && toExactMicrometres(fromMm ?? 0, "Снятие оболочки") +
      toExactMicrometres(toMm ?? 0, "Снятие оболочки") > toExactMicrometres(totalMm, "Длина кабеля")) {
    throw new Error("Снятие оболочки с поправками превышает длину заготовки.");
  }
  return { fromMm, toMm, totalMm, isComplete: fromMm !== null && toMm !== null && totalMm !== null };
}
const maximumWireStripLayers = 64;
/** Converts cumulative L values into independently executable strip steps. */
export function calculateWireStripSteps(layers: readonly WireStripProfileLayer[]): readonly WireStripStep[] {
  const normalized = normalizeWireStripProfileLayers(layers);
  let previousMicrometres = 0n;
  return Object.freeze(normalized.map((layer) => {
    const cumulativeMicrometres = toExactMicrometres(layer.stripLengthMm, `L${layer.index}`);
    const step = Object.freeze({
      index: layer.index,
      diameterMm: layer.diameterMm,
      cumulativeLengthMm: layer.stripLengthMm,
      stepLengthMm: Number(cumulativeMicrometres - previousMicrometres) / micrometresPerMillimetre,
    });
    previousMicrometres = cumulativeMicrometres;
    return step;
  }));
}
export const defaultWireCutRoundingStepMm = 1;
const maximumWireLengthMm = 1_000_000_000;
const micrometresPerMillimetre = 1_000;
/** Mirrors the exact M1 domain calculation without deriving physical length from canvas geometry. */
export function calculateWireCutLength(wire: Pick<WireInstance,
  "lengthMm" | "endCorrectionFromMm" | "endCorrectionToMm" | "cutRoundingStepMm"
>): WireCutLengthCalculation {
  const sourceLengthMm = validateWirePhysicalLength(wire.lengthMm);
  const endCorrectionFromMm = validateWireCorrection(wire.endCorrectionFromMm, "Поправка начала провода");
  const endCorrectionToMm = validateWireCorrection(wire.endCorrectionToMm, "Поправка конца провода");
  const cutRoundingStepMm = validateWireRoundingStep(wire.cutRoundingStepMm);
  const common = { sourceLengthMm, endCorrectionFromMm, endCorrectionToMm, cutRoundingStepMm };
  if (sourceLengthMm === null) {
    return {
      ...common,
      unroundedTotalMm: null,
      cutLengthMm: null,
      materialConsumptionMm: null,
      isComplete: false,
    };
  }
  const totalMicrometres = toExactMicrometres(sourceLengthMm, "Длина провода") +
    toExactMicrometres(endCorrectionFromMm, "Поправка начала провода") +
    toExactMicrometres(endCorrectionToMm, "Поправка конца провода");
  if (totalMicrometres < 0n) throw new Error("Итоговая длина провода не должна быть отрицательной.");
  const stepMicrometres = toExactMicrometres(cutRoundingStepMm, "Шаг округления длины резки");
  const remainder = totalMicrometres % stepMicrometres;
  const roundedMicrometres = remainder === 0n
    ? totalMicrometres
    : totalMicrometres + stepMicrometres - remainder;
  const unroundedTotalMm = Number(totalMicrometres) / micrometresPerMillimetre;
  const cutLengthMm = Number(roundedMicrometres) / micrometresPerMillimetre;
  return {
    ...common,
    unroundedTotalMm,
    cutLengthMm,
    materialConsumptionMm: cutLengthMm,
    isComplete: true,
  };
}
export function parseOuterDiameter(value:unknown):number {
  if(typeof value!=="number"||!Number.isFinite(value)||value<=0||value>1000)throw new Error("Диаметр изоляции должен быть больше 0 и не больше 1000 мм.");
  return value;
}
export function normalizeWireStripProfileLayers(layers: readonly WireStripProfileLayer[]): readonly WireStripProfileLayer[] {
  if (layers.length < 1 || layers.length > maximumWireStripLayers) {
    throw new Error(`Профиль разделки должен содержать от 1 до ${maximumWireStripLayers} слоёв.`);
  }
  let previousIndex = 0;
  let previousDiameterMicrometres = 0n;
  let previousLengthMicrometres = 0n;
  const normalized = layers.map((layer) => {
    if (!Number.isSafeInteger(layer.index) || layer.index < 1) {
      throw new Error("Номер слоя профиля разделки должен быть положительным целым числом.");
    }
    if (layer.index <= previousIndex) {
      throw new Error("Номера слоёв профиля разделки должны быть уникальны и расположены по возрастанию.");
    }
    const diameterMicrometres = validateWireStripMeasurement(layer.diameterMm, `D${layer.index}`);
    const lengthMicrometres = validateWireStripMeasurement(layer.stripLengthMm, `L${layer.index}`);
    if (diameterMicrometres <= previousDiameterMicrometres) {
      throw new Error("Диаметры слоёв профиля разделки должны строго возрастать.");
    }
    if (lengthMicrometres <= previousLengthMicrometres) {
      throw new Error("Длины слоёв профиля разделки должны строго возрастать.");
    }
    previousIndex = layer.index;
    previousDiameterMicrometres = diameterMicrometres;
    previousLengthMicrometres = lengthMicrometres;
    return Object.freeze({ index: layer.index, diameterMm: layer.diameterMm, stripLengthMm: layer.stripLengthMm });
  });
  return Object.freeze(normalized);
}
function validateWireStripMeasurement(value: number, name: string): bigint {
  if (!Number.isFinite(value) || value <= 0 || value > maximumWireLengthMm) {
    throw new Error(`${name} должна быть положительным числом в миллиметрах.`);
  }
  return toExactMicrometres(value, name);
}
export function validateWirePhysicalLength(value: number | null, name = "Длина провода"): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > maximumWireLengthMm) {
    throw new Error(`${name} должна быть неотрицательным числом в миллиметрах или неизвестной.`);
  }
  toExactMicrometres(value, name);
  return value;
}
export function validateWireCorrection(value: number, name: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximumWireLengthMm) {
    throw new Error(`${name} задана неверно.`);
  }
  toExactMicrometres(value, name);
  return value;
}
export function validateWireRoundingStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > maximumWireLengthMm) {
    throw new Error("Шаг округления длины резки должен быть положительным числом в миллиметрах.");
  }
  toExactMicrometres(value, "Шаг округления длины резки");
  return value;
}
function toExactMicrometres(value: number, name: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) {
    throw new Error(`${name} должна задаваться с точностью не более 0,001 мм.`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  const digits = BigInt(`${match[2]}${fraction}`);
  const micrometreExponent = exponent - fraction.length + 3;
  if (micrometreExponent >= 0) {
    return sign * digits * 10n ** BigInt(micrometreExponent);
  }
  const divisor = 10n ** BigInt(-micrometreExponent);
  if (digits % divisor !== 0n) {
    throw new Error(`${name} должна задаваться с точностью не более 0,001 мм.`);
  }
  return sign * (digits / divisor);
}
export function optionalCorrection(value: unknown, name: string): number | null {
  if (value === null) return null;
  const parsed = requireNumber(value, name);
  if (Math.abs(parsed) > 1_000_000_000) throw new Error(`${name} терминала задана неверно.`);
  return parsed;
}
