import { describe, expect, it } from "vitest";
import { editableReferenceDraft, editableReferenceRequest, referenceColumnLabel } from "./EditableReferenceTable";
import type { ReferenceCatalogSnapshot } from "./reference-catalog-api";

const snapshot: ReferenceCatalogSnapshot = {
  snapshotId: "11111111-1111-4111-8111-111111111111",
  sourceId: "custom-connectors",
  contractVersion: 1,
  capturedUtc: "2026-09-17T00:00:00Z",
  sourceKind: "editable-table",
  versionFingerprint: "v1",
  sourceUri: "https://example.test/catalog",
  sha256: "a".repeat(64),
  diagnostics: [],
  records: [{
    recordId: "b".repeat(64),
    entityType: "connector",
    sourceKey: "PHR-02",
    payload: { article: "PHR-02", description: "2 контакта", _techmapFieldLinks: '{"article":"Артикул"}' },
    sourceLocation: null,
  }],
};

describe("editable reference table", () => {
  it("preserves an added empty column and its position after saving and reopening", () => {
    const draft = editableReferenceDraft(snapshot);
    const withColumn = { ...draft, columns: [...draft.columns, { id: "new", name: "Примечание", sourceColumn: "" }] };
    const request = editableReferenceRequest(withColumn, null);
    expect(request.records[0]?.payload["Примечание"]).toBe("");
    const reopened = editableReferenceDraft({ ...snapshot, records: request.records.map((record, i) => ({ ...record, recordId: String(i), sourceLocation: record.sourceLocation ?? null })) });
    expect(reopened.columns.map(referenceColumnLabel)).toEqual(["Артикул", "description", "Примечание"]);
  });

  it("restores AWG worksheet headers/order and preserves hidden metadata on an unchanged save", () => {
    const imported = { ...snapshot, sourceId: "technology-awg-reference", records: [{
      ...snapshot.records[0]!, entityType: "awg-reference", sourceKey: "22.0", sourceLocation: "СПР.КАБ!36",
      payload: { conductorDiameterMm: 0.644, sectionMm2: 0.35, _techmapFuture: "keep" },
    }] };
    const draft = editableReferenceDraft(imported);
    expect(draft.columns.map(referenceColumnLabel).slice(0, 6)).toEqual(["AWG", "ГОСТ", "Ø жилы", "МГТФ", "МС", "M22759"]);
    expect(draft.columns.some(column => column.name.startsWith("_techmap"))).toBe(false);
    expect(editableReferenceRequest(draft, imported.snapshotId).records[0]).toEqual({
      entityType: "awg-reference", sourceKey: "22.0", sourceLocation: "СПР.КАБ!36", payload: imported.records[0]!.payload,
    });
    const key = draft.columns[0]!;
    const edited = { ...draft, rows: [{ ...draft.rows[0]!, values: { ...draft.rows[0]!.values, [key.id]: "24" } }] };
    expect(editableReferenceRequest(edited, null).records[0]?.sourceKey).toBe("24");
  });

  it("shows cable names and D1/D2/D3 cells without composite keys or JSON and saves edited layers", () => {
    const imported = { ...snapshot, sourceId: "technology-coax-cables", records: [{ ...snapshot.records[0]!,
      entityType: "coax-cable", sourceKey: "5:RG|58|1:1|1:2|1:3 #2", payload: {
        layers: [{ index: 1, diameterMm: 1 }, { index: 2, diameterMm: 2, custom: true }],
      },
    }] };
    const draft = editableReferenceDraft(imported);
    expect(draft.columns.map(referenceColumnLabel)).toEqual(["Кабель", "D1", "D2", "D3"]);
    expect(draft.rows[0]!.values[draft.columns[0]!.id]).toBe("RG|58");
    expect(editableReferenceRequest(draft, null).records[0]?.payload).toEqual(imported.records[0]!.payload);
    const edited = { ...draft, rows: [{ ...draft.rows[0]!, values: { ...draft.rows[0]!.values, [draft.columns[2]!.id]: "2,5" } }] };
    expect(editableReferenceRequest(edited, null).records[0]).toMatchObject({
      sourceKey: imported.records[0]!.sourceKey,
      payload: { layers: [{ index: 1, diameterMm: 1 }, { index: 2, diameterMm: 2.5, custom: true }] },
    });
  });

  it("respects stored wire worksheet order and hides the internal duplicate-row key", () => {
    const imported = { ...snapshot, sourceId: "technology-wires", records: [{ ...snapshot.records[0]!,
      sourceKey: "4:TEST|2:1C #2", payload: { Core: "1C", Марка: "TEST", Цвет: "белый",
        _techmapColumnOrder: '["Марка","Цвет","Core"]' },
    }] };
    const draft = editableReferenceDraft(imported);
    expect(draft.columns.map(referenceColumnLabel)).toEqual(["Марка", "Цвет", "Core"]);
    expect(editableReferenceRequest(draft, null).records[0]?.payload).toEqual(imported.records[0]!.payload);
  });

  it("converts an imported snapshot into editable text columns and keeps source links", () => {
    const draft = editableReferenceDraft(snapshot);
    expect(draft.sourceUri).toBe("https://example.test/catalog");
    expect(draft.columns.map(({ name, sourceColumn }) => ({ name, sourceColumn }))).toEqual([
      { name: "article", sourceColumn: "Артикул" },
      { name: "description", sourceColumn: "" },
    ]);
    expect(draft.rows[0]).toMatchObject({ entityType: "connector", sourceKey: "PHR-02" });
    expect(draft.rows[0]?.values[draft.columns[1]!.id]).toBe("2 контакта");

    const request = editableReferenceRequest(draft, snapshot.snapshotId);
    expect(request.expectedActiveSnapshotId).toBe(snapshot.snapshotId);
    expect(request.sourceKind).toBe("editable-table");
    expect(request.records[0]).toMatchObject({
      entityType: "connector", sourceKey: "PHR-02",
      payload: { article: "PHR-02", description: "2 контакта", _techmapFieldLinks: '{"article":"Артикул"}' },
    });
  });

  it("keeps the source kind and untouched JSON value types", () => {
    const imported = {
      ...snapshot,
      sourceKind: "xlsx",
      records: [{ ...snapshot.records[0]!, payload: { count: 12, enabled: true, nested: { code: "A" } } }],
    };
    const request = editableReferenceRequest(editableReferenceDraft(imported), imported.snapshotId);

    expect(request.sourceKind).toBe("xlsx");
    expect(request.records[0]?.payload).toEqual({ count: 12, enabled: true, nested: { code: "A" } });
  });

  it("rejects empty tables, duplicate fields and duplicate record keys", () => {
    expect(() => editableReferenceRequest({ sourceKind: "editable-table", sourceUri: "", columns: [], rows: [] }, null)).toThrow(/хотя бы одну строку/i);
    const draft = editableReferenceDraft(snapshot);
    expect(() => editableReferenceRequest({
      ...draft,
      columns: [...draft.columns, { id: crypto.randomUUID(), name: "ARTICLE", sourceColumn: "" }],
    }, null)).toThrow(/не должны повторяться/i);
    expect(() => editableReferenceRequest({ ...draft, rows: [...draft.rows, { ...draft.rows[0]!, id: crypto.randomUUID() }] }, null))
      .toThrow(/ключ.*повторяется/i);
  });
});
