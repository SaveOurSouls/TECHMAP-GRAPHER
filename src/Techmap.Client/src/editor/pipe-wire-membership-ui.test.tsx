import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PipeWireMembershipPanel } from './PipeWireMembershipPanel';
import { createConnector, createWire } from './commands';
import { createEmptyHarnessDesign } from './model';
import type { HarnessDesignDocument } from './model';
import type { PhysicalTopology } from './physical-topology-model';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
  },
}));

function fixture(): HarnessDesignDocument {
  const a = createConnector('a', 'X1', 2, { x: 0, y: 0 });
  const b = createConnector('b', 'T1', 1, { x: 500, y: 0 });
  const wires = a.contacts.map((contact, index) => createWire(`w${index}`, { connectorId: a.id, contactId: contact.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 350 + index));
  return { ...createEmptyHarnessDesign(), connectors: [a, b], wires,
    physicalTopology: { snap: false, nodes: [{ id: 'na', connectorId: a.id, position: { x: 170, y: 60 } }, { id: 'nb', connectorId: b.id, position: { x: 0, y: 60 } }],
      segments: [{ id: 'p1', from: 'na', to: 'nb', path: { kind: 'polyline', points: [] } }, { id: 'p2', from: 'na', to: 'nb', path: { kind: 'polyline', points: [{ x: 300, y: 200 }] } }],
      routes: [{ wireId: 'w0', steps: [{ segmentId: 'p1', reverse: false }], automatic: false }] } };
}

function find(node: any, match: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined;
  if (match(node)) return node;
  return [node.props?.children].flat(Infinity).map(child => find(child, match)).find(Boolean);
}
const button = (tree: any, text: string) => find(tree, node => node.type === 'button' && [node.props.children].flat().join('') === text);
const input = (tree: any, label: string) => find(tree, node => node.props?.['aria-label'] === label);
beforeEach(() => { hooks.states = []; hooks.index = 0; });

it('adds a selected late wire to the selected pipe without depending on which object is primary', () => {
  const document = fixture(), change = vi.fn((_topology: PhysicalTopology) => true);
  const tree = PipeWireMembershipPanel({ document, selectedIds: ['p1', 'w1'], onChange: change, onSelect: vi.fn() });
  const add = button(tree, 'Добавить выделенные провода (1)');
  expect(add.props.disabled).toBe(false); add.props.onClick();
  const topology = change.mock.calls[0]![0] as PhysicalTopology;
  expect(topology.routes.find(route => route.wireId === 'w1')!.steps).toEqual([{ segmentId: 'p1', reverse: false }]);
  expect(document.physicalTopology!.routes).toHaveLength(1);
  expect(document.wires[1]!.lengthMm).toBe(351);
});

it('selects one member, then transfers only that member to another pipe', () => {
  const document = fixture(), change = vi.fn((_topology: PhysicalTopology) => true), select = vi.fn();
  const render = () => { hooks.index = 0; return PipeWireMembershipPanel({ document, selectedIds: ['p1'], onChange: change, onSelect: select }); };
  input(render(), 'Выбрать W1 в составе П1').props.onChange({ target: { checked: true } });
  expect(select).toHaveBeenCalledWith('w0', true);
  input(render(), 'Перенести провода в пайп').props.onChange({ target: { value: 'p2' } });
  button(render(), 'Перенести в П').props.onClick();
  const topology = change.mock.calls[0]![0] as PhysicalTopology;
  expect(topology.routes.find(route => route.wireId === 'w0')!.steps).toEqual([{ segmentId: 'p2', reverse: false }]);
  expect(topology.segments[0]!.excludedWireIds).toEqual(['w0']);
});

it('disables composition changes when the wire layer is locked', () => {
  const base = fixture(), document = { ...base, views: { ...base.views, drawing: { ...base.views.drawing, layers: base.views.drawing.layers.map(layer => layer.id === 'wires' ? { ...layer, locked: true } : layer) } } };
  const tree = PipeWireMembershipPanel({ document, selectedIds: ['p1', 'w1'], onChange: vi.fn(), onSelect: vi.fn() });
  expect(button(tree, 'Добавить выделенные провода (1)').props.disabled).toBe(true);
  expect(renderToStaticMarkup(tree)).toContain('Разблокируйте слой проводов');
});
