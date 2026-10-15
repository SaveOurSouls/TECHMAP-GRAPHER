import { describe, expect, it } from 'vitest';
import { addPipeWires, movePipeWires, removePipeWires } from './physical-pipe-membership';
import { applyEditorCommand, createConnector, createWire } from './commands';
import { createEmptyHarnessDesign, parseHarnessDesignDocument, type HarnessDesignDocument } from './model';
import { createEditorHistory, executeEditorCommand, undoEditorCommand, redoEditorCommand } from './history';
import { parsePhysicalTopology } from './physical-topology-validation';
import { routePhysicalWires, refreshAutomaticPhysicalRoutes } from './physical-wire-routing';
import { splitPhysicalSegment, removePhysicalSegment } from './physical-topology';
import type { PhysicalNode, PhysicalSegment, PhysicalTopology } from './physical-topology-model';
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from '../termination-library';

const end = (connectorId: string, number = 1) => ({ connectorId, contactId: `${connectorId}:contact:${number}` });
const segment = (id: string, from: string, to: string, points: { x: number; y: number }[] = []): PhysicalSegment => ({ id, from, to, path: { kind: 'polyline', points } });
function fixture(): HarnessDesignDocument {
  const connectors = ['A', 'B', 'C'].map((id, i) => createConnector(id, id, 2, { x: i * 650, y: i * 450 }));
  const wires = [createWire('W1', end('A'), end('B'), 123), createWire('W2', end('A', 2), end('B', 2), 456)];
  const physicalTopology: PhysicalTopology = { snap: false,
    nodes: [{ id: 'NA', connectorId: 'A', position: { x: 170, y: 60 } }, { id: 'NB', connectorId: 'B', position: { x: 170, y: 60 } }],
    segments: [segment('P1', 'NA', 'NB'), segment('P2', 'NA', 'NB', [{ x: 400, y: 900 }])],
    routes: [{ wireId: 'W1', steps: [{ segmentId: 'P1', reverse: false }], automatic: false }, { wireId: 'W2', steps: [{ segmentId: 'P1', reverse: false }], automatic: true }],
  };
  let document: HarnessDesignDocument = { ...createEmptyHarnessDesign(), connectors, wires: [], physicalTopology: { ...physicalTopology, routes: [] } };
  for (const wire of wires) document = applyEditorCommand(document, { type: 'add-wire', wire });
  return parseHarnessDesignDocument({ ...document, physicalTopology });
}
const path = (topology: PhysicalTopology, wireId = 'W1') => topology.routes.find(route => route.wireId === wireId)?.steps.map(step => step.segmentId);

