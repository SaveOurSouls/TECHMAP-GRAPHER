import { describe, expect, it, vi } from "vitest";
import { DesignRecoverySession } from "./design-recovery-api";
import { createEmptyHarnessDesign } from "./model";

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
