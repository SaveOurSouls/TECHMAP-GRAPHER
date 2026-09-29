import { describe, expect, it, vi } from "vitest";
import { createDesignRecoveryApi, DesignRecoverySession } from "./design-recovery-api";
import { createEmptyHarnessDesign } from "./model";

it("sends recovery deletion with the sequence as a query after validating the API path", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  const api = createDesignRecoveryApi({
    configVersion: 1, basePath: "/", apiBasePath: "/api/v1/", appVersion: "test",
    apiVersion: "1", schemaVersion: "1",
  }, { csrfNonce: "csrf", instanceId: "instance" }, fetcher);
  await api.remove("project", "harness", "draft", 7);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/projects/project/harnesses/harness/design/recovery/draft?sequence=7",
    expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ "X-Techmap-CSRF": "csrf" }) }),
  );
});

it("removes only recovery copies explicitly archived by the restore action", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  const api = createDesignRecoveryApi({
    configVersion: 1, basePath: "/", apiBasePath: "/api/v1/", appVersion: "test",
    apiVersion: "1", schemaVersion: "1",
  }, { csrfNonce: "csrf", instanceId: "instance" }, fetcher);
  await expect(api.removeMany("project", "harness", [
    { draftId: "old", sequence: 2 }, { draftId: "current", sequence: 4 },
  ])).resolves.toEqual(["old", "current"]);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/projects/project/harnesses/harness/design/recovery/old?sequence=2",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/projects/project/harnesses/harness/design/recovery/current?sequence=4",
    expect.objectContaining({ method: "DELETE" }),
  );
});

describe("server recovery session", () => {
  it("serializes writes and deletes only the acknowledged generation", async () => {
    let release!: () => void;
    const order: string[] = [];
    const api = { list: vi.fn(), put: vi.fn(async (_p, _h, id, sequence) => {
      order.push(`put:${id}:${sequence}`);
      if (order.length === 1) await new Promise<void>(resolve => { release = resolve; });
    }), remove: vi.fn(async (_p, _h, id, sequence) => { order.push(`delete:${id}:${sequence}`); }) };
    const session = new DesignRecoverySession(api, "project", "harness");
    const content = createEmptyHarnessDesign();
    const first = session.write(1, content);
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = session.write(1, content);
    const cleared = session.clear();
    const third = session.write(2, content);
    release(); await Promise.all([first, second, cleared, third]);
    expect(order).toHaveLength(4);
    expect(api.remove.mock.calls[0]![3]).toBe(2);
    expect(api.put.mock.calls[0]![2]).toBe(api.put.mock.calls[1]![2]);
    expect(api.put.mock.calls[2]![2]).not.toBe(api.put.mock.calls[0]![2]);
  });
  it("surfaces a failed write and allows later retry without deleting archived conflicts", async () => {
    const api = { list: vi.fn(), put: vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined), remove: vi.fn() };
    const session = new DesignRecoverySession(api, "project", "harness");
    await expect(session.write(3, createEmptyHarnessDesign())).rejects.toThrow("disk full");
    await session.write(3, createEmptyHarnessDesign());
    session.preserve();
    await session.write(4, createEmptyHarnessDesign());
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.put.mock.calls[0]![2]).not.toBe(api.put.mock.calls[2]![2]);
  });
});
