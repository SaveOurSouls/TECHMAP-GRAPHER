import { describe, expect, it } from "vitest";
import {
  addBasicNodeV2, addContactPointV2, addLayerV2, addNodeV2, constantExpressionV2,
  deleteContactPointV2, deleteLayerV2, deleteNodeV2, editContactPointV2, editLogicalContactV2,
  editNodeV2, evaluateNumericExpressionV2, moveNodeV2, newTemplateContentV2, renameLayerV2,
  reorderLayerV2, reorderNodeV2, setLayerLockedV2, setLayerVisibleV2, setNodeLockedV2,
  TemplateCommandV2Error,
} from "./template-commands-v2";
import { validateTemplateContentV2, type RectangleNodeV2 } from "./template-model-v2";

describe("template v2 immutable commands", () => {
  it("creates stable UUIDs, mandatory views and one Main layer in each", () => {
    const content = newTemplateContentV2();
    const ids = content.views.flatMap(view => [view.id, ...view.layers.map(layer => layer.id)]);

    expect(content.views.map(view => view.kind)).toEqual(["e4", "drawing"]);
    expect(content.views.map(view => view.layers.map(layer => layer.name))).toEqual([["Основной"], ["Основной"]]);
    expect(new Set(ids).size).toBe(4);
    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))).toBe(true);
    expect(validateTemplateContentV2(content).valid).toBe(true);
  });

  it("adds, renames, reorders, toggles and deletes layers without mutating input", () => {
    const initial = newTemplateContentV2(), view = initial.views[0]!, original = structuredClone(initial);
    const [added, secondId] = addLayerV2(initial, view.id, "Служебный");
    const renamed = renameLayerV2(added, view.id, secondId, "Контакты");
    const reordered = reorderLayerV2(renamed, view.id, secondId, 0);
    const hidden = setLayerVisibleV2(reordered, view.id, secondId, false);
    const locked = setLayerLockedV2(hidden, view.id, secondId, true);

    expect(initial).toEqual(original);
    expect(locked.views[0]!.layers[0]).toMatchObject({ id: secondId, name: "Контакты", visible: false, locked: true });
    expect(() => renameLayerV2(locked, view.id, secondId, "X")).toThrowError(TemplateCommandV2Error);
    const unlocked = setLayerLockedV2(locked, view.id, secondId, false);
    expect(deleteLayerV2(unlocked, view.id, secondId).views[0]!.layers).toHaveLength(1);
    expect(() => deleteLayerV2(initial, view.id, view.layers[0]!.id)).toThrowError(expect.objectContaining({ code: "last_layer" }));
  });

  it("adds, moves, edits, reorders and deletes basic nodes while respecting locks", () => {
    const initial = newTemplateContentV2(), view = initial.views[0]!, layer = view.layers[0]!;
    const [withRectangle, rectangleId] = addBasicNodeV2(initial, view.id, layer.id, "rectangle");
    const [withText, textId] = addBasicNodeV2(withRectangle, view.id, layer.id, "text");
    const moved = moveNodeV2(withText, view.id, layer.id, rectangleId, 25, -5);
    const edited = editNodeV2(moved, view.id, layer.id, rectangleId, { opacity: 0.4 });
    const reordered = reorderNodeV2(edited, view.id, layer.id, textId, 0);
    const rectangle = reordered.views[0]!.layers[0]!.nodes[1] as RectangleNodeV2;

    expect((rectangle.geometry.x as { value: number }).value).toBe(100);
    expect((rectangle.geometry.y as { value: number }).value).toBe(100);
    expect((rectangle.transform.translateX as { value: number }).value).toBe(25);
    expect((rectangle.transform.translateY as { value: number }).value).toBe(-5);
    expect(rectangle.opacity).toBe(0.4);
    expect(initial.views[0]!.layers[0]!.nodes).toEqual([]);

    const nodeLocked = setNodeLockedV2(reordered, view.id, layer.id, rectangleId, true);
    expect(() => moveNodeV2(nodeLocked, view.id, layer.id, rectangleId, 1, 1)).toThrowError(expect.objectContaining({ code: "node_locked" }));
    const nodeUnlocked = setNodeLockedV2(nodeLocked, view.id, layer.id, rectangleId, false);
    const layerLocked = setLayerLockedV2(nodeUnlocked, view.id, layer.id, true);
    expect(() => deleteNodeV2(layerLocked, view.id, layer.id, rectangleId)).toThrowError(expect.objectContaining({ code: "layer_locked" }));
    const final = deleteNodeV2(setLayerLockedV2(layerLocked, view.id, layer.id, false), view.id, layer.id, rectangleId);
    expect(final.views[0]!.layers[0]!.nodes.map(node => node.id)).toEqual([textId]);
  });

  it("preserves parameterized geometry and moves the node through its constant transform", () => {
    const initial = newTemplateContentV2(), view = initial.views[0]!, layer = view.layers[0]!;
    const parameterId = crypto.randomUUID();
    const content = { ...initial, parameters: [{
      id: parameterId, name: "X", type: "number" as const, unit: "px", defaultValue: 20,
      minimum: 0, maximum: 100, formula: null,
    }] };
    const advanced: RectangleNodeV2 = {
      id: crypto.randomUUID(), kind: "rectangle", layerId: layer.id, visible: true, locked: false, opacity: 1,
      transform: { translateX: constantExpressionV2(0), translateY: constantExpressionV2(0), rotationDegrees: constantExpressionV2(0), scaleX: constantExpressionV2(1), scaleY: constantExpressionV2(1) },
      stroke: { color: "#123456", width: constantExpressionV2(2) }, fill: { color: null },
      geometry: {
        x: { kind: "parameter", parameterId }, y: constantExpressionV2(10), width: constantExpressionV2(30), height: constantExpressionV2(40),
        cornerRadii: [constantExpressionV2(1), constantExpressionV2(2), constantExpressionV2(3), constantExpressionV2(4)],
      },
    };
    const withAdvanced = addNodeV2(content, view.id, layer.id, advanced);
    const before = JSON.stringify(withAdvanced.views[0]!.layers[0]!.nodes[0]);

    const moved = moveNodeV2(withAdvanced, view.id, layer.id, advanced.id, 5, 5);
    expect((moved.views[0]!.layers[0]!.nodes[0]!.transform.translateX as { value: number }).value).toBe(5);
    expect((moved.views[0]!.layers[0]!.nodes[0]!.transform.translateY as { value: number }).value).toBe(5);
    expect((moved.views[0]!.layers[0]!.nodes[0] as RectangleNodeV2).geometry.x).toEqual({ kind: "parameter", parameterId });
    const edited = editNodeV2(withAdvanced, view.id, layer.id, advanced.id, { visible: false });
    expect(JSON.stringify({ ...edited.views[0]!.layers[0]!.nodes[0], visible: true })).toBe(before);
  });

  it("moves a rotated and scaled primitive in canvas coordinates without changing its local geometry", () => {
    const initial = newTemplateContentV2(), view = initial.views[0]!, layer = view.layers[0]!;
    const [created, nodeId] = addBasicNodeV2(initial, view.id, layer.id, "rectangle");
    const rectangle = created.views[0]!.layers[0]!.nodes[0] as RectangleNodeV2;
    const transformed = editNodeV2(created, view.id, layer.id, nodeId, { transform: {
      ...rectangle.transform,
      translateX: constantExpressionV2(7), translateY: constantExpressionV2(9),
      rotationDegrees: constantExpressionV2(30), scaleX: constantExpressionV2(2), scaleY: constantExpressionV2(3),
    } });
    const moved = moveNodeV2(transformed, view.id, layer.id, nodeId, 11, -4);
    const result = moved.views[0]!.layers[0]!.nodes[0] as RectangleNodeV2;

    expect(result.geometry).toEqual(rectangle.geometry);
    expect(result.transform).toMatchObject({
      translateX: { kind: "constant", value: 18 }, translateY: { kind: "constant", value: 5 },
      rotationDegrees: { kind: "constant", value: 30 }, scaleX: { kind: "constant", value: 2 }, scaleY: { kind: "constant", value: 3 },
    });
  });

  it("creates a logical contact and its point in the selected view with the first free number", () => {
    const initial = newTemplateContentV2(), e4 = initial.views[0]!, drawing = initial.views[1]!;
    const [first, firstPointId] = addContactPointV2(initial, e4.id);
    const [second, secondPointId] = addContactPointV2(first, drawing.id, {
      number: "3", name: "Силовой", contactType: "power",
      x: constantExpressionV2(40), y: constantExpressionV2(70), direction: "left",
    });
    const [third] = addContactPointV2(second, e4.id);

    expect(initial.logicalContacts).toEqual([]);
    expect(initial.views.every(view => view.contactPoints.length === 0)).toBe(true);
    expect(second.logicalContacts[1]).toMatchObject({ number: "3", name: "Силовой", contactType: "power" });
    expect(second.views[1]!.contactPoints[0]).toMatchObject({ id: secondPointId, direction: "left" });
    expect((second.views[1]!.contactPoints[0]!.x as { value: number }).value).toBe(40);
    expect(first.views[0]!.contactPoints[0]!.id).toBe(firstPointId);
    expect(third.logicalContacts.map(contact => contact.number)).toEqual(["1", "3", "2"]);
    expect(validateTemplateContentV2(third).valid).toBe(true);
  });

  it("edits shared logical properties separately from view point geometry", () => {
    const initial = newTemplateContentV2(), view = initial.views[0]!;
    const [created, pointId] = addContactPointV2(initial, view.id);
    const logicalId = created.views[0]!.contactPoints[0]!.logicalContactId;
    const logicalEdited = editLogicalContactV2(created, logicalId, { number: "A1", name: "Экран", contactType: "shield" });
    const pointEdited = editContactPointV2(logicalEdited, view.id, pointId, {
      x: constantExpressionV2(310), y: constantExpressionV2(90), direction: "up",
    });

    expect(created.logicalContacts[0]).toMatchObject({ number: "1", name: "Контакт 1", contactType: "" });
    expect(pointEdited.logicalContacts[0]).toMatchObject({ number: "A1", name: "Экран", contactType: "shield" });
    expect(pointEdited.views[0]!.contactPoints[0]).toMatchObject({ id: pointId, direction: "up" });
    expect((pointEdited.views[0]!.contactPoints[0]!.x as { value: number }).value).toBe(310);
    expect(validateTemplateContentV2(pointEdited).valid).toBe(true);
  });

  it("rejects duplicate contact numbers and removes an unreferenced logical contact with its point", () => {
    const initial = newTemplateContentV2(), view = initial.views[0]!;
    const [withFirst, firstPointId] = addContactPointV2(initial, view.id, { number: "X1" });
    const [withSecond] = addContactPointV2(withFirst, view.id, { number: "X2" });
    const secondLogicalId = withSecond.logicalContacts[1]!.id;

    expect(() => addContactPointV2(withSecond, view.id, { number: " X1 " }))
      .toThrowError(expect.objectContaining({ code: "duplicate_contact_number" }));
    expect(() => editLogicalContactV2(withSecond, secondLogicalId, { number: "X1" }))
      .toThrowError(expect.objectContaining({ code: "duplicate_contact_number" }));

    const removed = deleteContactPointV2(withSecond, view.id, firstPointId);
    expect(removed.views[0]!.contactPoints).toHaveLength(1);
    expect(removed.logicalContacts.map(contact => contact.number)).toEqual(["X2"]);
    expect(withSecond.views[0]!.contactPoints).toHaveLength(2);
    expect(validateTemplateContentV2(removed).valid).toBe(true);
  });

  it("keeps a logical contact while another view still contains its point", () => {
    const initial = newTemplateContentV2(), e4 = initial.views[0]!, drawing = initial.views[1]!;
    const [created, e4PointId] = addContactPointV2(initial, e4.id);
    const logicalId = created.logicalContacts[0]!.id;
    const drawingPointId = crypto.randomUUID();
    const linked = {
      ...created,
      views: created.views.map(view => view.id === drawing.id ? {
        ...view,
        contactPoints: [...view.contactPoints, {
          id: drawingPointId, logicalContactId: logicalId,
          x: constantExpressionV2(100), y: constantExpressionV2(120), direction: "left" as const,
        }],
      } : view),
    };

    const removed = deleteContactPointV2(linked, e4.id, e4PointId);
    expect(removed.logicalContacts).toHaveLength(1);
    expect(removed.views[1]!.contactPoints[0]).toMatchObject({ id: drawingPointId, logicalContactId: logicalId });
    expect(validateTemplateContentV2(removed).valid).toBe(true);
  });
});

describe("template v2 numeric expressions", () => {
  it("evaluates constants, parameters and bounded arithmetic", () => {
    const parameterId = crypto.randomUUID();
    expect(evaluateNumericExpressionV2({
      kind: "binary", operator: "multiply", left: { kind: "parameter", parameterId },
      right: { kind: "negate", operand: constantExpressionV2(-2) },
    }, { [parameterId]: 12 })).toBe(24);
    expect(() => evaluateNumericExpressionV2({ kind: "binary", operator: "divide", left: constantExpressionV2(1), right: constantExpressionV2(0) }))
      .toThrowError(expect.objectContaining({ code: "division_by_zero" }));
  });
});
