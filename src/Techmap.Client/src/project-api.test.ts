import { describe, expect, it, vi } from "vitest";
import { createProjectApi, type ProjectDetails } from "./project-api";
import { parseRuntimeConfig } from "./runtime-config";

const config = parseRuntimeConfig({
  configVersion: 1,
  basePath: "/techmap/",
  apiBasePath: "/techmap/api/v1/",
  appVersion: "1.0.0",
  apiVersion: "1",
  schemaVersion: "2",
});
const session = {
  csrfNonce: "A".repeat(43),
  instanceId: "12345678-1234-4123-8123-123456789abc",
};
const details: ProjectDetails = {
  projectId: "12345678-1234-4123-8123-123456789abc",
  designation: "ПР-001",
  increment: 1,
  name: "Основной проект",
  batchQuantity: 20,
  status: "active",
  createdUtc: "2026-09-12T10:00:00Z",
  updatedUtc: "2026-09-12T10:00:00Z",
  harnesses: [{
    harnessId: "22345678-1234-4123-8123-123456789abc",
    designation: "ЖГ-01",
    sortOrder: 0,
    createdUtc: "2026-09-12T10:00:00Z",
    updatedUtc: "2026-09-12T10:00:00Z",
  }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("project API", () => {
  it("loads projects through the configured base path", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ projects: [{ ...details, harnessCount: 1 }] }));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.listProjects()).resolves.toEqual([expect.objectContaining({
      projectId: details.projectId,
      designation: "ПР-001",
    })]);
    expect(fetcher).toHaveBeenCalledWith("/techmap/api/v1/projects", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("protects mutations with the local session CSRF nonce", async () => {
    const fetcher = vi.fn(async () => jsonResponse(details));
    const api = createProjectApi(config, session, fetcher);

    await api.addHarness(details.projectId, "ЖГ-02");

    expect(fetcher).toHaveBeenCalledWith(
      `/techmap/api/v1/projects/${details.projectId}/harnesses`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Techmap-CSRF": session.csrfNonce,
        },
        body: JSON.stringify({ designation: "ЖГ-02" }),
      }),
    );
  });

  it("rejects malformed project data instead of placing it in UI state", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      projects: [{ ...details, harnessCount: 1, batchQuantity: 0 }],
    }));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.listProjects()).rejects.toThrow("batchQuantity");
  });

  it("uses the server problem detail for a failed operation", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      error: "business_rule",
      field: "designation",
      message: "Обозначение уже существует.",
    }, 409));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.createProject({
      designation: "ПР-001",
      name: "Дубликат",
      batchQuantity: 1,
      status: "draft",
    })).rejects.toThrow("Обозначение уже существует.");
  });
});
