import { describe, expect, it, vi } from "vitest";
import type { ApiFetcher } from "./api-transport";
import { createProjectApi } from "./project-api";
import { createReferenceCatalogApi } from "./reference-catalog-api";
import { createHarnessDesignApi } from "./editor/design-api";
import { createHarnessCutListApi } from "./harness-cut-list-api";
import { parseRuntimeConfig } from "./runtime-config";

const config = parseRuntimeConfig({
  configVersion: 1, basePath: "/techmap/", apiBasePath: "/techmap/api/v1/",
  appVersion: "1", apiVersion: "1", schemaVersion: "9",
});
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };
const projectId = "22345678-1234-4123-8123-123456789abc";
const harnessId = "32345678-1234-4123-8123-123456789abc";

// Exercise the public adapters so transport changes cannot silently unify their policies.
const adapters = [
  {
    name: "projects", errorName: "Error", unreadable: "Сервер вернул нечитаемый ответ.",
    load: (fetcher: ApiFetcher) => createProjectApi(config, session, fetcher).listProjects(),
    validationName: "Error", validation: "Сервер вернул повреждённый список проектов.",
  },
  {
    name: "references", errorName: "ReferenceCatalogApiError", unreadable: "Сервер вернул нечитаемый ответ.",
    load: (fetcher: ApiFetcher) => createReferenceCatalogApi(config, session, fetcher).listSources(),
    validationName: "ReferenceCatalogApiError", validation: "Сервер вернул повреждённый список справочников.",
  },
  {
    name: "design", errorName: "HarnessDesignApiError", unreadable: "Сервер вернул нечитаемый документ жгута.",
    load: (fetcher: ApiFetcher) => createHarnessDesignApi(config, session, fetcher).get(projectId, harnessId),
    validationName: "Error", validation: "Сервер вернул повреждённый документ жгута.",
  },
  {
    name: "cut list", errorName: "HarnessCutListApiError", unreadable: "Сервер вернул нечитаемую карту резки.",
    load: (fetcher: ApiFetcher) => createHarnessCutListApi(config, session, fetcher).get(projectId, harnessId),
    validationName: "Error", validation: "Сервер вернул повреждённую карту резки.",
  },
];

it("calls an injected fetcher without changing its receiver", async () => {
  const fetcher: ApiFetcher = async function (this: unknown) {
    expect(this).toBeUndefined();
    return Response.json({ projects: [] });
  };
  await expect(createProjectApi(config, session, fetcher).listProjects()).resolves.toEqual([]);
});

describe.each(adapters)("transport compatibility: $name", adapter => {
  it("retains the adapter's network error and does not retry", async () => {
    const fetcher = vi.fn<ApiFetcher>().mockRejectedValue(new TypeError("offline"));
    await expect(adapter.load(fetcher)).rejects.toMatchObject({
      name: adapter.errorName, message: "Не удалось связаться с локальным сервером.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distinguishes unreadable JSON from a domain validation failure", async () => {
    await expect(adapter.load(async () => new Response("<html>failure</html>"))).rejects.toMatchObject({
      name: adapter.errorName, message: adapter.unreadable,
    });
    await expect(adapter.load(async () => Response.json(null))).rejects.toMatchObject({
      name: adapter.validationName, message: adapter.validation,
    });
  });

  it("retains the HTTP error fallback even when the response is not JSON", async () => {
    const fetcher = vi.fn<ApiFetcher>().mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(adapter.load(fetcher)).rejects.toMatchObject({
      message: adapter.name === "cut list"
        ? "Сервер не выполнил запрос карты резки (HTTP 503)."
        : "Сервер не выполнил запрос (HTTP 503).",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it("does not replay a mutation with an unknown server outcome", async () => {
  const fetcher = vi.fn<ApiFetcher>().mockRejectedValue(new TypeError("connection lost after send"));
  const api = createProjectApi(config, session, fetcher);
  const body = { designation: "ПР", name: "Проект", status: "draft" as const };
  await expect(api.createProject(body)).rejects.toThrow("Не удалось связаться");
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/techmap/api/v1/projects", expect.objectContaining({
    method: "POST", body: JSON.stringify(body), credentials: "same-origin", cache: "no-store",
    headers: expect.objectContaining({ "X-Techmap-CSRF": session.csrfNonce }),
  }));
});
