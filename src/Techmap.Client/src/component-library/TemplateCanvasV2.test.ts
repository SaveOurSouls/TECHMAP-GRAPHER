import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TemplateCanvasV2,
  createTemplateNumericEvaluatorV2,
  type TemplateCanvasV2Props,
} from "./TemplateCanvasV2";
import type {
  NumericExpressionV2,
  TemplateContentV2,
  TemplateNodeV2,
  TransformV2,
} from "./template-model-v2";

const ids = {
  view: "00000000-0000-4000-8000-000000000001",
  drawing: "00000000-0000-4000-8000-000000000002",
  layer: "00000000-0000-4000-8000-000000000003",
  hiddenLayer: "00000000-0000-4000-8000-000000000004",
  drawingLayer: "00000000-0000-4000-8000-000000000005",
  line: "00000000-0000-4000-8000-000000000006",
  hidden: "00000000-0000-4000-8000-000000000007",
  rectangle: "00000000-0000-4000-8000-000000000008",
  ellipse: "00000000-0000-4000-8000-000000000009",
  text: "00000000-0000-4000-8000-00000000000a",
  image: "00000000-0000-4000-8000-00000000000b",
  asset: "00000000-0000-4000-8000-00000000000c",
  parameter: "00000000-0000-4000-8000-00000000000d",
  formula: "00000000-0000-4000-8000-00000000000e",
  missingParameter: "00000000-0000-4000-8000-00000000000f",
  group: "00000000-0000-4000-8000-000000000010",
  child: "00000000-0000-4000-8000-000000000011",
  sibling: "00000000-0000-4000-8000-000000000012",
  contact: "00000000-0000-4000-8000-000000000013",
  point: "00000000-0000-4000-8000-000000000014",
} as const;

const c = (value: number): NumericExpressionV2 => ({ kind: "constant", value });
const p = (parameterId: string): NumericExpressionV2 => ({ kind: "parameter", parameterId });
const identity: TransformV2 = {
  translateX: c(0), translateY: c(0), rotationDegrees: c(0), scaleX: c(1), scaleY: c(1),
};

function node(partial: Partial<TemplateNodeV2> & Pick<TemplateNodeV2, "id" | "kind" | "geometry">): TemplateNodeV2 {
  return {
    layerId: ids.layer,
    visible: true,
    locked: false,
    opacity: 1,
    transform: identity,
    stroke: { color: "#123456", width: c(2) },
    fill: { color: null },
    ...partial,
  } as TemplateNodeV2;
}

function line(id: string, x = 0, visible = true): TemplateNodeV2 {
  return node({
    id,
    kind: "line",
    visible,
    geometry: { points: [{ x: c(x), y: c(10) }, { x: c(x + 20), y: c(10) }], bendRadius: c(0) },
  });
}

function content(nodes: TemplateNodeV2[]): TemplateContentV2 {
  return {
    schemaVersion: 2,
    views: [
      {
        id: ids.view,
        name: "Схема Э4",
        kind: "e4",
        layers: [
          { id: ids.layer, name: "Основной", visible: true, locked: false, nodes },
          { id: ids.hiddenLayer, name: "Скрытый", visible: false, locked: false, nodes: [{ ...line(ids.text), layerId: ids.hiddenLayer }] },
        ],
        contactPoints: [],
        bundlePorts: [],
        repeatPlacements: [],
      },
      {
        id: ids.drawing,
        name: "Чертёж",
        kind: "drawing",
        layers: [{ id: ids.drawingLayer, name: "Основной", visible: true, locked: false, nodes: [] }],
        contactPoints: [],
        bundlePorts: [],
        repeatPlacements: [],
      },
    ],
    logicalContacts: [],
    parameters: [
      { id: ids.parameter, name: "Размер", type: "number", unit: null, defaultValue: 25, minimum: null, maximum: null, formula: null },
      { id: ids.formula, name: "Удвоенный", type: "number", unit: null, defaultValue: 0, minimum: null, maximum: null, formula: { kind: "binary", operator: "multiply", left: p(ids.parameter), right: c(2) } },
    ],
    repeaters: [],
    assets: [{ assetId: ids.asset, fileName: "part.png", mediaType: "image/png", sha256: "a".repeat(64), sizeBytes: 100 }],
    articleParameterPresets: [],
  };
}

function render(document: TemplateContentV2, overrides: Partial<TemplateCanvasV2Props> = {}): string {
  return renderToStaticMarkup(createElement(TemplateCanvasV2, {
    content: document,
    viewId: ids.view,
    selectedId: null,
    onSelect: () => undefined,
    resolveAssetUrl: assetId => `/templates/7/assets/${assetId}/content`,
    ...overrides,
  }));
}

