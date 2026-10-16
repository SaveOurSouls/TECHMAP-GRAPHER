import { type Point } from "./design-types";

export function parseSha256(value: unknown, name: string): string {
  const result = requireString(value, name);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`${name} задан неверно.`);
  return result;
}
export function parseNormalizedPosition(value: unknown, name: string): number {
  const number = requireNumber(value, name);
  if (number < 0 || number > 1) throw new Error(`${name} должно быть от 0 до 1.`);
  return number;
}
export function requirePositive(value: unknown, name: string): number {
  const result = requireNumber(value, name);
  if (result <= 0) throw new Error(`${name} должно быть положительным числом.`);
  return result;
}
export function parsePoint(value: unknown): Point {
  const record = requireRecord(value, "Координата задана неверно.");
  return { x: requireNumber(record.x, "Координата X"), y: requireNumber(record.y, "Координата Y") };
}
export function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error(`${name} задано неверно.`);
  return value;
}
export function optionalString(value: unknown, name: string): string {
  return value === undefined ? "" : requireString(value, name);
}
export function requireText(value: unknown, name: string): string {
  const result = requireString(value, name);
  if (!result.trim()) throw new Error(`${name} не заполнено.`);
  return result;
}
export function requireBoundedText(value: unknown, name: string, maximumLength: number): string {
  const result = requireText(value, name);
  if (result.length > maximumLength) throw new Error(`${name} задано неверно.`);
  return result;
}
export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} задано неверно.`);
  return value;
}
export function requireInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} задано неверно.`);
  }
  return value as number;
}
export function parseNonEmptyGuid(value: unknown, name: string): string {
  const result = requireString(value, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result) ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(result)) {
    throw new Error(`${name} задан неверно.`);
  }
  return result.toLowerCase();
}
