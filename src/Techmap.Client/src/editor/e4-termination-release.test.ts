import { afterEach, expect, it, vi } from 'vitest';
import { applyEditorCommand, createConnector, createWire, e4RoutingIssues } from './commands';
import { createEmptyHarnessDesign, parseHarnessDesignDocument, wireEndpointE4Anchor, type HarnessDesignDocument } from './model';
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from './history';
import { e4ConnectivityFingerprint } from './e4-connectivity';
import { previewE4ConnectorMove } from './e4-move-preview';
import { emptyTerminationDocument } from './termination-model';
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from '../termination-library';
import * as router from './e4-router';

afterEach(() => vi.restoreAllMocks());

function fixture(assetId = 'nvi-fork', shared = false): HarnessDesignDocument {
  const a = createConnector('a', 'XS5', 13, { x: 0, y: 0 });
  const { connector: terminal, artifact } = createTerminationPlacement(
    BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === assetId)!,
    { id: 't', designation: 'T1', position: { x: 1100, y: 450 } });
  const wires = [7, ...(shared ? [13] : [])].map((n, i) => ({
    ...createWire(`w${i}`, { connectorId: a.id, contactId: a.contacts[n - 1]!.id },
      { connectorId: terminal.id, contactId: terminal.contacts[0]!.id }, 700, 'NET'),
    e4Route: i === 0 ? [{ x: 780, y: 208 }, { x: 780, y: 500 }]
      : [{ x: 980, y: 352 }, { x: 980, y: 548 }, { x: 1084, y: 548 }, { x: 1084, y: 500 }],
  }));
  const p = createConnector('p', 'XS1', 2, { x: 0, y: 700 });
  const q = createConnector('q', 'XS2', 2, { x: 1200, y: 700 });
  return parseHarnessDesignDocument({ ...createEmptyHarnessDesign(),
    connectors: [a, terminal, p, { ...q, schematic: { ...q.schematic, orientation: 'contacts-left' } }],
    wires: [...wires, ...[0, 1].map(i => ({
      ...createWire(`pair${i}`, { connectorId: p.id, contactId: p.contacts[i]!.id },
        { connectorId: q.id, contactId: q.contacts[i]!.id }, 500),
      e4Route: [{ x: 700 + i * 24, y: 764 + i * 24 }, { x: 950 + i * 24, y: 764 + i * 24 }],
    }))],
    diffPairs: [{ id: 'pair', wireIds: ['pair0', 'pair1'], step: 24, amplitude: 6, variant: 2 }],
    ...(artifact ? { terminations: { ...emptyTerminationDocument(), artifacts: [artifact] } } : {}),
  });
}

for (const mode of ['carry', 'adjacent'] as const) {
  it.each(['nvi-fork', 'sleeve-bare', 'preparation-none'])(
    `commits %s in ${mode} without route search or changing a distant automatic pair`, assetId => {
      const d = fixture(assetId), position = { x: 1115, y: 462 };
      expect(e4RoutingIssues(d)).toEqual([]);
      const route = vi.spyOn(router, 'routeE4Wire'), waypoints = vi.spyOn(router, 'routeE4WireThroughWaypoints');
      const history = executeEditorCommand(createEditorHistory(d), {
        type: 'move-connector', connectorId: 't', view: 'e4', position, physicalDragMode: mode,
      });
      const moved = history.present;
      expect(e4RoutingIssues(moved)).toEqual([]);
      expect(moved.wires[0]!.e4Route).toEqual(previewE4ConnectorMove(d, 't', position, mode).wires[0]!.e4Route);
      expect(moved.wires[0]!.e4RouteMode).toBe('auto');
      expect(moved.wires.slice(1)).toEqual(d.wires.slice(1));
      expect(moved.diffPairs).toBe(d.diffPairs);
      expect(route).not.toHaveBeenCalled(); expect(waypoints).not.toHaveBeenCalled();
      expect(e4ConnectivityFingerprint(moved)).toBe(e4ConnectivityFingerprint(d));
      expect(moved.wires.map(w => [w.id, w.from, w.to, w.lengthMm])).toEqual(d.wires.map(w => [w.id, w.from, w.to, w.lengthMm]));
      expect(moved.physicalTopology).toEqual(d.physicalTopology);
      expect(moved.connectors[1]!.positions.drawing).toEqual(d.connectors[1]!.positions.drawing);
      expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved))).wires).toEqual(moved.wires);
      expect(undoEditorCommand(history).present).toBe(d);
      expect(redoEditorCommand(undoEditorCommand(history)).present).toBe(moved);
    });

  it.each(['auto', 'manual'] as const)(`keeps shared contact routes valid and %s in ${mode}`, routeMode => {
    const base = fixture('nvi-fork', true);
    const d = { ...base, wires: base.wires.map(w => ({ ...w, e4RouteMode: routeMode })) };
    expect(e4RoutingIssues(d)).toEqual([]);
    const moved = applyEditorCommand(d, { type: 'move-connector', connectorId: 't', view: 'e4',
      position: { x: 1130, y: 490 }, physicalDragMode: mode });
    expect(e4RoutingIssues(moved)).toEqual([]);
    expect(moved.wires.slice(2)).toEqual(d.wires.slice(2));
    for (const w of moved.wires.slice(0, 2)) {
      expect(wireEndpointE4Anchor(moved, w.to)!.position).toEqual({ x: 1162, y: 540 });
      expect(w.e4RouteMode).toBe(routeMode);
    }
    expect(e4ConnectivityFingerprint(moved)).toBe(e4ConnectivityFingerprint(d));
  });
}

