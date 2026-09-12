import { describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../runtime-config";
import { createHarnessDesignApi, HarnessDesignApiError } from "./design-api";
import { createEmptyHarnessDesign } from "./model";

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
      body: JSON.stringify({ expectedRevision: 3, schemaVersion: 1, content }),
    }));
  });

  it("surfaces the current revision on a conflict", async () => {
    const fetcher = vi.fn(async () => response({ error: "design_revision_conflict", currentRevision: 7 }, 409));
    const api = createHarnessDesignApi(config, session, fetcher);
    const error = await api.save(projectId, harnessId, 2, content).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HarnessDesignApiError);
    expect(error).toMatchObject({ code: "design_revision_conflict", currentRevision: 7 });
  });
});
