import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import {
  createEmptyHarnessDesign,
  parseHarnessDesignDocument,
  type HarnessDesignDocument,
  type WireMaterialBinding,
} from "./model";

const cableMaterial: WireMaterialBinding = {
  sourceId: "БД.ПРОВ",
  snapshotId: "8eb5fd8b-cf8e-41bb-8540-17f1dc4f13bd",
  snapshotSha256: "a".repeat(64),
  recordId: "b".repeat(64),
  entityType: "cable",
  sourceKey: "CABLE-4X0.25",
  displayName: "Кабель 4×0,25 мм²",
};

function documentWithWires(): HarnessDesignDocument {
  const left = createConnector("x1", "X1", 2, { x: 0, y: 0 });
  const rightBase = createConnector("x2", "X2", 2, { x: 300, y: 0 });
  const right = { ...rightBase, schematic: { ...rightBase.schematic, orientation: "contacts-left" as const } };
  const wire1 = createWire(
    "w1",
    { connectorId: left.id, contactId: left.contacts[0]!.id },
    { connectorId: right.id, contactId: right.contacts[0]!.id },
  );
  const wire2 = createWire(
    "w2",
    { connectorId: left.id, contactId: left.contacts[1]!.id },
    { connectorId: right.id, contactId: right.contacts[1]!.id },
  );
  const { e4Route: _wire1Route, ...legacyWire1 } = wire1;
  const { e4Route: _wire2Route, ...legacyWire2 } = wire2;
  return parseHarnessDesignDocument({
    ...createEmptyHarnessDesign(),
    connectors: [left, right],
    wires: [legacyWire1, legacyWire2],
  });
}

describe("multicore cable model", () => {
  it("normalizes legacy documents without a cables collection", () => {
    const legacy = { ...createEmptyHarnessDesign() } as Record<string, unknown>;
    delete legacy.cables;
    expect(parseHarnessDesignDocument(legacy).cables).toEqual([]);
  });

  it("normalizes cable defaults and preserves its physical material and length", () => {
    const source = documentWithWires();
    const parsed = parseHarnessDesignDocument({
      ...source,
      cables: [{
        id: "cable-1",
        memberWireIds: ["w1", "w2"],
        materialBinding: cableMaterial,
        lengthMm: 125.5,
      }],
    });

    expect(parsed.cables).toEqual([{
      id: "cable-1",
      memberWireIds: ["w1", "w2"],
      materialBinding: cableMaterial,
      lengthMm: 125.5,
      endCorrectionFromMm: 0,
      endCorrectionToMm: 0,
      cutRoundingStepMm: 1,
    }]);
  });

  it("rejects broken cable identity, material, length, and membership", () => {
    const source = documentWithWires();
    const cable = {
      id: "cable-1",
      memberWireIds: ["w1"],
      lengthMm: null,
      endCorrectionFromMm: 0,
      endCorrectionToMm: 0,
      cutRoundingStepMm: 1,
    };
    expect(() => parseHarnessDesignDocument({ ...source, cables: {} })).toThrow(/Кабели/);
    expect(() => parseHarnessDesignDocument({ ...source, cables: [cable, cable] })).toThrow(/ID кабелей/);
    expect(() => parseHarnessDesignDocument({
      ...source, cables: [{ ...cable, memberWireIds: ["w1", "w1"] }],
    })).toThrow(/повторяющиеся/);
    expect(() => parseHarnessDesignDocument({
      ...source, cables: [{ ...cable, memberWireIds: ["missing"] }],
    })).toThrow(/отсутствующий провод/);
    expect(() => parseHarnessDesignDocument({
      ...source,
      cables: [cable, { ...cable, id: "cable-2" }],
    })).toThrow(/только в один кабель/);
    expect(() => parseHarnessDesignDocument({
      ...source,
      cables: [{ ...cable, materialBinding: { ...cableMaterial, entityType: "wire" } }],
    })).toThrow(/тип cable/);
    expect(() => parseHarnessDesignDocument({
      ...source, cables: [{ ...cable, lengthMm: -1 }],
    })).toThrow(/Длина кабеля/);
  });

  it("adds, updates, reassigns members, and removes a cable atomically", () => {
    let document = applyEditorCommand(documentWithWires(), {
      type: "add-cable",
      cable: {
        id: "cable-1",
        memberWireIds: ["w1"],
        lengthMm: null,
        endCorrectionFromMm: 0,
        endCorrectionToMm: 0,
        cutRoundingStepMm: 1,
      },
    });
    document = applyEditorCommand(document, {
      type: "update-cable",
      cableId: "cable-1",
      materialBinding: cableMaterial,
      lengthMm: 250,
      endCorrectionFromMm: 4,
      endCorrectionToMm: 6,
      cutRoundingStepMm: 5,
    });
    document = applyEditorCommand(document, {
      type: "set-cable-members", cableId: "cable-1", memberWireIds: ["w1", "w2"],
    });
    expect(document.cables[0]).toMatchObject({
      memberWireIds: ["w1", "w2"],
      materialBinding: cableMaterial,
      lengthMm: 250,
      endCorrectionFromMm: 4,
      endCorrectionToMm: 6,
      cutRoundingStepMm: 5,
    });
    expect(applyEditorCommand(document, { type: "remove-cable", cableId: "cable-1" }).cables).toEqual([]);
  });

  it("prevents one wire from joining two cables and keeps commands atomic", () => {
    let document = applyEditorCommand(documentWithWires(), {
      type: "add-cable",
      cable: {
        id: "cable-1", memberWireIds: ["w1"], lengthMm: null,
        endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1,
      },
    });
    const before = document;
    expect(() => applyEditorCommand(document, {
      type: "add-cable",
      cable: {
        id: "cable-2", memberWireIds: ["w1"], lengthMm: null,
        endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1,
      },
    })).toThrow(/только в один кабель/);
    expect(document).toBe(before);

    document = applyEditorCommand(document, {
      type: "add-cable",
      cable: {
        id: "cable-2", memberWireIds: ["w2"], lengthMm: null,
        endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1,
      },
    });
    expect(() => applyEditorCommand(document, {
      type: "set-cable-members", cableId: "cable-2", memberWireIds: ["w1", "w2"],
    })).toThrow(/только в один кабель/);
  });

  it("removes deleted wires from cable membership without deleting the cable", () => {
    let document = applyEditorCommand(documentWithWires(), {
      type: "add-cable",
      cable: {
        id: "cable-1", memberWireIds: ["w2"], lengthMm: null,
        endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1,
      },
    });
    document = {
      ...document,
      wires: document.wires.map((wire) => wire.id === "w1" ? { ...wire, e4RouteMode: "manual" as const } : wire),
    };
    document = applyEditorCommand(document, { type: "remove-wire", wireId: "w2" });
    expect(document.cables).toMatchObject([{ id: "cable-1", memberWireIds: [] }]);
  });
});
