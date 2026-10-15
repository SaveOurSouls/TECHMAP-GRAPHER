import { expect, it } from 'vitest';
import type { EditorSceneObject } from './editor-types';
import { placementLayerError, placementOrigin, placementSceneObject } from './termination-placement-interaction';
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from '../termination-library';
import { applyEditorCommand, createConnector, createWire } from './commands';
import { connectorContactPosition, createEmptyHarnessDesign } from './model';

const scene: EditorSceneObject = { id: 'stable-terminal', kind: 'connector', layerId: 'connectors', label: 'T1', x: 100, y: 200, width: 220, height: 100, color: '#333', metadata: { terminationSymbol: 'symbol.svg', materializedContactPoints: JSON.stringify([{ x: 32, y: 50 }]) } };

it('allows placement only on its own visible unlocked layer', () => {
  expect(placementLayerError(scene, [{ id: 'connectors', label: 'Оконцовки', visible: true, locked: false }, { id: 'other', label: 'Другой', visible: false, locked: true }])).toBeNull();
});

it('accepts document layers with name as well as canvas layers with label', () => {
  expect(placementLayerError(scene, [{ id: 'connectors', name: 'Соединители Э4', visible: false, locked: false }])).toContain('«Соединители Э4»');
});

it('reports an absent target layer even when another editable layer exists', () => {
  expect(placementLayerError(scene, [{ id: 'other', label: 'Другой', visible: true, locked: false }])).toContain('отсутствует');
});

it.each([
  { visible: false, locked: false, message: 'Слой «Оконцовки» скрыт. Покажите слой перед размещением компонента.' },
  { visible: true, locked: true, message: 'Слой «Оконцовки» заблокирован. Разблокируйте слой перед размещением компонента.' },
])('reports the actionable placement error: $message', ({ visible, locked, message }) => {
  const layers = [{ id: 'connectors', label: 'Оконцовки', visible, locked }];
  const before = JSON.stringify({ scene, layers });
  expect(placementLayerError(scene, layers)).toBe(message);
  expect(JSON.stringify({ scene, layers })).toBe(before);
});

it('places the first contact at the cursor without translating it twice or changing source identity', () => {
  const before = JSON.stringify(scene), ghost = placementSceneObject(scene, { x: 400, y: 300 });
  expect(placementOrigin(scene, { x: 400, y: 300 })).toEqual({ x: 368, y: 250 });
  expect(ghost).toMatchObject({ id: 'stable-terminal', x: 368, y: 250 });
  expect(ghost.metadata).toBe(scene.metadata);
  expect(JSON.stringify(scene)).toBe(before);
});

it('uses the materialized rotated/scaled contact once for a drawing preparation', () => {
  const rotated = { ...scene, metadata: { ...scene.metadata, terminationRotation: '90', terminationScale: '2', materializedContactPoints: JSON.stringify([{ x: -100, y: 64 }]) } };
  expect(placementOrigin(rotated, { x: 400, y: 300 })).toEqual({ x: 500, y: 236 });
});

it('falls back to the transformed insertion point if a symbol has no preview contact list', () => {
  const rotated = { ...scene, metadata: { terminationSymbol: 'symbol.svg', terminationRotation: '90', terminationScale: '2' } };
  const origin = placementOrigin(rotated, { x: 400, y: 300 });
  expect(origin.x).toBeCloseTo(500); expect(origin.y).toBeCloseTo(236);
});

it.each(['e4','drawing'] as const)('moves an inserted preparation in %s while retaining contact/wire IDs, connections and prescribed lengths', view => {
  const placement = createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(record => record.assetId === 'preparation-none')!, { id: 'prep', designation: 'Р1', position: { x: 100, y: 200 } });
  const far = createConnector('far', 'X1', 1, { x: 700, y: 400 });
  let document = applyEditorCommand(createEmptyHarnessDesign(), { type: 'add-termination-component', ...placement });
  document = applyEditorCommand(document, { type: 'add-connector', connector: far });
  document = applyEditorCommand(document, { type: 'add-wire', wire: createWire('stable-wire', { connectorId: 'prep', contactId: placement.connector.contacts[0]!.id }, { connectorId: 'far', contactId: far.contacts[0]!.id }, 123) });
  const before = document.wires[0]!, from = { ...before.from }, to = { ...before.to };
  const moved = applyEditorCommand(document, { type: 'move-connector', connectorId: 'prep', view, position: { x: 200, y: 250 } });
  expect(moved.wires[0]).toMatchObject({ id: 'stable-wire', from, to, lengthMm: 123 });
  expect(moved.connectors[0]!.contacts.map(contact => contact.id)).toEqual(placement.connector.contacts.map(contact => contact.id));
  expect(connectorContactPosition(moved.connectors[0]!, from.contactId, view)).toEqual({ x: 232, y: 300 });
  expect(moved.connectors[0]!.positions[view === 'e4' ? 'drawing' : 'e4']).toEqual(document.connectors[0]!.positions[view === 'e4' ? 'drawing' : 'e4']);
});
