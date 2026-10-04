import { describe, expect, it } from "vitest";
import { createBuiltInConnectorInstance, connectorSeriesCatalogId } from "./connector-series-demo";
import { applyEditorCommand } from "./commands";
import { createEmptyHarnessDesign, parseHarnessDesignDocument } from "./model";
import { hydrateTerminalDetails, resolveTerminalDetails, terminalDetailsFromRecord } from "./terminal-details";

const record = {
  recordId: "record", entityType: "terminal", sourceKey: "T-001", sourceLocation: null,
  payload: { manufacturer: "Acme", series: "Series A", description: "Crimp terminal", reelArticle: "T-001" },
};

describe("terminal details", () => {
  it("reads the bundled terminal catalog Product Name and decodes its article identity", () => {
    expect(terminalDetailsFromRecord({...record,sourceKey:"3:JST|6:SPH-02|0:|2:PH",payload:{manufacturer:"JST",series:"PH",productName:"Crimp contact"}}))
      .toEqual({manufacturer:"JST",series:"PH",description:"Crimp contact",article:"SPH-02"});
  });
  it("captures catalog fields and persists them with the selected contact", () => {
    const details = terminalDetailsFromRecord(record);
    expect(details).toEqual({ manufacturer: "Acme", series: "Series A", description: "Crimp terminal", article: "T-001" });
    const connector = createBuiltInConnectorInstance(connectorSeriesCatalogId("jst-xh"), { id: "X1", designation: "X1", partNumber: "XHP-2", e4Position: { x: 0, y: 0 } });
    const document = parseHarnessDesignDocument(JSON.parse(JSON.stringify({
      ...createEmptyHarnessDesign(),
      connectors: [{ ...connector, contacts: [{ ...connector.contacts[0], terminalArticle: "T-001", terminalDetails: details }] }],
    })));
    expect(document.connectors[0]!.contacts[0]!.terminalDetails).toEqual(details);
  });

  it("hydrates only exact matching legacy keys and preserves authored details", () => {
    const connector = createBuiltInConnectorInstance(connectorSeriesCatalogId("jst-xh"), { id: "X1", designation: "X1", partNumber: "XHP-2", e4Position: { x: 0, y: 0 } });
    const first = connector.contacts[0]!;
    const document = { ...createEmptyHarnessDesign(), connectors: [{ ...connector, contacts: [
      { ...first, terminalArticle: "T-001" },
      { ...first, id: `${first.id}:saved`, number: 2, terminalArticle: "T-001", terminalDetails: { manufacturer: "Saved", series: "", description: "", article: "T-001" } },
      { ...first, id: `${first.id}:unknown`, number: 3, terminalArticle: "OTHER" },
    ] }] };
    const next = hydrateTerminalDetails(document, [record]);
    expect(next.connectors[0]!.contacts.map(contact => contact.terminalDetails?.manufacturer)).toEqual(["Acme", "Saved", undefined]);
    expect(hydrateTerminalDetails(next, [record])).toBe(next);
  });

  it("resolves a bare article only when its catalog identity is unambiguous", () => {
    const composite = { ...record, sourceKey: "3:Acme|5:T-001|0:|3:SER" };
    expect(resolveTerminalDetails("T-001", [composite])).toMatchObject({ manufacturer: "Acme", article: "T-001" });
    expect(resolveTerminalDetails("3:Acme|5:T-001|0:|3:SER", [composite])).toMatchObject({ series: "Series A" });
    expect(resolveTerminalDetails("T-001", [composite, { ...composite, recordId: "other", sourceKey: "3:XYZ|5:T-001|0:|3:SER", payload: { ...composite.payload, manufacturer: "XYZ" } }]))
      .toBeUndefined();
  });

  it("preserves details when the same article is reselected without cache data and clears them for a changed article", () => {
    const connector = createBuiltInConnectorInstance(connectorSeriesCatalogId("jst-xh"), { id: "X1", designation: "X1", partNumber: "XHP-2", e4Position: { x: 0, y: 0 } });
    const contact = { ...connector.contacts[0]!, terminalArticle: "T-001", terminalDetails: terminalDetailsFromRecord(record) };
    const document = { ...createEmptyHarnessDesign(), connectors: [{ ...connector, contacts: [contact] }] };
    const same = applyEditorCommand(document, { type: "update-contact", connectorId: connector.id, contactId: contact.id, terminalArticle: "T-001" });
    expect(same.connectors[0]!.contacts[0]!.terminalDetails).toEqual(contact.terminalDetails);
    const changed = applyEditorCommand(document, { type: "update-contact", connectorId: connector.id, contactId: contact.id, terminalArticle: "T-002" });
    expect(changed.connectors[0]!.contacts[0]!.terminalDetails).toBeUndefined();
  });
});
