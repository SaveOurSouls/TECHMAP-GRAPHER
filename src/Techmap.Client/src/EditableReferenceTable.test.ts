import { describe, expect, it } from "vitest";
import { editableReferenceDraft, editableReferenceRequest } from "./EditableReferenceTable";
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
    expect(request.records[0]).toMatchObject({
      entityType: "connector", sourceKey: "PHR-02",
      payload: { article: "PHR-02", description: "2 контакта", _techmapFieldLinks: '{"article":"Артикул"}' },
    });
  });

  it("rejects empty tables, duplicate fields and duplicate record keys", () => {
    expect(() => editableReferenceRequest({ sourceUri: "", columns: [], rows: [] }, null)).toThrow(/хотя бы одну строку/i);
    const draft = editableReferenceDraft(snapshot);
    expect(() => editableReferenceRequest({
      ...draft,
      columns: [...draft.columns, { id: crypto.randomUUID(), name: "ARTICLE", sourceColumn: "" }],
    }, null)).toThrow(/не должны повторяться/i);
    expect(() => editableReferenceRequest({ ...draft, rows: [...draft.rows, { ...draft.rows[0]!, id: crypto.randomUUID() }] }, null))
      .toThrow(/ключ.*повторяется/i);
  });
});
