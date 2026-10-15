import { describe, expect, it } from 'vitest';
import { designToScene } from './HarnessDesignEditor';
import { createEmptyHarnessDesign, parseHarnessDesignDocument, calculateWireCutLength } from './model';
import { applyEditorCommand, createWire } from './commands';
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from '../termination-library';
import { emptyTerminationDocument, type EndPreparationMode } from './termination-model';
import { terminationSceneBounds, terminationSceneContainsPoint } from './termination-scene';
import { objectsInPaintOrder, wireDrawingEndArtworkPlacement } from './CanvasViewport';
import { artworkWireDiameter, renderPreparationSvg } from '../wire-blank-artwork.mjs';
import { artworkWorldPoint } from './preparation-drawing';
import { emptyDrawingDocuments } from './drawing-documents';

function fixture(mode: EndPreparationMode = 'copper', scale = 1) {
  const { connector } = createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === 'preparation-none')!, { id: 'p', designation: 'P1', position: { x: 200, y: 200 } });
  const p = { ...connector, terminationComponent: { ...connector.terminationComponent!, preparationMode: mode } };
  const wire = { ...createWire('w', { connectorId: 'source', contactId: p.contacts[0]!.id }, { connectorId: 'p', contactId: p.contacts[0]!.id }, 350, '', '#334155'), drawingRoute: [{ x: 100, y: 250 }] };
  const document = { ...createEmptyHarnessDesign(), connectors: [p, { ...p, id: 'source', designation: 'P2', positions: { e4: { x: 0, y: 200 }, drawing: { x: 0, y: 200 } }, terminationComponent: { ...p.terminationComponent!, preparationMode: 'cut' as const } }], drawingDocuments: { ...emptyDrawingDocuments(), physicalScale: scale } };
  return applyEditorCommand(document, { type: 'add-wire', wire });
}