it('reroutes only the wire newly obstructed by an unconnected termination', () => {
  const base = fixture();
  const d = { ...base, wires: base.wires.slice(1, 2), diffPairs: [] };
  expect(e4RoutingIssues(d)).toEqual([]);
  const route = vi.spyOn(router, 'routeE4Wire');
  const moved = applyEditorCommand(d, { type: 'move-connector', connectorId: 't', view: 'e4',
    position: { x: 780, y: 720 }, physicalDragMode: 'carry' });
  expect(route).toHaveBeenCalled();
  expect(moved.wires[0]!.e4Route).not.toEqual(d.wires[0]!.e4Route);
  expect(e4RoutingIssues(moved)).toEqual([]);
  expect(e4ConnectivityFingerprint(moved)).toBe(e4ConnectivityFingerprint(d));
});

it.each(['carry', 'adjacent'] as const)('keeps the right sleeve port attached in %s', mode => {
  const base = fixture('sleeve-bare'), terminal = base.connectors[1]!;
  const source = { ...base.connectors[0]!, positions: { ...base.connectors[0]!.positions, e4: { x: 1700, y: 450 } },
    schematic: { ...base.connectors[0]!.schematic, orientation: 'contacts-left' as const } };
  const wire = { ...base.wires[0]!, from: { connectorId: source.id, contactId: source.contacts[0]!.id },
    to: { connectorId: terminal.id, contactId: terminal.contacts[1]!.id },
    e4Route: [{ x: 1500, y: 514 }, { x: 1500, y: 500 }] };
  const d = { ...base, connectors: [source, ...base.connectors.slice(1)], wires: [wire, ...base.wires.slice(1)] };
  expect(e4RoutingIssues(d)).toEqual([]);
  const moved = applyEditorCommand(d, { type: 'move-connector', connectorId: 't', view: 'e4',
    position: { x: 1115, y: 462 }, physicalDragMode: mode });
  expect(e4RoutingIssues(moved)).toEqual([]);
  expect(e4ConnectivityFingerprint(moved)).toBe(e4ConnectivityFingerprint(d));
  expect(moved.wires.slice(1)).toEqual(d.wires.slice(1));
});

it.each(['carry', 'adjacent'] as const)('validates angular termination movement in %s before committing', mode => {
  const base = fixture();
  const d = { ...base, views: { ...base.views, e4: { ...base.views.e4, e4RoutingMode: 'angular' as const } } };
  const moved = applyEditorCommand(d, { type: 'move-connector', connectorId: 't', view: 'e4',
    position: { x: 1115, y: 462 }, physicalDragMode: mode });
  expect(e4RoutingIssues(moved)).toEqual([]);
  expect(e4ConnectivityFingerprint(moved)).toBe(e4ConnectivityFingerprint(d));
  expect(moved.wires.slice(1)).toEqual(d.wires.slice(1));
});

it.each(['attached', 'obstructed'] as const)('does not bypass the locked %s wire layer', kind => {
  const base = fixture();
  const d = { ...base, wires: kind === 'attached' ? base.wires : base.wires.slice(1, 2), diffPairs: [],
    views: { ...base.views, e4: { ...base.views.e4, layers: base.views.e4.layers.map(l =>
      l.id === base.wires[0]!.layerIds.e4 ? { ...l, locked: true } : l) } } };
  const snapshot = JSON.stringify(d);
  expect(() => applyEditorCommand(d, { type: 'move-connector', connectorId: 't', view: 'e4',
    position: kind === 'attached' ? { x: 1115, y: 462 } : { x: 780, y: 720 }, physicalDragMode: 'carry' })).toThrow(/заблокирован/);
  expect(JSON.stringify(d)).toBe(snapshot);
});
