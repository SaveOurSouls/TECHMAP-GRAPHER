import { describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../runtime-config";
import { createComponentPlacementApi } from "./component-placement-api";
import { createConnector } from "./commands";

const config = parseRuntimeConfig({ configVersion: 1, basePath: "/", apiBasePath: "/api/v1/", appVersion: "1", apiVersion: "1", schemaVersion: "15" });
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };

describe("component placement API", () => {
  it("places a materialized instance with one atomic revision change", async () => {
    let requestedUrl: RequestInfo | URL | undefined;
    let requestedInit: RequestInit | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = url;
      requestedInit = init;
      return new Response(JSON.stringify({
        commandId: "11111111-1111-4111-8111-111111111111",
        expectedRevision: 3,
        resultingRevision: 4,
        snapshot: { snapshotId: "22222222-2222-4222-8222-222222222222", projectId: "p" },
        placement: {
          placementId: "33333333-3333-4333-8333-333333333333",
          harnessId: "h",
          snapshotId: "22222222-2222-4222-8222-222222222222",
          instance: { id: "33333333-3333-4333-8333-333333333333" },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const api = createComponentPlacementApi(config, session, fetcher);
    const instance = createConnector("33333333-3333-4333-8333-333333333333", "X1", 1, { x: 1, y: 2 });

    await expect(api.place("p", "h", {
      commandId: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 3,
      placementId: instance.id,
      sourceTemplateId: "44444444-4444-4444-8444-444444444444",
      sourceVersion: 7,
      sourceId: "technology-database",
      entityType: "connector",
      articleKey: "B2B-XH-A",
      instance,
    })).resolves.toEqual({
      commandId: "11111111-1111-4111-8111-111111111111",
      resultingRevision: 4,
      snapshotId: "22222222-2222-4222-8222-222222222222",
    });
    expect(requestedUrl).toBe("/api/v1/projects/p/harnesses/h/component-placements");
    expect(requestedInit?.method).toBe("POST");
    expect(requestedInit?.headers).toMatchObject({ "X-Techmap-CSRF": session.csrfNonce });
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({ expectedRevision: 3, instance: { id: instance.id } });
  });

  it("surfaces an atomic placement revision conflict", async () => {
    const api = createComponentPlacementApi(config, session, async () => new Response(JSON.stringify({
      error: "design_revision_conflict",
      currentRevision: 6,
    }), { status: 409, headers: { "Content-Type": "application/json" } }));
    await expect(api.place("p", "h", {
      commandId: "11111111-1111-4111-8111-111111111111", expectedRevision: 3,
      placementId: "33333333-3333-4333-8333-333333333333",
      sourceTemplateId: "44444444-4444-4444-8444-444444444444", sourceVersion: 7,
      sourceId: "technology-database", entityType: "connector", articleKey: "B2B-XH-A",
      instance: createConnector("33333333-3333-4333-8333-333333333333", "X1", 1, { x: 0, y: 0 }),
    })).rejects.toMatchObject({ code: "design_revision_conflict", currentRevision: 6 });
  });

  it.each([
    ["an empty response", ""],
    ["invalid JSON", "{"],
  ])("rejects %s after a successful status", async (_name, content) => {
    const api = createComponentPlacementApi(config, session, async () => new Response(content, { status: 200 }));
    await expect(api.place("p", "h", request())).rejects.toThrow(/пустой или нечитаемый результат/);
  });

  it.each([
    ["a primitive envelope", null],
    ["a mismatched command", success({ commandId: "99999999-9999-4999-8999-999999999999" })],
    ["a stale expected revision", success({ expectedRevision: 2 })],
    ["an impossible resulting revision", success({ resultingRevision: 5 })],
    ["a missing snapshot", { ...success(), snapshot: undefined }],
    ["a malformed snapshot id", success({ snapshot: { snapshotId: "not-an-id", projectId: "p" } })],
    ["a missing placement", { ...success(), placement: undefined }],
    ["a different placement", success({ placement: placement({ placementId: "55555555-5555-4555-8555-555555555555" }) })],
    ["a placement using another snapshot", success({ placement: placement({ snapshotId: "55555555-5555-4555-8555-555555555555" }) })],
    ["a placement with another instance id", success({ placement: placement({ instance: { id: "55555555-5555-4555-8555-555555555555" } }) })],
  ])("rejects %s without accepting local history", async (_name, payload) => {
    const api = createComponentPlacementApi(config, session, async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(api.place("p", "h", request())).rejects.toThrow(/повреждённ|Поле ответа/);
  });

  it("falls back to the HTTP status for a malformed error response", async () => {
    const api = createComponentPlacementApi(config, session, async () => new Response("not json", { status: 503 }));
    await expect(api.place("p", "h", request())).rejects.toMatchObject({
      message: "Сервер не выполнил запрос (HTTP 503).",
      code: null,
      currentRevision: null,
    });
  });
});

function request() {
  const instance = createConnector("33333333-3333-4333-8333-333333333333", "X1", 1, { x: 0, y: 0 });
  return {
    commandId: "11111111-1111-4111-8111-111111111111",
    expectedRevision: 3,
    placementId: instance.id,
    sourceTemplateId: "44444444-4444-4444-8444-444444444444",
    sourceVersion: 7,
    sourceId: "technology-database",
    entityType: "connector",
    articleKey: "B2B-XH-A",
    instance,
  };
}

function success(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "11111111-1111-4111-8111-111111111111",
    expectedRevision: 3,
    resultingRevision: 4,
    snapshot: { snapshotId: "22222222-2222-4222-8222-222222222222", projectId: "p" },
    placement: placement(),
    ...overrides,
  };
}

function placement(overrides: Record<string, unknown> = {}) {
  return {
    placementId: "33333333-3333-4333-8333-333333333333",
    harnessId: "h",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    instance: { id: "33333333-3333-4333-8333-333333333333" },
    ...overrides,
  };
}