describe('P1 drawing end treatment', () => {
  it.each(['pin-sealed','socket-sealed'] as const)('keeps the complete %s rubber inside the SVG, canvas frame and selectable bounds', mode => {
    // The last rubber lip is x=679 with a 2-unit stroke, inside the
    // canonical translate(4 82.83) scale(.42) terminal group.
    const sealRight=4+(679+1)*.42;
    const svg=renderPreparationSvg(mode), viewBox=svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number);
    expect(viewBox[0]!+viewBox[2]!).toBeGreaterThanOrEqual(sealRight);
    const document=fixture(mode,8), before=JSON.stringify(document);
    const scene=designToScene(document,'drawing'), p=scene.find(o=>o.id==='p')!, art=p.terminationArtwork![0]!;
    expect(art.image[0]+art.image[2]).toBeGreaterThanOrEqual(sealRight);
    expect(art.localBounds[2]).toBeGreaterThanOrEqual(sealRight);
    expect(art.image[2]).toBe(viewBox[2]); // No stretching to compensate for clipping.
    const lip=artworkWorldPoint(art,{x:4+679*.42,y:0});
    expect(terminationSceneContainsPoint(p,lip,0)).toBe(true);
    const bounds=terminationSceneBounds(p)!;
    expect(lip.x).toBeGreaterThanOrEqual(bounds.minX); expect(lip.x).toBeLessThanOrEqual(bounds.maxX);
    expect(lip.y).toBeGreaterThanOrEqual(bounds.minY); expect(lip.y).toBeLessThanOrEqual(bounds.maxY);
    const wire=scene.find(o=>o.id==='w')!,anchor=artworkWorldPoint(art,{x:222,y:0});
    expect(art.scale*artworkWireDiameter).toBeCloseTo(Number(wire.metadata!.drawingWidth));
    expect(anchor.x).toBeCloseTo(wire.points!.at(-1)!.x);expect(anchor.y).toBeCloseTo(wire.points!.at(-1)!.y);
    expect(JSON.stringify(document)).toBe(before);
  });
  it.each([.2, .25, 1, 5, 8])('uses the same jacket diameter at drawing scale %s', scale => {
    const document = fixture('copper', scale), before = JSON.stringify(document);
    const scene = designToScene(document, 'drawing'), p = scene.find(o => o.id === 'p')!, wire = scene.find(o => o.id === 'w')!;
    const end = p.terminationArtwork![0]!;
    expect(end.scale * artworkWireDiameter).toBeCloseTo(Number(wire.metadata!.drawingWidth));
    expect(end.mode).toBe('copper');
    expect(end.conductorDiameter).toBeLessThanOrEqual(Number(wire.metadata!.drawingWidth));
    expect(JSON.stringify(document)).toBe(before);
    expect(calculateWireCutLength(document.wires[0]!)).toEqual(calculateWireCutLength(parseHarnessDesignDocument(JSON.parse(before)).wires[0]!));
    expect(designToScene(document, 'e4').find(o => o.id === 'p')!.terminationArtwork).toBeUndefined();
  });
  it.each(['cut', 'copper', 'tin', 'pin', 'socket', 'pin-sealed', 'socket-sealed'] as const)('follows the component mode %s and an individual override', mode => {
    const document = fixture(mode), scene = designToScene(document, 'drawing'), p = scene.find(o => o.id === 'p')!;
    expect(p.terminationArtwork?.map(a => a.mode) ?? []).toEqual(mode === 'cut' ? [] : [mode]);
    const overridden = { ...document, terminations: { ...emptyTerminationDocument(), endPreparations: [{ id: 'override', wireId: 'w', end: 'to' as const, mode: 'tin' as const }] } };
    expect(designToScene(overridden, 'drawing').find(o => o.id === 'p')!.terminationArtwork![0]!.mode).toBe('tin');
  });
  it('fits, selects and labels the visible decoration rather than only its point', () => {
    const p = designToScene(fixture('socket-sealed', 5), 'drawing').find(o => o.id === 'p')!, art = p.terminationArtwork![0]!;
    const tip = { x: art.x + Math.cos(art.rotation) * art.scale * 50, y: art.y + Math.sin(art.rotation) * art.scale * 50 };
    expect(terminationSceneContainsPoint(p, tip, 0)).toBe(true);
    const bounds = terminationSceneBounds(p)!;
    expect(tip.x).toBeGreaterThanOrEqual(bounds.minX); expect(tip.x).toBeLessThanOrEqual(bounds.maxX);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(30);
  });
  it('does not enlarge thin wires or shrink artwork on short first segments', () => {
    for (const width of [.125, 1, 2.5, 50]) {
      const placement = wireDrawingEndArtworkPlacement({ x: 0, y: 0 }, { x: .1, y: 0 }, width)!;
      expect(placement.scale * artworkWireDiameter).toBeCloseTo(width);
    }
  });
  it.each([0,30,90,180,-135])('keeps the jacket edge on the actual wire end at %s degrees', angle => {
    const document = fixture('pin');
    const prepared = { ...document, connectors: document.connectors.map(c => c.id === 'p' ? { ...c, drawingPlacements: [{ drawingId: 'view:drawing', visible: true, offset: { x: 0, y: 0 }, rotationDegrees: angle, scale: 2 }] } : c) };
    const scene = designToScene(prepared,'drawing'), wire = scene.find(o=>o.id==='w')!, art = scene.find(o=>o.id==='p')!.terminationArtwork![0]!;
    const anchor = artworkWorldPoint(art,{x:222,y:0});
    expect(anchor.x).toBeCloseTo(wire.points!.at(-1)!.x); expect(anchor.y).toBeCloseTo(wire.points!.at(-1)!.y);
    // The picture follows the final route direction, independently of the component's rotation.
    const previous=wire.points!.at(-2)!, end=wire.points!.at(-1)!;
    expect(art.rotation).toBeCloseTo(Math.atan2(previous.y-end.y,previous.x-end.x));
  });
  it('shows a chosen lug with its inlet on P1 and paints preparation above the wire', () => {
    const document = fixture('lug',4);
    const prepared = { ...document, terminations: { ...emptyTerminationDocument(), artifacts: [{ id: 'lug', kind: 'terminal' as const, article: 'test', symbolId: 'nki-ring' }] }, connectors: document.connectors.map(c=>c.id==='p'?{...c,terminationComponent:{...c.terminationComponent!,artifactId:'lug'}}:c) };
    const scene=designToScene(prepared,'drawing'), p=scene.find(o=>o.id==='p')!, wire=scene.find(o=>o.id==='w')!, art=p.terminationArtwork![0]!;
    expect(art.href).toContain('nki-ring-drawing');
    expect(art.scale*28).toBeCloseTo(Number(wire.metadata!.drawingWidth));
    const anchor=artworkWorldPoint(art,{x:32,y:50});
    expect(anchor.x).toBeCloseTo(wire.points!.at(-1)!.x); expect(anchor.y).toBeCloseTo(wire.points!.at(-1)!.y);
    const layers=document.views.drawing.layers.map(l=>({id:l.id,label:l.name,visible:l.visible,locked:l.locked}));
    const order=objectsInPaintOrder(scene,layers,'drawing');
    expect(order.indexOf(p)).toBeGreaterThan(order.indexOf(wire));
  });
  it('keeps pin/socket and sealing profiles distinct, with copper thinner than the jacket', () => {
    expect(renderPreparationSvg('pin')).toContain('data-profile="pin-contact"');
    expect(renderPreparationSvg('socket')).toContain('data-profile="socket-contact"');
    expect(renderPreparationSvg('pin')).not.toContain('three-rib-seal');
    expect(renderPreparationSvg('socket-sealed')).toContain('three-rib-seal');
    expect(renderPreparationSvg('copper')).toContain('M158 112H220V128H158Z');
    expect(17.1).toBeLessThan(artworkWireDiameter);
  });
  it('uses the physical route endpoint even with duplicate final stations', () => {
    const document=fixture('copper',2), prepared={...document,physicalTopology:{snap:false,nodes:[{id:'start',connectorId:'source',position:{x:32,y:50}},{id:'end',connectorId:'p',position:{x:32,y:50}}],segments:[{id:'pipe',from:'start',to:'end',path:{kind:'polyline' as const,points:[{x:100,y:350},{x:232,y:250}]}}],routes:[{wireId:'w',steps:[{segmentId:'pipe',reverse:false}]}]}};
    const before=JSON.stringify(prepared), scene=designToScene(prepared,'drawing'), wire=scene.find(o=>o.id==='w')!, art=scene.find(o=>o.id==='p')!.terminationArtwork![0]!;
    expect(wire.metadata?.physicalRoute).toBe('true');
    const anchor=artworkWorldPoint(art,{x:222,y:0});
    expect(anchor.x).toBeCloseTo(wire.points!.at(-1)!.x); expect(anchor.y).toBeCloseTo(wire.points!.at(-1)!.y);
    expect(art.scale*artworkWireDiameter).toBeCloseTo(Number(wire.metadata!.drawingWidth));
    expect(JSON.stringify(prepared)).toBe(before);
  });
  it('draws independent bare ends per wire and a common lug only once', () => {
    const document=fixture('copper',2), wires=[document.wires[0]!,{...document.wires[0]!,id:'w2',color:'#990000'}];
    const bare=designToScene({...document,wires},'drawing').find(o=>o.id==='p')!;
    expect(bare.terminationArtwork).toHaveLength(2);
    expect(bare.terminationArtwork!.map(a=>a.scale*artworkWireDiameter)).toEqual([5,5]);
    const shared={...document,wires,connectors:document.connectors.map(c=>c.id==='p'?{...c,terminationComponent:{...c.terminationComponent!,preparationMode:'lug' as const,artifactId:'lug'}}:c),terminations:{...emptyTerminationDocument(),artifacts:[{id:'lug',kind:'terminal' as const,article:'test',symbolId:'nki-ring'}],groups:[{id:'group',target:{connectorId:'p',contactId:document.connectors[0]!.contacts[0]!.id},artifactId:'lug',memberEnds:wires.map(w=>({wireId:w.id,end:'to' as const}))}]}};
    const p=designToScene(shared,'drawing').find(o=>o.id==='p')!;
    expect(p.terminationArtwork).toHaveLength(1); expect(p.terminationArtwork![0]!.scale*28).toBeCloseTo(10);
    expect(shared.terminations.artifacts).toHaveLength(1); expect(shared.wires.map(w=>w.lengthMm)).toEqual([350,350]);
  });
});
