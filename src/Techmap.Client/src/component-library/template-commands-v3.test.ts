import { describe, expect, it } from "vitest";
import {
  addBasicNodeV3,
  addBundlePortV3,
  addContactPointV3,
  addContactTypeGroupV3,
  attachRepeatDomainV3,
  constantExpressionV3,
  createRepeatPrototypeV3,
  deleteBundlePortV3,
  deleteContactPointV3,
  deleteContactTypeGroupV3,
  editBundlePortV3,
  editContactPointV3,
  editLogicalContactV3,
  linkLogicalContactPointV3,
  newTemplateContentV3,
  projectTemplateContentV3CoreToV2,
  removeArticleVariantContactGroupV3,
  removeArticleVariantV3,
  renameContactTypeGroupV3,
  setArticleVariantContactGroupV3,
  setRepeatCountV3,
  TemplateCommandV3Error,
  upsertArticleVariantV3,
} from "./template-commands-v3";
import { validateTemplateContentV2 } from "./template-model-v2";
import { validateTemplateContentV3 } from "./template-model-v3";
import { expandTemplateRepeatsV2 } from "./template-repeat-v2";

describe("template v3 immutable commands", () => {
  it("creates mandatory views and a strictly valid v3 document", () => {
    const content = newTemplateContentV3();

    expect(content.schemaVersion).toBe(3);
    expect(content.views.map(view => view.kind)).toEqual(["e4", "drawing"]);
    expect(content.contactTypeGroups).toEqual([]);
    expect(content.articleVariants).toEqual([]);
    expect(validateTemplateContentV3(content)).toEqual({ valid: true, diagnostics: [] });
  });

  it("creates, links, edits and deletes one logical contact without mutating its source", () => {
    const initial = newTemplateContentV3();
    const [grouped, groupId] = addContactTypeGroupV3(initial, "Сигнальные");
    const before = structuredClone(grouped);
    const e4 = grouped.views[0]!, drawing = grouped.views[1]!;
    const [withE4Point, e4PointId] = addContactPointV3(grouped, e4.id, {
      number: "A1", name: "CAN H", circuitText: "CAN_H", contactTypeGroupId: groupId,
      x: constantExpressionV3(10), y: constantExpressionV3(20), direction: "right",
    });
    const logicalId = withE4Point.logicalContacts[0]!.id;
    const [linked, drawingPointId] = linkLogicalContactPointV3(withE4Point, drawing.id, logicalId, {
      x: constantExpressionV3(30), y: constantExpressionV3(40), direction: "left",
    });
    const editedLogical = editLogicalContactV3(linked, logicalId, {
      number: "A2", name: "CAN Low", circuitText: null, contactTypeGroupId: null,
    });
    const editedPoint = editContactPointV3(editedLogical, drawing.id, drawingPointId, {
      x: constantExpressionV3(35), direction: "up",
    });
    const withoutDrawing = deleteContactPointV3(editedPoint, drawing.id, drawingPointId);
    const withoutE4 = deleteContactPointV3(withoutDrawing, e4.id, e4PointId);

    expect(grouped).toEqual(before);
    expect(editedPoint.logicalContacts[0]).toMatchObject({
      id: logicalId, number: "A2", name: "CAN Low", circuitText: null, contactTypeGroupId: null,
    });
    expect(editedPoint.views[1]!.contactPoints[0]).toMatchObject({ id: drawingPointId, direction: "up" });
    expect(withoutDrawing.logicalContacts).toHaveLength(1);
    expect(withoutE4.logicalContacts).toEqual([]);
    expect(validateTemplateContentV3(withoutE4).valid).toBe(true);
  });

  it("manages view-specific bundle ports", () => {
    const initial = newTemplateContentV3(), drawing = initial.views[1]!;
    const [added, portId] = addBundlePortV3(initial, drawing.id, { name: "Общий пучок", direction: "left" });
    const edited = editBundlePortV3(added, drawing.id, portId, {
      name: "Боковой пучок", x: constantExpressionV3(500), direction: "down",
    });
    const removed = deleteBundlePortV3(edited, drawing.id, portId);

    expect(initial.views[1]!.bundlePorts).toEqual([]);
    expect(edited.views[1]!.bundlePorts[0]).toMatchObject({ id: portId, name: "Боковой пучок", direction: "down" });
    expect(removed.views[1]!.bundlePorts).toEqual([]);
    expect(validateTemplateContentV3(removed).valid).toBe(true);
  });

  it("manages unique contact type groups and protects referenced groups", () => {
    const initial = newTemplateContentV3();
    const [withSignal, signalId] = addContactTypeGroupV3(initial, "Сигнальные");
    const [withPower, powerId] = addContactTypeGroupV3(withSignal, "Силовые");
    const renamed = renameContactTypeGroupV3(withPower, powerId, "Питание");
    const [referenced] = addContactPointV3(renamed, renamed.views[0]!.id, { contactTypeGroupId: signalId });

    expect(() => addContactTypeGroupV3(renamed, " питание ")).toThrowError(expect.objectContaining({
      code: "duplicate_contact_type_group_name",
    }));
    expect(() => deleteContactTypeGroupV3(referenced, signalId)).toThrowError(expect.objectContaining({
      code: "contact_type_group_referenced",
    }));
    expect(deleteContactTypeGroupV3(renamed, signalId).contactTypeGroups.map(group => group.id)).toEqual([powerId]);
  });

  it("upserts article variants and validates group counts and terminal keys atomically", () => {
    const initial = newTemplateContentV3();
    const [grouped, groupId] = addContactTypeGroupV3(initial, "Сигнальные");
    const [withContact] = addContactPointV3(grouped, grouped.views[0]!.id, { contactTypeGroupId: groupId });
    const source = structuredClone(withContact);
    const [withVariant, variantId] = upsertArticleVariantV3(withContact, {
      sourceId: "db", entityType: "connector", articleKey: "JST-XH-02", parameterValues: [], contactGroups: null,
    });
    const configured = setArticleVariantContactGroupV3(withVariant, variantId, groupId, 1, [
      { sourceId: "db", entityType: "terminal", articleKey: "SXH-001T-P0.6" },
    ]);
    const [withGeometry] = addBasicNodeV3(
      configured,
      configured.views[1]!.id,
      configured.views[1]!.layers[0]!.id,
      "rectangle",
    );
    const [renamed, sameId] = upsertArticleVariantV3(withGeometry, {
      id: variantId, sourceId: "db", entityType: "connector", articleKey: "JST-XH-02-A",
    });
    const unconfigured = removeArticleVariantContactGroupV3(renamed, variantId, groupId);
    const removed = removeArticleVariantV3(unconfigured, variantId);

    expect(withContact).toEqual(source);
    expect(sameId).toBe(variantId);
    expect(configured.articleVariants[0]!.contactGroups).toEqual([{
      contactTypeGroupId: groupId,
      contactCount: 1,
      allowedTerminalArticleKeys: [{ sourceId: "db", entityType: "terminal", articleKey: "SXH-001T-P0.6" }],
    }]);
    expect(renamed.articleVariants[0]).toMatchObject({ articleKey: "JST-XH-02-A" });
    expect(renamed.articleVariants[0]!.contactGroups).toEqual(configured.articleVariants[0]!.contactGroups);
    expect(unconfigured.articleVariants[0]!.contactGroups).toBeNull();
    expect(removed.articleVariants).toEqual([]);
    const temporarilyStale = setArticleVariantContactGroupV3(withVariant, variantId, groupId, 2, []);
    expect(validateTemplateContentV3(temporarilyStale)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unproducible_contact_count" })]),
    });
    expect(validateTemplateContentV3(configured).valid).toBe(true);
  });

  it("permits an atomic editing sequence before the strict save boundary", () => {
    const initial = newTemplateContentV3();
    const [grouped, groupId] = addContactTypeGroupV3(initial, "Сигнальные");
    const [withFirst] = addContactPointV3(grouped, grouped.views[0]!.id, { number: "1", contactTypeGroupId: groupId });
    const [withVariant, variantId] = upsertArticleVariantV3(withFirst, {
      sourceId: "db", entityType: "connector", articleKey: "EDITABLE-2",
    });
    const configuredOne = setArticleVariantContactGroupV3(withVariant, variantId, groupId, 1, []);

    const [withSecond] = addContactPointV3(configuredOne, configuredOne.views[0]!.id, { number: "2", contactTypeGroupId: groupId });
    expect(validateTemplateContentV3(withSecond).valid).toBe(false);
    const configuredTwo = setArticleVariantContactGroupV3(withSecond, variantId, groupId, 2, []);

    expect(validateTemplateContentV3(configuredTwo)).toEqual({ valid: true, diagnostics: [] });
  });

  it("preserves all v3-only fields through V2 core geometry and repeat commands", () => {
    const initial = newTemplateContentV3(), e4 = initial.views[0]!, drawing = initial.views[1]!;
    const [grouped, groupId] = addContactTypeGroupV3(initial, "Сигнальные");
    const [withVariant, variantId] = upsertArticleVariantV3(grouped, {
      sourceId: "db", entityType: "connector", articleKey: "SERIES-X", contactGroups: null,
    });
    const [withNode, e4NodeId] = addBasicNodeV3(withVariant, e4.id, e4.layers[0]!.id, "line");
    const [withPoint, e4PointId] = addContactPointV3(withNode, e4.id, {
      number: "1", name: "Signal", circuitText: "NET-1", contactTypeGroupId: groupId,
    });
    const [repeated, repeatIds] = createRepeatPrototypeV3(withPoint, {
      viewId: e4.id, layerId: e4.layers[0]!.id, prototypeNodeId: e4NodeId, prototypePointId: e4PointId,
      count: 2, step: { x: constantExpressionV3(0), y: constantExpressionV3(10) },
    });
    const logicalId = repeated.logicalContacts[0]!.id;
    const [withDrawingNode, drawingNodeId] = addBasicNodeV3(repeated, drawing.id, drawing.layers[0]!.id, "rectangle");
    const [withDrawingPoint, drawingPointId] = linkLogicalContactPointV3(withDrawingNode, drawing.id, logicalId);
    const [attached] = attachRepeatDomainV3(withDrawingPoint, {
      viewId: drawing.id, layerId: drawing.layers[0]!.id, prototypeNodeId: drawingNodeId,
      repeatDomainId: repeatIds.repeatDomainId,
      step: { x: constantExpressionV3(20), y: constantExpressionV3(0) },
    });
    const counted = setRepeatCountV3(attached, repeatIds.repeatDomainId, 10);
    const core = projectTemplateContentV3CoreToV2(counted);

    expect(counted.contactTypeGroups).toEqual([{ id: groupId, name: "Сигнальные" }]);
    expect(counted.logicalContacts[0]).toMatchObject({ circuitText: "NET-1", contactTypeGroupId: groupId });
    expect(counted.articleVariants).toEqual([{
      id: variantId, sourceId: "db", entityType: "connector", articleKey: "SERIES-X",
      parameterValues: [], contactGroups: null,
    }]);
    expect(counted.views[1]!.repeatPlacements[0]!.contactPointIds).toEqual([drawingPointId]);
    expect(core.logicalContacts[0]!.contactType).toBe("Сигнальные");
    expect(core.articleParameterPresets[0]!.id).toBe(variantId);
    expect(validateTemplateContentV2(core).valid).toBe(true);
    expect(expandTemplateRepeatsV2(core).every(view => view.placements[0]!.occurrences.length === 10)).toBe(true);
    expect(validateTemplateContentV3(counted).valid).toBe(true);
  });

  it("rejects invalid input before applying a core command", () => {
    const invalid = newTemplateContentV3();
    invalid.schemaVersion = 2 as 3;

    expect(() => addBasicNodeV3(invalid, invalid.views[0]!.id, invalid.views[0]!.layers[0]!.id, "line"))
      .toThrowError(expect.objectContaining({ code: "invalid_input" } satisfies Partial<TemplateCommandV3Error>));
  });
});
