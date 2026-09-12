import { describe, expect, it, vi } from "vitest";
import { createProjectApi, ProjectApiError, type ProjectDetails } from "./project-api";
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
  revision: 0,
  createdUtc: "2026-09-12T10:00:00Z",
  updatedUtc: "2026-09-12T10:00:00Z",
  harnesses: [{
    harnessId: "22345678-1234-4123-8123-123456789abc",
    designation: "ЖГ-01",
    quantity: 12,
    sortOrder: 0,
    documents: [
      { documentId: "42345678-1234-4123-8123-123456789abc", kind: "e4", status: "empty" },
      { documentId: "52345678-1234-4123-8123-123456789abc", kind: "drawing", status: "empty" },
      { documentId: "62345678-1234-4123-8123-123456789abc", kind: "route", status: "empty" },
    ],
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

  it("accepts the maximum exact legacy project quantity", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      projects: [{ ...details, harnessCount: 1, batchQuantity: Number.MAX_SAFE_INTEGER }],
    }));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.listProjects()).resolves.toEqual([
      expect.objectContaining({ batchQuantity: Number.MAX_SAFE_INTEGER }),
    ]);
  });

  it("protects mutations with the local session CSRF nonce", async () => {
    const envelope = {
      commandId: "32345678-1234-4123-8123-123456789abc",
      expectedRevision: 0,
    };
    const result = {
      ...envelope,
      resultingRevision: 1,
      project: { ...details, revision: 1 },
    };
    const fetcher = vi.fn(async () => jsonResponse(result));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.addHarness(details.projectId, envelope, { designation: "ЖГ-02", quantity: 7 }))
      .resolves.toEqual(result);

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
        body: JSON.stringify({ ...envelope, designation: "ЖГ-02", quantity: 7 }),
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
      status: "draft",
    })).rejects.toThrow("Обозначение уже существует.");
  });

  it("creates a project as a container without a project-wide quantity", async () => {
    const fetcher = vi.fn(async () => jsonResponse(details));
    const api = createProjectApi(config, session, fetcher);

    await api.createProject({ designation: "ПР-002", name: "Контейнер", status: "draft" });

    expect(fetcher).toHaveBeenCalledWith(
      "/techmap/api/v1/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ designation: "ПР-002", name: "Контейнер", status: "draft" }),
      }),
    );
  });

  it("exposes the current revision from a command conflict", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      error: "revision_conflict",
      message: "stale",
      currentRevision: 12,
    }, 409));
    const api = createProjectApi(config, session, fetcher);

    const error = await api.updateProject(details.projectId, {
      commandId: "32345678-1234-4123-8123-123456789abc",
      expectedRevision: 7,
    }, { name: "Конфликт" }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ProjectApiError);
    expect(error).toMatchObject({ code: "revision_conflict", currentRevision: 12 });
  });

  it("sends the command envelope in a harness delete body", async () => {
    const envelope = {
      commandId: "32345678-1234-4123-8123-123456789abc",
      expectedRevision: 4,
    };
    const fetcher = vi.fn(async () => jsonResponse({
      ...envelope,
      resultingRevision: 5,
      project: { ...details, revision: 5 },
    }));
    const api = createProjectApi(config, session, fetcher);

    await api.deleteHarness(details.projectId, details.harnesses[0]!.harnessId, envelope);

    expect(fetcher).toHaveBeenCalledWith(
      `/techmap/api/v1/projects/${details.projectId}/harnesses/${details.harnesses[0]!.harnessId}`,
      expect.objectContaining({ method: "DELETE", body: JSON.stringify(envelope) }),
    );
  });

  it("parses individual harness quantities and its three stable documents", async () => {
    const fetcher = vi.fn(async () => jsonResponse(details));
    const api = createProjectApi(config, session, fetcher);

    const project = await api.getProject(details.projectId);

    expect(project.harnesses[0]).toMatchObject({ designation: "ЖГ-01", quantity: 12 });
    expect(project.harnesses[0]?.documents.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: "e4", status: "empty" },
      { kind: "drawing", status: "empty" },
      { kind: "route", status: "empty" },
    ]);
  });

  it("rejects duplicate document identities in a harness", async () => {
    const duplicateId = details.harnesses[0]!.documents[0]!.documentId;
    const fetcher = vi.fn(async () => jsonResponse({
      ...details,
      harnesses: [{
        ...details.harnesses[0],
        documents: details.harnesses[0]!.documents.map((document) => ({
          ...document,
          documentId: duplicateId,
        })),
      }],
    }));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.getProject(details.projectId)).rejects.toThrow("Комплект документов");
  });

  it("rejects a harness quantity that cannot be represented exactly in the browser", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      ...details,
      harnesses: [{ ...details.harnesses[0], quantity: Number.MAX_SAFE_INTEGER + 1 }],
    }));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.getProject(details.projectId)).rejects.toThrow("quantity");
  });

  it("rejects a document identity reused by two harnesses", async () => {
    const first = details.harnesses[0]!;
    const secondDocuments = first.documents.map((document, index) => ({
      ...document,
      documentId: index === 0
        ? first.documents[0]!.documentId
        : `${index + 7}2345678-1234-4123-8123-123456789abc`,
    }));
    const fetcher = vi.fn(async () => jsonResponse({
      ...details,
      harnesses: [first, {
        ...first,
        harnessId: "72345678-1234-4123-8123-123456789abc",
        designation: "ЖГ-02",
        documents: secondDocuments,
      }],
    }));
    const api = createProjectApi(config, session, fetcher);

    await expect(api.getProject(details.projectId)).rejects.toThrow(
      "Идентификаторы документов проекта должны быть уникальны",
    );
  });

  it("updates only the selected harness quantity through its resource", async () => {
    const harness = details.harnesses[0]!;
    const envelope = {
      commandId: "32345678-1234-4123-8123-123456789abc",
      expectedRevision: 4,
    };
    const fetcher = vi.fn(async () => jsonResponse({
      ...envelope,
      resultingRevision: 5,
      project: {
        ...details,
        revision: 5,
        harnesses: [{ ...harness, quantity: 24 }],
      },
    }));
    const api = createProjectApi(config, session, fetcher);

    await api.updateHarness(details.projectId, harness.harnessId, envelope, { quantity: 24 });

    expect(fetcher).toHaveBeenCalledWith(
      `/techmap/api/v1/projects/${details.projectId}/harnesses/${harness.harnessId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ ...envelope, quantity: 24 }),
      }),
    );
  });
});
