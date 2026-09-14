import { describe, expect, it } from "vitest";
import type {
  ComponentTemplateContactRepresentationSnapshot,
  ComponentTemplateContactSnapshot,
  ConnectorInstance,
} from "./model";
import {
  connectorContactPosition,
  createEmptyHarnessDesign,
  wireEndpointE4Anchor,
} from "./model";
import {
  materializedContactWorldRepresentation,
  selectMaterializedContactRepresentation,
} from "./materialized-contact-representation";

const fixedLogicalId = "fixed-contact";
const repeatedPrototypeId = "repeat-contact";
const repeatedLogicalId = "repeat-domain:1:repeat-contact";

function representation(
  viewKind: "e4" | "drawing" | "additional",
  x: number,
  y: number,
  direction: "left" | "right" | "up" | "down",
  occurrenceKey?: string,
): ComponentTemplateContactRepresentationSnapshot {
  return {
    viewId: `${viewKind}-view`,
    viewName: viewKind,
    viewKind,
    pointId: `${viewKind}-point`,
    occurrenceKey,
    x,
    y,
    direction,
  };
}

function snapshotContact(
  logicalContactId: string,
  prototypeLogicalContactId: string,
  representations: readonly ComponentTemplateContactRepresentationSnapshot[],
): ComponentTemplateContactSnapshot {
  return {
    logicalContactId,
    prototypeLogicalContactId,
    sourceNumber: "1",
    name: "Контакт",
    circuitText: null,
    contactTypeGroupId: null,
    contactType: "",
    allowedTerminalArticleKeys: [],
    representations,
  };
}

function connector(): ConnectorInstance {
  const fixed = snapshotContact(fixedLogicalId, fixedLogicalId, [
    representation("e4", 12, 18, "right"),
    representation("drawing", 50, 60, "up"),
    representation("additional", 5, 6, "left"),
  ]);
  const repeated = snapshotContact(repeatedLogicalId, repeatedPrototypeId, [
    representation("e4", 30, 40, "left", "repeat-domain:0:repeat-contact"),
    representation("e4", 30, 70, "down", repeatedLogicalId),
    representation("drawing", 80, 90, "right", repeatedLogicalId),
  ]);
  return {
    id: "connector-1",
    designation: "XS1",
    libraryCode: "LIB",
    partNumber: "A-1",
    contacts: [
      {
        id: "connector-1:contact:fixed-contact",
        logicalContactId: fixedLogicalId,
        number: 1,
        contactType: "",
        circuit: "",
        terminalArticle: "",
        wire: "",
        color: "",
        connectionStatus: "available",
        customValues: {},
        libraryContact: null,
      },
      {
        id: `connector-1:contact:${repeatedLogicalId}`,
        logicalContactId: repeatedLogicalId,
        number: 2,
        contactType: "",
        circuit: "",
        terminalArticle: "",
        wire: "",
        color: "",
        connectionStatus: "available",
        customValues: {},
        libraryContact: null,
      },
    ],
    schematic: { orientation: "contacts-right", baseColumns: [], customFields: [] },
    positions: { e4: { x: 100, y: 200 }, drawing: { x: -20, y: 50 } },
    layerIds: { e4: "connectors", drawing: "connectors" },
    libraryBinding: {
      mode: "template",
      templateId: "template-1",
      templateVersion: 3,
      versionSha256: "a".repeat(64),
      articleVariantId: "variant-1",
      article: { sourceId: "source", entityType: "connector", articleKey: "A-1" },
      snapshot: {
        templateId: "template-1",
        templateVersion: 3,
        versionSha256: "a".repeat(64),
        code: "LIB",
        name: "Library connector",
        articleVariantId: "variant-1",
        article: { sourceId: "source", entityType: "connector", articleKey: "A-1" },
        articleBindings: [{ sourceId: "source", entityType: "connector", articleKey: "A-1" }],
        assets: [],
        contacts: [fixed, repeated],
      },
    },
  };
}

describe("materialized contact representations", () => {
  it("selects fixed representations by runtime contact ID or logical contact ID and view kind", () => {
    const instance = connector();

    expect(selectMaterializedContactRepresentation(
      instance,
      "connector-1:contact:fixed-contact",
      "e4",
    )).toMatchObject({ x: 12, y: 18, direction: "right", viewKind: "e4" });
    expect(selectMaterializedContactRepresentation(instance, fixedLogicalId, "drawing"))
      .toMatchObject({ x: 50, y: 60, direction: "up", viewKind: "drawing" });
  });

  it("uses the exact occurrence key for a repeated materialized contact", () => {
    const selected = selectMaterializedContactRepresentation(connector(), repeatedLogicalId, "e4");

    expect(selected).toMatchObject({
      occurrenceKey: repeatedLogicalId,
      x: 30,
      y: 70,
      direction: "down",
    });
  });

  it("translates each view from its own connector origin and preserves direction", () => {
    expect(materializedContactWorldRepresentation(connector(), fixedLogicalId, "e4"))
      .toMatchObject({ position: { x: 112, y: 218 }, direction: "right" });
    expect(materializedContactWorldRepresentation(connector(), fixedLogicalId, "drawing"))
      .toMatchObject({ position: { x: 30, y: 110 }, direction: "up" });
    expect(materializedContactWorldRepresentation(connector(), repeatedLogicalId, "e4"))
      .toMatchObject({ position: { x: 130, y: 270 }, direction: "down" });
  });

  it("drives persisted wire endpoints from the pinned contact geometry", () => {
    const instance = connector();
    const document = { ...createEmptyHarnessDesign(), connectors: [instance] };
    const endpoint = { connectorId: instance.id, contactId: instance.contacts[0]!.id };

    expect(connectorContactPosition(instance, endpoint.contactId, "e4"))
      .toEqual({ x: 112, y: 218 });
    expect(connectorContactPosition(instance, endpoint.contactId, "drawing"))
      .toEqual({ x: 30, y: 110 });
    expect(wireEndpointE4Anchor(document, endpoint)).toEqual({
      position: { x: 112, y: 218 },
      leadDirection: "right",
    });
  });

  it("returns null so the caller can use the ordinary connector fallback", () => {
    const instance = connector();
    expect(selectMaterializedContactRepresentation(instance, "missing-contact", "e4")).toBeNull();
    expect(selectMaterializedContactRepresentation(instance, repeatedLogicalId, "drawing"))
      .not.toBeNull();
    const withoutDrawing = {
      ...instance,
      libraryBinding: instance.libraryBinding?.mode === "template"
        ? {
            ...instance.libraryBinding,
            snapshot: {
              ...instance.libraryBinding.snapshot,
              contacts: instance.libraryBinding.snapshot.contacts.map(contact =>
                contact.logicalContactId === repeatedLogicalId
                  ? { ...contact, representations: contact.representations.filter(item => item.viewKind !== "drawing") }
                  : contact),
            },
          }
        : instance.libraryBinding,
    } satisfies ConnectorInstance;
    expect(materializedContactWorldRepresentation(withoutDrawing, repeatedLogicalId, "drawing")).toBeNull();
    expect(selectMaterializedContactRepresentation(
      { ...instance, libraryBinding: { mode: "free" } },
      fixedLogicalId,
      "e4",
    )).toBeNull();
  });
});
