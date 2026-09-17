import { describe, expect, it, vi } from "vitest";
import { createHarnessCutListApi, HarnessCutListApiError, parseHarnessCutList } from "./harness-cut-list-api";
import { parseRuntimeConfig } from "./runtime-config";

const config = parseRuntimeConfig({
  configVersion: 1,
  basePath: "/techmap/",
  apiBasePath: "/techmap/api/v1/",
  appVersion: "1",
  apiVersion: "1",
  schemaVersion: "1",
});
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };
const projectId = "22345678-1234-4123-8123-123456789abc";
const harnessId = "32345678-1234-4123-8123-123456789abc";

function responseBody() {
  return {
    projectId,
    harnessId,
    harnessQuantity: 3,
    status: "limited",
    warning: "Материал провода не закреплён. Карта пока не является спецификацией материалов.",
    items: [{
      wireId: "W-1",
      circuit: "DATA+",
      material: "not-pinned",
      materialSourceKey: null,
      materialDisplayName: null,
      sourceLengthMm: 20.001,
      endCorrectionFromMm: -0.001,
      endCorrectionToMm: 0.002,
      roundingStepMm: 0.005,
      cutLengthMm: 20.005,
      pieces: 3,
      totalMetres: 0.060015,
      status: "ready",
      warnings: ["material-missing"],
    }, {
      wireId: "W-2",
      circuit: "",
      material: "not-pinned",
      materialSourceKey: null,
      materialDisplayName: null,
      sourceLengthMm: null,
      endCorrectionFromMm: 0,
      endCorrectionToMm: 0,
      roundingStepMm: 1,
      cutLengthMm: null,
      pieces: 3,
      totalMetres: null,
      status: "incomplete",
      warnings: ["material-missing", "length-missing"],
    }],
  };
}

describe("harness cut-list API", () => {
  it("gets and parses the limited cut list through runtime URL conventions", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(responseBody()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const api = createHarnessCutListApi(config, session, fetcher);

    await expect(api.get(projectId, harnessId)).resolves.toMatchObject({
      projectId,
      harnessId,
      harnessQuantity: 3,
      status: "limited",
      items: [
        { wireId: "W-1", cutLengthMm: 20.005, totalMetres: 0.060015, status: "ready" },
        { wireId: "W-2", sourceLengthMm: null, cutLengthMm: null, status: "incomplete" },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/techmap/api/v1/projects/${projectId}/harnesses/${harnessId}/cut-list`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("parses a complete pinned-material cut list", () => {
    const parsed = parseHarnessCutList({
      ...responseBody(), status: "ready", warning: "", items: [{
        ...responseBody().items[0], material: "UL1061 24AWG",
        materialSourceKey: "UL1061-24AWG", materialDisplayName: "UL1061 24AWG", warnings: [],
      }],
    }, projectId, harnessId);
    expect(parsed.status).toBe("ready");
    expect(parsed.items[0]).toMatchObject({
      materialSourceKey: "UL1061-24AWG", materialDisplayName: "UL1061 24AWG", warnings: [],
    });
  });

  it("rejects another harness, duplicate wires and inconsistent incomplete rows", () => {
    expect(() => parseHarnessCutList({ ...responseBody(), harnessId: projectId }, projectId, harnessId))
      .toThrow(/другому проекту или жгуту/);
    expect(() => parseHarnessCutList({
      ...responseBody(), items: [responseBody().items[0], responseBody().items[0]],
    }, projectId, harnessId)).toThrow(/повторяющиеся провода/);
    expect(() => parseHarnessCutList({
      ...responseBody(), items: [{ ...responseBody().items[1], status: "ready" }],
    }, projectId, harnessId)).toThrow(/не согласован/);
  });

  it("maps server errors and transport failures to readable client errors", async () => {
    const rejected = createHarnessCutListApi(config, session, async () => new Response(JSON.stringify({
      error: "harness_not_found",
      message: "missing",
    }), { status: 404, headers: { "Content-Type": "application/json" } }));
    const serverError = await rejected.get(projectId, harnessId).catch(error => error);
    expect(serverError).toBeInstanceOf(HarnessCutListApiError);
    expect(serverError).toMatchObject({ code: "harness_not_found", message: expect.stringMatching(/не найден/) });

    const offline = createHarnessCutListApi(config, session, async () => { throw new Error("offline"); });
    await expect(offline.get(projectId, harnessId)).rejects.toThrow(/локальным сервером/);
  });
});