describe('explicit physical pipe membership', () => {
  it('pins a selected wire through a parallel pipe and preserves every unrelated route and electrical property', () => {
    const document = fixture(), before = JSON.stringify(document), other = document.physicalTopology!.routes.find(route => route.wireId === 'W2');
    const topology = addPipeWires(document, 'P2', ['W1']);
    expect(path(topology)).toEqual(['P2']); expect(topology.routes.find(route => route.wireId === 'W1')?.automatic).toBe(false);
    expect(topology.routes.find(route => route.wireId === 'W2')).toBe(other);
    expect(path(routePhysicalWires(document, topology))).toEqual(['P2']);
    expect(JSON.stringify(document)).toBe(before);
    expect(parseHarnessDesignDocument({ ...document, physicalTopology: topology }).wires).toEqual(document.wires);
  });

  it('routes a newly connected second E4 wire into an existing pipe without rebuilding the pipe', () => {
    const full = fixture(), before = { ...full, wires: [full.wires[0]!], physicalTopology: { ...full.physicalTopology!, routes: [full.physicalTopology!.routes[0]!] } };
    const added = applyEditorCommand(before, { type: 'add-wire', wire: full.wires[1]! });
    expect(path(added.physicalTopology!, 'W2')).toEqual(['P1']);
    const explicit = addPipeWires(added, 'P1', ['W2']);
    expect(explicit.routes.find(route => route.wireId === 'W2')?.automatic).toBe(false);
    expect(explicit.segments).toEqual(before.physicalTopology.segments);
  });

  it('adds a second wire on the same standalone terminal after its physical pipe already exists', () => {
    const placement = createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(record => record.assetId === 'nki-ring')!, { id: 'A', designation: 'T1', position: { x: 100, y: 100 } });
    const other = createConnector('B', 'X1', 2, { x: 800, y: 300 });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: 'add-termination-component', ...placement });
    document = applyEditorCommand(document, { type: 'add-connector', connector: other });
    document = applyEditorCommand(document, { type: 'add-wire', wire: createWire('first', end('A'), end('B'), 100) });
    document = applyEditorCommand(document, { type: 'set-physical-topology', topology: { snap: false, nodes: [{ id: 'NA', connectorId: 'A', position: { x: 32, y: 50 }, direction: 'left' }, { id: 'NB', connectorId: 'B', position: { x: 170, y: 60 } }], segments: [segment('existing', 'NA', 'NB')], routes: [{ wireId: 'first', steps: [{ segmentId: 'existing', reverse: false }], automatic: false }] } });
    document = applyEditorCommand(document, { type: 'add-wire', wire: createWire('second', end('A'), end('B', 2), 200) });
    expect(path(document.physicalTopology!, 'second')).toEqual(['existing']);
    const topology = addPipeWires(document, 'existing', ['second']);
    expect(topology.routes.filter(route => route.steps.some(step => step.segmentId === 'existing')).map(route => route.wireId).sort()).toEqual(['first', 'second']);
    expect(document.wires.map(wire => wire.from)).toEqual([end('A'), end('A')]);
    expect(document.wires.map(wire => wire.lengthMm)).toEqual([100, 200]);
  });

  it('uses reverse pipe orientation and removes only the selected target exclusion', () => {
    const base = fixture(), topology = removePipeWires(base, 'P2', ['W1', 'W2']);
    const document = { ...base, physicalTopology: { ...topology, segments: topology.segments.map(s => s.id === 'P2' ? { ...s, from: s.to, to: s.from } : s) } };
    const added = addPipeWires(document, 'P2', ['W1']);
    expect(added.routes.find(route => route.wireId === 'W1')!.steps).toEqual([{ segmentId: 'P2', reverse: true }]);
    expect(added.segments.find(s => s.id === 'P2')!.excludedWireIds).toEqual(['W2']);
  });

  it('persists removal, chooses an alternative, and does not reroute unrelated manual wires', () => {
    const initial = fixture(), document = { ...initial, physicalTopology: { ...initial.physicalTopology!, routes: initial.physicalTopology!.routes.map(route => ({ ...route, automatic: false })) } };
    const other = document.physicalTopology.routes[1]!, topology = removePipeWires(document, 'P1', ['W1']);
    expect(topology.segments[0]!.excludedWireIds).toEqual(['W1']); expect(path(topology)).toEqual(['P2']);
    expect(topology.routes.find(route => route.wireId === 'W1')?.automatic).toBe(true);
    expect(topology.routes.find(route => route.wireId === 'W2')).toBe(other);
    const reopened = parseHarnessDesignDocument(JSON.parse(JSON.stringify({ ...document, physicalTopology: topology })));
    expect(path(routePhysicalWires(reopened, reopened.physicalTopology!))).toEqual(['P2']);
  });

  it('keeps an excluded wire unrouted when no alternative exists, until an explicit add removes its exclusion', () => {
    const initial = fixture(), document = { ...initial, physicalTopology: { ...initial.physicalTopology!, segments: [initial.physicalTopology!.segments[0]!] } };
    const excluded = removePipeWires(document, 'P1', ['W1']);
    expect(path(excluded)).toBeUndefined(); expect(path(routePhysicalWires(document, excluded))).toBeUndefined();
    const restored = addPipeWires({ ...document, physicalTopology: excluded }, 'P1', ['W1']);
    expect(path(restored)).toEqual(['P1']); expect(restored.segments[0]!.excludedWireIds).toBeUndefined();
  });

  it('moves membership atomically and keeps source exclusion through a later refresh', () => {
    const document = fixture(), topology = movePipeWires(document, 'P1', 'P2', ['W1']);
    expect(topology.segments[0]!.excludedWireIds).toEqual(['W1']); expect(path(topology)).toEqual(['P2']);
    const moved = { ...document, physicalTopology: topology }, edited = { ...moved, connectors: moved.connectors.map((c, i) => i ? c : { ...c, positions: { ...c.positions, drawing: { x: 30, y: 20 } } }) };
    expect(path(refreshAutomaticPhysicalRoutes(moved, edited).physicalTopology!)).toEqual(['P2']);
    expect(document.wires.map(w => [w.id, w.from, w.to, w.lengthMm])).toEqual(moved.wires.map(w => [w.id, w.from, w.to, w.lengthMm]));
  });

  it('rejects a disconnected target or an atomic multiwire failure without changing its source document', () => {
    const initial = fixture(), document = { ...initial, physicalTopology: { ...initial.physicalTopology!, nodes: [...initial.physicalTopology!.nodes, { id: 'dead', position: { x: 500, y: 300 } }], segments: [...initial.physicalTopology!.segments, segment('dead-pipe', 'NA', 'dead')] } }, before = JSON.stringify(document);
    expect(() => movePipeWires(document, 'P1', 'dead-pipe', ['W1'])).toThrow('нет непрерывного пути');
    const impossible = { ...document, wires: document.wires.map(w => w.id === 'W2' ? { ...w, to: end('C') } : w) };
    expect(() => addPipeWires(impossible, 'P1', ['W1', 'W2'])).toThrow('нет непрерывного пути');
    expect(JSON.stringify(document)).toBe(before); expect(path(document.physicalTopology)).toEqual(['P1']);
  });

  it('finds two compatible legs together instead of losing a feasible route to a greedy first leg', () => {
    const base = fixture(), nodes: PhysicalNode[] = [
      { id: 'S', connectorId: 'A', position: { x: 0, y: 0 } }, { id: 'T', connectorId: 'B', position: { x: 0, y: 0 } },
      { id: 'u', position: { x: 100, y: 100 } }, { id: 'v', position: { x: 300, y: 100 } }, { id: 'x', position: { x: 200, y: 100 } }, { id: 'y', position: { x: -500, y: -500 } },
    ];
    const document = { ...base, physicalTopology: { snap: false, nodes, routes: [], segments: [segment('required', 'u', 'v'), segment('ux', 'u', 'x'), segment('xs', 'x', 'S'), segment('vx', 'v', 'x'), segment('xt', 'x', 'T'), segment('uy', 'u', 'y'), segment('ys', 'y', 'S')] } };
    const topology = addPipeWires(document, 'required', ['W1']), steps = path(topology)!;
    expect(steps).toContain('required'); expect(steps).toContain('uy'); expect(steps).toContain('vx'); expect(new Set(steps).size).toBe(steps.length);
    expect(() => parsePhysicalTopology(topology, document)).not.toThrow();
  });

  it('respects restricted source exits and explicit transit permission through an unrelated connector', () => {
    const base = fixture(), restricted = { ...base, physicalTopology: { ...base.physicalTopology!, nodes: base.physicalTopology!.nodes.map(node => node.id === 'NA' ? { ...node, wireIds: ['W2'] } : node), routes: [] } };
    expect(() => addPipeWires(restricted, 'P1', ['W1'])).toThrow('допуск провода');
    const c: PhysicalNode = { id: 'NC', connectorId: 'C', position: { x: 0, y: 0 } };
    const transit = { ...base, physicalTopology: { ...base.physicalTopology!, nodes: [...base.physicalTopology!.nodes, c], segments: [segment('AC', 'NA', 'NC'), segment('CB', 'NC', 'NB')], routes: [] } };
    expect(() => addPipeWires(transit, 'AC', ['W1'])).toThrow('нет непрерывного пути');
    const allowed = { ...transit, physicalTopology: { ...transit.physicalTopology, nodes: transit.physicalTopology.nodes.map(node => node.id === 'NC' ? { ...node, transitWireIds: ['W1'] } : node) } };
    expect(path(addPipeWires(allowed, 'AC', ['W1']))).toEqual(['AC', 'CB']);
  });

  it('keeps one history entry, JSON persistence and Undo/Redo for a complete move', () => {
    const document = fixture(), history = createEditorHistory(document), topology = movePipeWires(document, 'P1', 'P2', ['W1']);
    const moved = executeEditorCommand(history, { type: 'set-physical-topology', topology });
    expect(path(moved.present.physicalTopology!)).toEqual(['P2']);
    expect(undoEditorCommand(moved).present).toEqual(document);
    expect(redoEditorCommand(undoEditorCommand(moved)).present).toEqual(moved.present);
    const reopened = parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved.present)));
    expect(reopened.physicalTopology!.segments[0]!.excludedWireIds).toEqual(['W1']); expect(path(reopened.physicalTopology!)).toEqual(['P2']);
  });

  it.each(['wires', 'custom'])('rejects locked drawing layer %s', id => {
    const base = fixture(), document = { ...base, views: { ...base.views, drawing: { ...base.views.drawing, layers: [...base.views.drawing.layers.map(layer => layer.id === id ? { ...layer, locked: true } : layer), ...(id === 'custom' ? [{ id: 'custom', name: 'Особые провода', visible: true, locked: true, order: 50 }] : [])] } }, wires: base.wires.map(w => id === 'custom' ? { ...w, layerIds: { ...w.layerIds, drawing: 'custom' } } : w) };
    expect(() => addPipeWires(document, 'P1', ['W1'])).toThrow('заблокирован');
    expect(() => removePipeWires(document, 'P1', ['W1'])).toThrow('заблокирован');
    expect(() => movePipeWires(document, 'P1', 'P2', ['W1'])).toThrow('заблокирован');
  });

  it('validates exclusions and rejects routes that contradict them', () => {
    const document = fixture(), t = document.physicalTopology!;
    for (const excludedWireIds of [['missing'], ['W1', 'W1'], null, 'W1']) expect(() => parsePhysicalTopology({ ...t, segments: t.segments.map(s => ({ ...s, excludedWireIds })) }, document)).toThrow();
    expect(() => parsePhysicalTopology({ ...t, segments: t.segments.map(s => ({ ...s, excludedWireIds: ['W1'] })) }, document)).toThrow();
    expect(parsePhysicalTopology({ ...t, segments: t.segments.map(s => ({ ...s, excludedWireIds: [] })) }, document)).toBeDefined();
  });

  it('carries exclusions into both split fragments and prunes deleted wire IDs', () => {
    const initial = fixture(), topology = removePipeWires(initial, 'P2', ['W2']), document = { ...initial, physicalTopology: topology };
    const split = splitPhysicalSegment(document, 'P2', 1, 'junction', 'continuation');
    expect(split.segments.find(s => s.id === 'P2')!.excludedWireIds).toEqual(['W2']); expect(split.segments.find(s => s.id === 'continuation')!.excludedWireIds).toEqual(['W2']);
    expect(() => parsePhysicalTopology(split, document)).not.toThrow();
    const removed = applyEditorCommand(document, { type: 'remove-wire', wireId: 'W2' });
    expect(removed.physicalTopology!.segments.every(s => !s.excludedWireIds?.includes('W2'))).toBe(true);
    expect(() => parseHarnessDesignDocument(removed)).not.toThrow();
    const deleted = removePhysicalSegment(document, 'P2'); expect(deleted.segments.some(s => s.id === 'P2')).toBe(false);
  });
});
