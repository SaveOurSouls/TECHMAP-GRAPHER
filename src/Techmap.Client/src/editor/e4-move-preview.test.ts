import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewE4ConnectorMove } from './e4-move-preview';
import { createConnector, createWire, applyEditorCommand } from './commands';
import * as commands from './commands';
import * as router from './e4-router';
import { createEmptyHarnessDesign, createJunctionEndpoint, createScreenEndpoint, wireEndpointE4Anchor,
  wireE4PathContainsPoint, type HarnessDesignDocument } from './model';
import { e4ConnectivityFingerprint } from './e4-connectivity';
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from './history';
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from '../termination-library';

afterEach(() => vi.restoreAllMocks());

function fixture(): HarnessDesignDocument {
  const left = createConnector('a', 'X1', 4, { x: 0, y: 0 });
  const b = createConnector('b', 'X2', 4, { x: 1000, y: 0 });
  const right = { ...b, schematic: { ...b.schematic, orientation: 'contacts-left' as const } };
  const wire = { ...createWire('w', { connectorId: 'a', contactId: left.contacts[0]!.id },
    { connectorId: 'b', contactId: right.contacts[0]!.id }, 500),
    e4Route: [{ x: 700, y: 64 }, { x: 700, y: 200 }, { x: 900, y: 200 }, { x: 900, y: 64 }] };
  return { ...createEmptyHarnessDesign(), connectors: [left, right], wires: [wire] };
}

describe('E4 transient component movement', () => {
  it.each(['carry', 'adjacent'] as const)('preserves %s shoulders and commits once with undo/redo', mode => {
    const d = fixture(), snapshot = JSON.stringify(d), point = { x: 20, y: 30 };
    const history = createEditorHistory(d);
    const preview = previewE4ConnectorMove(d, 'a', point, mode);
    const committed = executeEditorCommand(history, { type: 'move-connector', connectorId: 'a', view: 'e4',
      position: point, physicalDragMode: mode });
    expect(preview.wires[0]!.e4Route).toEqual(committed.present.wires[0]!.e4Route);
    expect(preview.connectors[0]!.positions.drawing).toBe(d.connectors[0]!.positions.drawing);
    expect(preview.connectors[1]).toBe(d.connectors[1]);
    expect(preview.wires[0]!.from).toBe(d.wires[0]!.from);
    expect(preview.wires[0]!.to).toBe(d.wires[0]!.to);
    expect(preview.wires[0]!.lengthMm).toBe(500);
    expect(preview.physicalTopology).toBe(d.physicalTopology);
    expect(e4ConnectivityFingerprint(preview)).toBe(e4ConnectivityFingerprint(d));
    expect(JSON.stringify(d)).toBe(snapshot);
    expect(history.present).toBe(d); expect(history.past).toEqual([]);
    expect(committed.past).toEqual([d]);
    expect(undoEditorCommand(committed).present).toBe(d);
    expect(redoEditorCommand(undoEditorCommand(committed)).present).toBe(committed.present);
    expect(previewE4ConnectorMove(d, 'a', point, mode)).toEqual(preview);
  });

  it('runs no commands or route searches for any of 120 pointer frames, including an impossible placement', () => {
    const d = fixture();
    const command = vi.spyOn(commands, 'applyEditorCommand');
    const route = vi.spyOn(router, 'routeE4Wire');
    const waypoints = vi.spyOn(router, 'routeE4WireThroughWaypoints');
    for (let i = 0; i < 120; i++) {
      const point = { x: 900 + i, y: 10 + i };
      const preview = previewE4ConnectorMove(d, 'a', point);
      expect(preview.connectors[0]!.positions.e4).toEqual(point);
      expect(preview.wires).toHaveLength(d.wires.length);
    }
    expect(command).not.toHaveBeenCalled(); expect(route).not.toHaveBeenCalled();
    expect(waypoints).not.toHaveBeenCalled();
  });

  it.each(['carry', 'adjacent'] as const)('moves a carrier and its same-connector T branch coherently in %s', mode => {
    const base = fixture();
    const branch = createWire('branch', { connectorId: 'a', contactId: base.connectors[0]!.contacts[2]!.id },
      createJunctionEndpoint('j'), 120);
    const d = applyEditorCommand(base, { type: 'create-junction',
      junction: { id: 'j', position: { x: 700, y: 64 }, wireIds: ['w', 'branch'] }, branchWire: branch });
    const preview = previewE4ConnectorMove(d, 'a', { x: 20, y: 30 }, mode);
    for (const wire of preview.wires) expect(wireE4PathContainsPoint(preview, wire, preview.junctions[0]!.position)).toBe(true);
    expect(e4ConnectivityFingerprint(preview)).toBe(e4ConnectivityFingerprint(d));
  });

  it.each(['nvi-fork', 'sleeve-bare', 'preparation-none'])('keeps multiple wires on a moved %s port', assetId => {
    const d = fixture();
    const placement = createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === assetId)!,
      { id: 't', designation: 'T1', position: { x: 1000, y: 0 } });
    const base = { ...d, connectors: [...d.connectors, placement.connector], wires: [0, 1, 2, 3].map(i => ({
      ...d.wires[0]!, id: `w${i}`, to: { connectorId: 't', contactId: placement.connector.contacts[0]!.id },
    })) };
    const preview = previewE4ConnectorMove(base, 't', { x: 1100, y: 80 });
    for (const wire of preview.wires) {
      expect(wireEndpointE4Anchor(preview, wire.to)!.position).toEqual({ x: 1132, y: 130 });
      expect(wire.e4Route).not.toEqual(base.wires[0]!.e4Route);
    }
    expect(e4ConnectivityFingerprint(preview)).toBe(e4ConnectivityFingerprint(base));
  });

  it('updates a screen branch from the displayed screen port and keeps group identity', () => {
    const d = fixture();
    const second = { ...d.wires[0]!, id: 'w2', from: { connectorId: 'a', contactId: d.connectors[0]!.contacts[1]!.id },
      to: { connectorId: 'b', contactId: d.connectors[1]!.contacts[1]!.id },
      e4Route: [{ x: 700, y: 88 }, { x: 976, y: 88 }] };
    const base: HarnessDesignDocument = { ...d, wires: [{ ...d.wires[0]!, e4Route: [{ x: 700, y: 64 }, { x: 976, y: 64 }] }, second],
      screens: [{ id: 's', wireIds: ['w', 'w2'], position: .5, width: 12, label: 'S' }] };
    const branch = createWire('branch', createScreenEndpoint('s'), { connectorId: 'a', contactId: d.connectors[0]!.contacts[2]!.id });
    const withBranch = { ...base, wires: [...base.wires, branch] };
    const preview = previewE4ConnectorMove(withBranch, 'a', { x: 30, y: 40 });
    expect(preview.screens).toBe(base.screens);
    expect(wireEndpointE4Anchor(preview, branch.from)).not.toEqual(wireEndpointE4Anchor(withBranch, branch.from));
    expect(preview.wires[2]!.e4Route.length).toBeGreaterThan(0);
    expect(e4ConnectivityFingerprint(preview)).toBe(e4ConnectivityFingerprint(withBranch));
  });

  it('leaves the document unchanged for invalid, unknown or zero movement', () => {
    const d = fixture();
    expect(previewE4ConnectorMove(d, 'missing', { x: 10, y: 20 })).toBe(d);
    expect(previewE4ConnectorMove(d, 'a', { x: NaN, y: 20 })).toBe(d);
    expect(previewE4ConnectorMove(d, 'a', { x: 0, y: 0 })).toBe(d);
  });
});
