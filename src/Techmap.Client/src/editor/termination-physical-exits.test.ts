import { expect, it } from 'vitest';
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from '../termination-library';
import { createEmptyHarnessDesign, connectorContactPosition, parseHarnessDesignDocument, type HarnessDesignDocument } from './model';
import { applyEditorCommand, createConnector, createWire } from './commands';
import { ensureConnectorExits, physicalNodePoint, physicalNodeDirection } from './physical-topology';
import { emptyPhysicalTopology } from './physical-topology-model';

function fixture(assetId: string): HarnessDesignDocument {
  const placement = createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(record => record.assetId === assetId)!, { id: 't', designation: 'T1', position: { x: 100, y: 200 } });
  return applyEditorCommand(createEmptyHarnessDesign(), { type: 'add-termination-component', ...placement });
}

it.each(['nki-ring', 'nshvi-double', 'preparation-none', 'preparation-copper'])('creates the %s physical exit at its single conductor input without adding a contact', assetId => {
  const document = fixture(assetId), before = JSON.stringify(document), topology = ensureConnectorExits(document);
  const node = topology.nodes[0]!, connector = document.connectors[0]!;
  expect(node).toMatchObject({ connectorId: 't', position: { x: 32, y: 50 }, direction: 'left' });
  expect(physicalNodePoint(document, node)).toEqual(connectorContactPosition(connector, connector.contacts[0]!.id, 'drawing'));
  expect(connector.contacts).toHaveLength(1);
  expect(parseHarnessDesignDocument({ ...document, physicalTopology: topology }).connectors[0]!.contacts).toEqual(parseHarnessDesignDocument(document).connectors[0]!.contacts);
  expect(JSON.stringify(document)).toBe(before);
  expect(ensureConnectorExits({ ...document, physicalTopology: topology })).toBe(topology);
});

it.each(Array.from({ length: 25 }, (_, index) => -180 + index * 15).flatMap(angle => [.5, 1, 2].map(scale => [angle, scale])))('rotates/scales the new exit with its connector once (%s degrees, scale %s)', (angle, scale) => {
  const base = fixture('nki-ring'), connector = { ...base.connectors[0]!, drawingPlacements: [{ drawingId: 'view:drawing', visible: true, offset: { x: 0, y: 0 }, rotationDegrees: angle, scale }] };
  const document = { ...base, connectors: [connector] }, node = ensureConnectorExits(document).nodes[0]!;
  const point = physicalNodePoint(document, node), contact = connectorContactPosition(connector, connector.contacts[0]!.id, 'drawing')!;
  expect(point.x).toBeCloseTo(contact.x); expect(point.y).toBeCloseTo(contact.y);
  const direction = physicalNodeDirection(document, node)!;
  expect(direction.x).toBeCloseTo(-Math.cos(angle * Math.PI / 180)); expect(direction.y).toBeCloseTo(-Math.sin(angle * Math.PI / 180));
});

it('preserves every authored legacy exit and its routes instead of guessing a migration', () => {
  let document = fixture('nki-ring');
  const far = createConnector('far', 'X1', 1, { x: 800, y: 300 });
  document = applyEditorCommand(document, { type: 'add-connector', connector: far });
  document = applyEditorCommand(document, { type: 'add-wire', wire: createWire('w', { connectorId: 't', contactId: document.connectors[0]!.contacts[0]!.id }, { connectorId: 'far', contactId: far.contacts[0]!.id }, 123) });
  const topology = { ...emptyPhysicalTopology(), nodes: [{ id: 'legacy', connectorId: 't', position: { x: 170, y: 60 } }, { id: 'far-exit', connectorId: 'far', position: { x: 190, y: 90 } }], segments: [{ id: 'p', from: 'legacy', to: 'far-exit', path: { kind: 'polyline' as const, points: [{ x: 500, y: 260 }] } }], routes: [{ wireId: 'w', steps: [{ segmentId: 'p', reverse: false }] }] };
  const existing = { ...document, physicalTopology: topology }, before = JSON.stringify(existing);
  expect(ensureConnectorExits(existing)).toBe(topology);
  expect(JSON.stringify(existing)).toBe(before);
  const missing = { ...existing, connectors: [...existing.connectors, createConnector('new', 'X2', 1, { x: 1000, y: 100 })] }, next = ensureConnectorExits(missing);
  expect(next.nodes[0]).toBe(topology.nodes[0]); expect(next.nodes[1]).toBe(topology.nodes[1]);
  expect(next.segments).toBe(topology.segments); expect(next.routes).toBe(topology.routes); expect(missing.wires).toBe(document.wires);
});

it('preserves both electrical sleeve ports without manufacturing two unbound physical exits', () => {
  const document = fixture('sleeve-insulated'), connector = document.connectors[0]!, topology = ensureConnectorExits(document);
  expect(connector.contacts).toHaveLength(2);
  expect(topology.nodes).toHaveLength(1); expect(topology.nodes[0]!.position).toEqual({ x: 170, y: 60 });
  expect(connectorContactPosition(connector, connector.contacts[0]!.id, 'drawing')).toEqual({ x: 132, y: 250 });
  expect(connectorContactPosition(connector, connector.contacts[1]!.id, 'drawing')).toEqual({ x: 288, y: 250 });
  expect(ensureConnectorExits({ ...document, physicalTopology: topology })).toBe(topology);
});
