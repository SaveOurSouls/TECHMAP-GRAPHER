import { artworkWireDiameter, artworkJacketAnchor, renderPreparationSvg, preparationArtworkWidth } from '../wire-blank-artwork.mjs';
import { getTerminationSymbol } from '../termination-library/symbol';
import { getTerminationArtworkBounds } from '../termination-library/artwork-bounds';
import type { EditorPoint, EditorSceneObject } from './editor-types';
import type { EditorSceneBounds } from './editor-camera';
import type { HarnessDesignDocument } from './model';
import { effectiveEndPreparation, type EndPreparationMode } from './termination-model';

export interface WireEndArtworkPlacement { readonly x: number; readonly y: number; readonly rotation: number; readonly scale: number }
export interface PreparationDrawingArtwork extends WireEndArtworkPlacement {
  readonly mode: EndPreparationMode;
  readonly wireId: string;
  readonly href: string;
  /** Destination rectangle in the calibrated SVG coordinate system. */
  readonly image: readonly [number, number, number, number];
  readonly localBounds: readonly [number, number, number, number];
  readonly conductorDiameter: number;
}

/** Anchor the jacket edge at the stored endpoint. Decorations extend outwards,
 * so neither a short first segment nor camera zoom changes their diameter. */
export function drawingEndArtworkPlacement(origin: EditorPoint, adjacent: EditorPoint, width: number): WireEndArtworkPlacement | null {
  const dx = adjacent.x - origin.x, dy = adjacent.y - origin.y, length = Math.hypot(dx, dy);
  if (!length || !Number.isFinite(width) || width <= 0) return null;
  const scale = width / artworkWireDiameter;
  return { x: origin.x - dx / length * artworkJacketAnchor * scale, y: origin.y - dy / length * artworkJacketAnchor * scale, rotation: Math.atan2(dy, dx), scale };
}

export function artworkWorldPoint(art: WireEndArtworkPlacement, point: EditorPoint): EditorPoint {
  const c = Math.cos(art.rotation), s = Math.sin(art.rotation);
  return { x: art.x + art.scale * (point.x * c - point.y * s), y: art.y + art.scale * (point.x * s + point.y * c) };
}
export function preparationArtworkBounds(art: PreparationDrawingArtwork): EditorSceneBounds {
  const [x, y, right, bottom] = art.localBounds;
  const points = [{ x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }].map(p => artworkWorldPoint(art, p));
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
}
export function preparationArtworkContains(art: PreparationDrawingArtwork, point: EditorPoint, tolerance: number): boolean {
  const c = Math.cos(art.rotation), s = Math.sin(art.rotation), dx = point.x - art.x, dy = point.y - art.y;
  const x = (dx * c + dy * s) / art.scale, y = (-dx * s + dy * c) / art.scale, pad = tolerance / art.scale;
  const [left, top, right, bottom] = art.localBounds;
  return x >= left - pad && x <= right + pad && y >= top - pad && y <= bottom + pad;
}

// Symbolic inlet widths of accepted terminal drawings, not catalogue dimensions
// or manufacturing millimetres. Keep the incoming jacket inside its crimp/cuff.
function terminalInletDiameter(id: string): number {
  if (id.startsWith('nshvi-')) return id === 'nshvi-double' ? 30 : 20;
  if (['nki-ring','nvi-fork','pin-round','socket-round','flat-male','flat-female','nvsh-alias-pin-blade','din-sc-ring'].includes(id)) return 28;
  if (id === 'flag') return 20;
  return 16;
}

/** P1 remains a point in the document. Its drawing artwork comes from the same
 * projected wire as the visible path, including detached copies and physical P. */
export function withPreparationDrawingArtwork(document: HarnessDesignDocument, connectors: readonly EditorSceneObject[], wires: readonly EditorSceneObject[]): EditorSceneObject[] {
  const wireScenes = new Map(wires.map(w => [w.id, w]));
  return connectors.map(object => {
    const connector = document.connectors.find(c => c.id === object.id);
    if (connector?.terminationComponent?.kind !== 'preparation') return object;
    const artwork: PreparationDrawingArtwork[] = [];
    const sharedArtifacts = new Set<string>();
    for (const wire of document.wires) for (const end of ['from', 'to'] as const) {
      if (wire[end].connectorId !== connector.id || wire[end].junctionId || wire[end].screenId) continue;
      const scene = wireScenes.get(wire.id), preparation = effectiveEndPreparation(document, { wireId: wire.id, end });
      if (!scene || !preparation || preparation.mode === 'cut') continue;
      const points = scene.points ?? [], origin = end === 'from' ? points[0] : points.at(-1);
      if (!origin) continue;
      const adjacent = (end === 'from' ? points : [...points].reverse()).find(p => Math.hypot(p.x - origin.x, p.y - origin.y) > 1e-8);
      if (!adjacent) continue;
      let width = Number(scene.metadata?.drawingWidth ?? 2.5);
      const group = document.terminations?.groups.find(g => g.target.connectorId === connector.id && g.memberEnds.some(e => e.wireId === wire.id && e.end === end));
      const artifact = document.terminations?.artifacts.find(a => a.id === (preparation.artifactId ?? group?.artifactId));
      if (artifact && group && preparation.mode !== 'copper' && preparation.mode !== 'tin') {
        if (sharedArtifacts.has(artifact.id)) continue;
        sharedArtifacts.add(artifact.id);
        width = group.memberEnds.reduce((sum, e) => sum + Number(wireScenes.get(e.wireId)?.metadata?.drawingWidth ?? 0), 0) || width;
      }
      const placement = drawingEndArtworkPlacement(origin, adjacent, width);
      if (!placement) continue;
      if (preparation.mode === 'lug') {
        const symbol = artifact && getTerminationSymbol({ symbolId: artifact.symbolId, color: artifact.color }, 'drawing');
        if (!symbol) continue;
        const bounds = getTerminationArtworkBounds(symbol.assetId, 'drawing');
        if (!bounds) continue;
        const scale = width / terminalInletDiameter(symbol.assetId), rotation = placement.rotation + Math.PI;
        const p = { x: origin.x - scale * (32 * Math.cos(rotation) - 50 * Math.sin(rotation)), y: origin.y - scale * (32 * Math.sin(rotation) + 50 * Math.cos(rotation)) };
        artwork.push({ ...p, scale, rotation, mode: preparation.mode, wireId: wire.id, href: symbol.href, image: [0, 0, 220, 100], localBounds: bounds, conductorDiameter: width * .75 });
      } else {
        const bare = preparation.mode === 'copper' || preparation.mode === 'tin';
        const sealed = preparation.mode === 'pin-sealed' || preparation.mode === 'socket-sealed';
        artwork.push({ ...placement, mode: preparation.mode, wireId: wire.id, href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(renderPreparationSvg(preparation.mode, scene.color)), image: [0, -40, preparationArtworkWidth(preparation.mode), 80], localBounds: bare ? [157, -12, 223, 12] : [16, -32, sealed ? 291 : 233, 32], conductorDiameter: width * 17.1 / artworkWireDiameter });
      }
    }
    return artwork.length ? { ...object, terminationArtwork: artwork } : object;
  });
}
