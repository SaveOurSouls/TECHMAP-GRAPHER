export const artworkViewBox: string;
export const artworkEnds: readonly string[];
export function safeWireColor(value: string): string;
export function bodyPart(color?: string): string;
export function endPart(kind: string): string;
export function renderWireSvg(options: { left: string; right: string; color?: string; title?: string }): string;
export function renderPartSvg(part: string, color?: string): string;