describe("TemplateCanvasV2", () => {
  it("renders visible layers and nodes in array order and preserves node opacity", () => {
    const first = line(ids.line, 10);
    first.opacity = 0.4;
    const hidden = line(ids.hidden, 20, false);
    const last = node({
      id: ids.ellipse,
      kind: "ellipse",
      geometry: { centerX: c(80), centerY: c(50), radiusX: c(12), radiusY: c(8) },
    });
    const markup = render(content([first, hidden, last]));

    expect(markup).toContain(`data-template-layer-id="${ids.layer}"`);
    expect(markup).not.toContain(ids.hiddenLayer);
    expect(markup).not.toContain(ids.hidden);
    expect(markup.indexOf(ids.line)).toBeLessThan(markup.indexOf(ids.ellipse));
    expect(markup).toContain(`data-template-node-id="${ids.line}"`);
    expect(markup).toContain('opacity="0.4"');
  });

  it("evaluates parameter defaults, formulas and explicit overrides without eval", () => {
    const document = content([]);
    const evaluateDefaults = createTemplateNumericEvaluatorV2(document);
    const evaluateOverrides = createTemplateNumericEvaluatorV2(document, { [ids.parameter]: 30 });

    expect(evaluateDefaults(p(ids.formula))).toBe(50);
    expect(evaluateOverrides(p(ids.formula))).toBe(60);
    expect(evaluateDefaults({ kind: "binary", operator: "divide", left: c(1), right: c(0) })).toBeNull();
  });

  it("renders parameterized base geometry when defaults resolve and uses a stable non-interactive placeholder otherwise", () => {
    const rectangle = node({
      id: ids.rectangle,
      kind: "rectangle",
      geometry: { x: c(10), y: c(20), width: p(ids.parameter), height: c(30), cornerRadii: [c(1), c(2), c(3), c(4)] },
    });
    const unresolved = node({
      id: ids.ellipse,
      kind: "ellipse",
      geometry: { centerX: c(30), centerY: c(30), radiusX: p(ids.missingParameter), radiusY: c(5) },
    });
    const first = render(content([rectangle, unresolved]), { parameterDefaults: { [ids.parameter]: 40 } });
    const second = render(content([rectangle, unresolved]), { parameterDefaults: { [ids.parameter]: 40 } });

    expect(first).toContain(`data-template-node-id="${ids.rectangle}"`);
    expect(first).toContain("H 48");
    expect(first).toContain(`data-template-node-id="${ids.ellipse}"`);
    expect(first).toContain('data-render="placeholder"');
    expect(first).toContain('pointer-events="none"');
    expect(first).toBe(second);
  });

  it("uses a placeholder when an advanced rounded polyline cannot yet be drawn exactly", () => {
    const rounded = node({
      id: ids.rectangle,
      kind: "polyline",
      geometry: {
        points: [{ x: c(10), y: c(10) }, { x: c(30), y: c(10) }, { x: c(30), y: c(30) }],
        bendRadius: c(5),
      },
    });
    const markup = render(content([rounded]));

    expect(markup).toContain(`data-template-node-id="${ids.rectangle}"`);
    expect(markup).toContain('data-render="placeholder"');
    expect(markup).not.toContain("<polyline");
  });

  it("renders an owned child exactly once inside its group at the group position", () => {
    const child = line(ids.child, 10);
    const sibling = line(ids.sibling, 40);
    const group = node({ id: ids.group, kind: "group", geometry: { childIds: [ids.child] } });
    const markup = render(content([child, sibling, group]));

    expect(markup.match(new RegExp(ids.child, "g"))).toHaveLength(1);
    expect(markup.indexOf(ids.sibling)).toBeLessThan(markup.indexOf(ids.group));
    expect(markup.indexOf(ids.group)).toBeLessThan(markup.indexOf(ids.child));
    expect(markup).toContain('data-template-group="true"');
  });

  it("renders versioned image URLs, normalized crop, transform and underlay metadata without reordering nodes", () => {
    const before = line(ids.line, 0);
    const image = node({
      id: ids.image,
      kind: "image",
      opacity: 0.65,
      transform: { translateX: c(5), translateY: c(6), rotationDegrees: c(15), scaleX: c(2), scaleY: c(3) },
      geometry: { assetId: ids.asset, x: c(10), y: c(20), width: c(100), height: c(80), cropX: 0.1, cropY: 0.2, cropWidth: 0.7, cropHeight: 0.6, underlay: true },
    });
    const resolver = vi.fn((assetId: string) => `/component-templates/template/versions/7/assets/${assetId}/content`);
    const markup = render(content([before, image]), { resolveAssetUrl: resolver });

    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith(ids.asset);
    expect(markup.indexOf(ids.line)).toBeLessThan(markup.indexOf(ids.image));
    expect(markup).toContain('data-underlay="true"');
    expect(markup).toContain('transform="translate(5 6) rotate(15) scale(2 3)"');
    expect(markup).toContain('viewBox="0.1 0.2 0.7 0.6"');
    expect(markup).toContain(`href="/component-templates/template/versions/7/assets/${ids.asset}/content"`);
    expect(markup).toContain('preserveAspectRatio="none"');
  });

  it("renders linked contact points after layers", () => {
    const document = content([line(ids.line)]);
    document.logicalContacts.push({ id: ids.contact, number: "X2", name: "Питание", contactType: "power" });
    document.views[0]!.contactPoints.push({ id: ids.point, logicalContactId: ids.contact, x: c(90), y: c(40), direction: "right" });
    const markup = render(document, { selectedId: ids.point });

    expect(markup.indexOf(ids.layer)).toBeLessThan(markup.indexOf(ids.point));
    expect(markup).toContain(`data-template-point-id="${ids.point}"`);
    expect(markup).toContain('data-selected="true"');
    expect(markup).toContain("X2");
    expect(markup).toContain("Питание · right");
  });
});
