import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DEBOUNCE_MILLISECONDS,
  AutosaveConflictError,
  AutosaveController,
  createPendingDraftMarkerStore,
  type AutosaveAcknowledgement,
  type AutosaveCommand,
  type KeyValueStorage,
} from "./autosave-controller";

interface ProjectDraft {
  readonly name: string;
  readonly batchQuantity: number;
  readonly status: string;
}

const firstCommandId = "12345678-1234-4123-8123-123456789abc";
const secondCommandId = "22345678-1234-4123-8123-123456789abc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function setup(
  send: (command: AutosaveCommand<ProjectDraft>) => Promise<AutosaveAcknowledgement>,
  storage = new MemoryStorage(),
) {
  const ids = [firstCommandId, secondCommandId];
  const controller = new AutosaveController<ProjectDraft>({
    initialRevision: 7,
    send,
    markerStore: createPendingDraftMarkerStore(storage, "project:alpha:pending"),
    createCommandId: () => ids.shift() ?? "32345678-1234-4123-8123-123456789abc",
  });
  return { controller, storage };
}

describe("autosave controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("merges draft edits and sends one UUID command after 1500 ms", async () => {
    const send = vi.fn(async () => ({ revision: 8 }));
    const { controller, storage } = setup(send);

    controller.edit({ name: "Проект А" });
    await vi.advanceTimersByTimeAsync(900);
    controller.edit({ batchQuantity: 20 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MILLISECONDS - 1);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      commandId: firstCommandId,
      expectedRevision: 7,
      draft: { name: "Проект А", batchQuantity: 20 },
    });
    expect(controller.snapshot).toMatchObject({
      status: "acknowledged",
      revision: 8,
      hasPendingDraft: false,
      commandInFlight: false,
    });
    expect(storage.values.size).toBe(0);
  });

  it("allows one command in flight and sends only the latest merged draft afterward", async () => {
    const first = deferred<AutosaveAcknowledgement>();
    const second = deferred<AutosaveAcknowledgement>();
    const send = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { controller } = setup(send);

    controller.edit({ name: "Версия 1" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MILLISECONDS);
    expect(send).toHaveBeenCalledTimes(1);

    controller.edit({ name: "Версия 2" });
    controller.edit({ name: "Версия 3", status: "active" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MILLISECONDS * 2);
    expect(send).toHaveBeenCalledTimes(1);

    first.resolve({ revision: 8 });
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({
      commandId: secondCommandId,
      expectedRevision: 8,
      draft: { name: "Версия 3", status: "active" },
    });
    expect(controller.snapshot).toMatchObject({ status: "pending", commandInFlight: true });

    second.resolve({ revision: 9 });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.snapshot).toMatchObject({ status: "acknowledged", revision: 9 });
  });

  it("does not mark a command durable until its server response arrives", async () => {
    const response = deferred<AutosaveAcknowledgement>();
    const { controller, storage } = setup(() => response.promise);

    controller.edit({ name: "Ожидает сервера" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MILLISECONDS);

    expect(controller.snapshot).toMatchObject({
      status: "pending",
      revision: 7,
      hasPendingDraft: true,
      commandInFlight: true,
    });
    expect(storage.values.size).toBe(1);

    response.resolve({ revision: 8 });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.snapshot).toMatchObject({
      status: "acknowledged",
      revision: 8,
      hasPendingDraft: false,
    });
  });

  it("retains a failed draft and distinguishes conflict from other errors", async () => {
    const conflictSend = vi.fn(async () => {
      throw new AutosaveConflictError("Текущая ревизия — 11.");
    });
    const { controller } = setup(conflictSend);
    controller.edit({ name: "Конфликтный черновик" });

    await controller.flush();

    expect(controller.snapshot).toMatchObject({
      status: "conflict",
      revision: 7,
      hasPendingDraft: true,
      message: "Текущая ревизия — 11.",
    });
    controller.resumeAtRevision(11);
    expect(controller.snapshot.status).toBe("pending");

    const networkSend = vi.fn(async () => {
      throw new Error("Сеть недоступна.");
    });
    const other = setup(networkSend).controller;
    other.edit({ batchQuantity: 30 });
    await other.flush();
    expect(other.snapshot).toMatchObject({
      status: "error",
      hasPendingDraft: true,
      message: "Сеть недоступна.",
    });
  });

  it("reports an unacknowledged draft on unload and after restart", () => {
    const storage = new MemoryStorage();
    const first = setup(async () => ({ revision: 8 }), storage).controller;
    first.edit({ name: "Может потеряться" });

    expect(first.snapshot.unloadWarning).toContain("не подтвердил");
    first.dispose();

    const restarted = setup(async () => ({ revision: 8 }), storage).controller;
    expect(restarted.snapshot).toMatchObject({
      status: "error",
      interruptedDraft: true,
      hasPendingDraft: false,
    });
    expect(restarted.snapshot.message).toContain("мог быть потерян");
    expect(restarted.snapshot.unloadWarning).not.toBeNull();

    restarted.discardPendingDraft();
    expect(restarted.snapshot).toMatchObject({
      status: "acknowledged",
      interruptedDraft: false,
      unloadWarning: null,
    });
  });

  it("replays the exact failed command and saves later edits with a new ID after ack", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("Временный сбой"))
      .mockResolvedValueOnce({ revision: 8 })
      .mockResolvedValueOnce({ revision: 9 });
    const { controller } = setup(send);
    controller.edit({ status: "completed" });
    await controller.flush();

    controller.edit({ name: "Новая правка после сбоя" });
    expect(send).toHaveBeenCalledTimes(1);

    controller.retry();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MILLISECONDS);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(call => call[0].commandId)).toEqual([firstCommandId, firstCommandId]);
    expect(send.mock.calls.map(call => call[0].expectedRevision)).toEqual([7, 7]);
    expect(send.mock.calls[1]?.[0].draft).toEqual({ status: "completed" });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MILLISECONDS);
    expect(send.mock.calls[2]?.[0]).toEqual({
      commandId: secondCommandId,
      expectedRevision: 8,
      draft: { name: "Новая правка после сбоя" },
    });
    expect(controller.snapshot).toMatchObject({ status: "acknowledged", revision: 9 });
  });
});
