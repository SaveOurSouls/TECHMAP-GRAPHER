import { describe, expect, it } from "vitest";
import { parseHarnessCutList } from "../harness-cut-list-api";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { designToScene } from "./HarnessDesignEditor";
import {
  calculateWireCutLength,
  createEmptyHarnessDesign,
  parseHarnessDesignDocument,
  type WireInstance,
  type WireMaterialBinding,
} from "./model";

const projectId = "22345678-1234-4123-8123-123456789abc";
const harnessId = "32345678-1234-4123-8123-123456789abc";

const material: WireMaterialBinding = {
  sourceId: "technology-database",
  snapshotId: "00000000-0000-4000-8000-000000000099",
  snapshotSha256: "a".repeat(64),
  recordId: "b".repeat(64),
  entityType: "wire",
  sourceKey: "UL1061-24AWG",
  displayName: "UL1061 24AWG",
};

function cutListPayload(wire: WireInstance) {
  const cut = calculateWireCutLength(wire);
  const warnings = [
    ...(!wire.materialBinding ? ["material-missing"] : []),
    ...(!cut.isComplete ? ["length-missing"] : []),
  ];
  return {
    projectId,
    harnessId,
    harnessQuantity: 2,
    status: warnings.length === 0 ? "ready" : "incomplete",
    warning: warnings.length === 0 ? "" : "Карта резки требует заполнения.",
    items: [{
      wireId: wire.id,
      circuit: wire.circuit,
      material: wire.materialBinding?.sourceKey ?? "not-pinned",
      materialSourceKey: wire.materialBinding?.sourceKey ?? null,
      materialDisplayName: wire.materialBinding?.displayName ?? null,
      sourceLengthMm: cut.sourceLengthMm,
      endCorrectionFromMm: cut.endCorrectionFromMm,
      endCorrectionToMm: cut.endCorrectionToMm,
      roundingStepMm: cut.cutRoundingStepMm,
      cutLengthMm: cut.cutLengthMm,
      pieces: 2,
      totalMetres: cut.cutLengthMm === null ? null : cut.cutLengthMm * 2 / 1_000,
      status: cut.isComplete ? "ready" : "incomplete",
      warnings,
    }],
  };
}

describe("wire material and cut-list lifecycle", () => {
  it("keeps the pinned material and physical length through rerouting and save/reload", () => {
    const x1 = createConnector("x1", "XS1", 2, { x: 0, y: 0 });
    const x2 = createConnector("x2", "XS2", 2, { x: 700, y: 0 });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector: x1 });
    document = applyEditorCommand(document, { type: "add-connector", connector: x2 });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire(
        "w1",
        { connectorId: x1.id, contactId: x1.contacts[0]!.id },
        { connectorId: x2.id, contactId: x2.contacts[0]!.id },
        null,
        "DATA+",
      ),
    });

    const incomplete = parseHarnessCutList(cutListPayload(document.wires[0]!), projectId, harnessId);
    expect(incomplete).toMatchObject({
      status: "incomplete",
      items: [{ status: "incomplete", warnings: ["material-missing", "length-missing"] }],
    });

    document = applyEditorCommand(document, {
      type: "update-wire",
      wireId: "w1",
      materialBinding: material,
      lengthMm: 125.1,
      endCorrectionFromMm: 5,
      cutRoundingStepMm: 1,
    });
    document = applyEditorCommand(document, {
      type: "move-connector", connectorId: x1.id, view: "e4", position: { x: 40, y: 80 },
    });
    document = applyEditorCommand(document, {
      type: "reconnect-wire",
      wireId: "w1",
      end: "to",
      endpoint: { connectorId: x2.id, contactId: x2.contacts[1]!.id },
    });

    const restored = parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)));
    const restoredWire = restored.wires[0]!;
    expect(restoredWire).toMatchObject({
      lengthMm: 125.1,
      endCorrectionFromMm: 5,
      cutRoundingStepMm: 1,
      materialBinding: material,
      to: { connectorId: x2.id, contactId: x2.contacts[1]!.id },
    });

    expect(designToScene(restored, "e4").find(item => item.id === restoredWire.id)?.metadata)
      .toMatchObject({
        lengthKnown: "true",
        lengthMm: "125.1",
        cutLengthMm: "131",
        materialStatus: "included",
        materialSourceKey: "UL1061-24AWG",
        materialDisplayName: "UL1061 24AWG",
      });

    const ready = parseHarnessCutList(cutListPayload(restoredWire), projectId, harnessId);
    expect(ready).toMatchObject({
      harnessQuantity: 2,
      status: "ready",
      items: [{
        materialSourceKey: "UL1061-24AWG",
        sourceLengthMm: 125.1,
        cutLengthMm: 131,
        pieces: 2,
        totalMetres: 0.262,
        status: "ready",
        warnings: [],
      }],
    });
  });
});
