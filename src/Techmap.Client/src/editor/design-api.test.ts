import { describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../runtime-config";
import {
  createHarnessDesignApi,
  HarnessDesignApiError,
  parseRecoverableHarnessDesignContent,
} from "./design-api";
import { createBuiltInConnectorInstance } from "./connector-series-demo";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { createEmptyHarnessDesign, parseHarnessDesignDocument } from "./model";

const config = parseRuntimeConfig({
  configVersion: 1, basePath: "/techmap/", apiBasePath: "/techmap/api/v1/",
  appVersion: "1", apiVersion: "1", schemaVersion: "9",
});
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };
const projectId = "22345678-1234-4123-8123-123456789abc";
const harnessId = "32345678-1234-4123-8123-123456789abc";
const content = createEmptyHarnessDesign();

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("harness design API", () => {
  it("preserves the writer contract and rejects unsupported future documents", () => {
    expect(parseHarnessDesignDocument({ ...content, requiredWriterContractVersion: 1 }).requiredWriterContractVersion).toBe(1);
    expect(() => parseHarnessDesignDocument({ ...content, requiredWriterContractVersion: 2 })).toThrow(/новая версия/);
  });
  it("loads the shared E4 and drawing document", async () => {
    const fetcher = vi.fn(async () => response({ harnessId, schemaVersion: 1, revision: 0, content, updatedUtc: "2026-09-13T00:00:00Z" }));
    const api = createHarnessDesignApi(config, session, fetcher);
    await expect(api.get(projectId, harnessId)).resolves.toMatchObject({ harnessId, revision: 0, content });
    expect(fetcher).toHaveBeenCalledWith(
      `/techmap/api/v1/projects/${projectId}/harnesses/${harnessId}/design`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it("saves with optimistic document revision and CSRF", async () => {
    const fetcher = vi.fn(async () => response({ harnessId, schemaVersion: 1, revision: 4, content, updatedUtc: "2026-09-13T00:00:00Z" }));
    const api = createHarnessDesignApi(config, session, fetcher);
    await api.save(projectId, harnessId, 3, content);
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ "X-Techmap-CSRF": session.csrfNonce }),
      body: JSON.stringify({ expectedRevision: 3, schemaVersion: 1, writerContractVersion: 1, content }),
    }));
  });

  it("round-trips connector series metadata through the save API", async () => {
    const connector = createBuiltInConnectorInstance("catalog-xs-10", {
      id: "xs1", designation: "XS1", e4Position: { x: 20, y: 30 },
    });
    const seriesContent = { ...content, connectors: [connector] };
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({
        harnessId,
        schemaVersion: 1,
        revision: 1,
        content: requestBody.content,
        updatedUtc: "2026-09-13T00:00:00Z",
      });
    });
    const api = createHarnessDesignApi(config, session, fetcher);

    const saved = await api.save(projectId, harnessId, 0, seriesContent);

    const sentContent = requestBody?.content as typeof seriesContent;
    expect(sentContent.connectors[0]).toMatchObject({
      libraryBinding: { mode: "series", seriesId: "xs-demo-series", partNumber: "XS-10" },
    });
    expect(sentContent.connectors[0]?.contacts[0]?.libraryContact).toEqual({ kind: "signal", ordinal: 1 });
    expect(saved.content.connectors[0]).toMatchObject({
      libraryBinding: { mode: "series", seriesId: "xs-demo-series", partNumber: "XS-10" },
    });
    expect(saved.content.connectors[0]?.contacts.at(-1)?.libraryContact).toEqual({ kind: "third", ordinal: 2 });
  });

  it("normalizes old schemaVersion 1 connectors before saving and rejects inconsistent metadata locally", async () => {
    const current = createBuiltInConnectorInstance("catalog-xs-04", {
      id: "xs1", designation: "XS1", e4Position: { x: 0, y: 0 },
    });
    const { libraryBinding: _binding, ...legacyConnector } = current;
    const legacyContacts = legacyConnector.contacts.map(({ libraryContact: _position, ...contact }) => contact);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { content: typeof content };
      return response({ harnessId, schemaVersion: 1, revision: 1, content: body.content, updatedUtc: "2026-09-13T00:00:00Z" });
    });
    const api = createHarnessDesignApi(config, session, fetcher);
    const saved = await api.save(projectId, harnessId, 0, {
      ...content,
      connectors: [{ ...legacyConnector, contacts: legacyContacts }],
    });
    expect(saved.content.connectors[0]?.libraryBinding).toEqual({ mode: "free" });
    expect(saved.content.connectors[0]?.contacts.every((contact) => contact.libraryContact === null)).toBe(true);

    const inconsistent = {
      ...content,
      connectors: [{ ...current, partNumber: "BROKEN" }],
    };
    await expect(api.save(projectId, harnessId, 1, inconsistent)).rejects.toThrow(/не совпадает/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("repairs stale automatic E4 geometry at the API boundary", async () => {
    let staleContent = createEmptyHarnessDesign();
    staleContent = applyEditorCommand(staleContent, {
      type: "add-connector", connector: createConnector("x1", "X1", 1, { x: 0, y: 0 }),
    });
    staleContent = applyEditorCommand(staleContent, {
      type: "add-connector", connector: createConnector("x2", "X2", 1, { x: 1600, y: 0 }),
    });
    staleContent = applyEditorCommand(staleContent, { type: "flip-connector-orientation", connectorId: "x2" });
    staleContent = applyEditorCommand(staleContent, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }),
    });
    staleContent = {
      ...staleContent,
      connectors: [
        ...staleContent.connectors,
        createConnector("obstacle", "X3", 1, { x: 800, y: 40 }),
      ],
    };
    const staleRoute = staleContent.wires[0]!.e4Route;
    let sentContent: typeof staleContent | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { content: typeof staleContent };
      sentContent = body.content;
      return response({ harnessId, schemaVersion: 1, revision: 1, content: body.content, updatedUtc: "2026-09-13T00:00:00Z" });
    });
    const api = createHarnessDesignApi(config, session, fetcher);

    const saved = await api.save(projectId, harnessId, 0, staleContent);

    expect(sentContent?.wires[0]?.e4Route).not.toEqual(staleRoute);
    expect(saved.content.wires[0]?.e4Route).toEqual(sentContent?.wires[0]?.e4Route);
  });

  it("surfaces the current revision on a conflict", async () => {
    const fetcher = vi.fn(async () => response({ error: "design_revision_conflict", currentRevision: 7 }, 409));
    const api = createHarnessDesignApi(config, session, fetcher);
    const error = await api.save(projectId, harnessId, 2, content).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HarnessDesignApiError);
    expect(error).toMatchObject({ code: "design_revision_conflict", currentRevision: 7 });
  });

  it("opens a structurally valid document when only persisted E4 route geometry is invalid", async () => {
    let routed = createEmptyHarnessDesign();
    routed = applyEditorCommand(routed, {
      type: "add-connector", connector: createConnector("x1", "X1", 1, { x: 0, y: 0 }),
    });
    routed = applyEditorCommand(routed, {
      type: "add-connector", connector: createConnector("x2", "X2", 1, { x: 800, y: 0 }),
    });
    routed = applyEditorCommand(routed, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }),
    });
    const invalid = {
      ...routed,
      wires: routed.wires.map((wire) => ({
        ...wire,
        e4RouteMode: "manual",
        e4Route: [wire.e4Route[0]!, wire.e4Route[0]!],
      })),
    };

    const fetcher = vi.fn(async () => response({
      harnessId, schemaVersion: 1, revision: 9, content: invalid, updatedUtc: "2026-09-15T00:00:00Z",
    }));
    const loaded = await createHarnessDesignApi(config, session, fetcher).get(projectId, harnessId);

    expect(loaded.content.connectors).toHaveLength(2);
    expect(loaded.content.wires).toHaveLength(1);
    expect(loaded.content.wires[0]?.e4RouteMode).toBe("auto");
    expect(loaded.recoveryWarning).toMatch(/безопасном режиме/);
  });

  it("preserves valid manual routes while repairing only a malformed wire", () => {
    const x1 = createConnector("x1", "X1", 2, { x: 0, y: 0 });
    const x2 = createConnector("x2", "X2", 2, { x: 800, y: 0 });
    const routed = { ...createEmptyHarnessDesign(), connectors: [x1, x2], wires: [
      createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }),
      createWire("w2", { connectorId: "x1", contactId: "x1:contact:2" }, { connectorId: "x2", contactId: "x2:contact:2" }),
    ] };
    const baselineSource = {
      ...routed,
      wires: routed.wires.map(({ e4Route: _route, e4RouteMode: _mode, ...wire }) => wire),
    };
    const baseline = parseHarnessDesignDocument(baselineSource);
    const validManualRoute = baseline.wires[0]!.e4Route;
    const duplicatedPoint = baseline.wires[1]!.e4Route[0]!;
    const first = {
      ...createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }),
      e4RouteMode: "manual" as const,
      e4Route: validManualRoute,
    };
    const second = createWire("w2", { connectorId: "x1", contactId: "x1:contact:2" }, { connectorId: "x2", contactId: "x2:contact:2" });
    const invalid = {
      ...routed,
      wires: [
        first,
        {
          ...second,
          e4RouteMode: "manual",
          e4Route: [duplicatedPoint, duplicatedPoint],
        },
      ],
    };

    const recovered = parseRecoverableHarnessDesignContent(invalid);

    expect(recovered.content.wires[0]).toMatchObject({
      id: "w1",
      e4RouteMode: "manual",
      e4Route: validManualRoute,
    });
    expect(recovered.content.wires[1]?.e4RouteMode).toBe("auto");
    expect(recovered.content.wires[1]?.e4Route).not.toEqual(invalid.wires[1]?.e4Route);
    expect(recovered.warning).toMatch(/восстановлены автоматически/);
  });

  it("does not disguise structural document corruption as a routing recovery", () => {
    expect(() => parseRecoverableHarnessDesignContent({ ...content, connectors: "lost" }))
      .toThrow();
  });
});
