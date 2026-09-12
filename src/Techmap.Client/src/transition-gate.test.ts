import { describe, expect, it } from "vitest";
import { TransitionGate } from "./transition-gate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("transition gate", () => {
  it("blocks edit and create actions synchronously for the full delayed transition", async () => {
    const response = deferred<string>();
    const gate = new TransitionGate();
    let selectedProject = "first";
    let editedName = "Исходное имя";
    let createdProjects = 0;

    const open = async () => {
      const token = gate.begin();
      const project = await response.promise;
      if (gate.isCurrent(token)) selectedProject = project;
      gate.finish(token);
    };

    const opening = open();
    if (gate.allowMutation()) editedName = "Несохранённая правка";
    if (gate.allowMutation()) createdProjects += 1;

    expect(gate.isBlocked).toBe(true);
    expect(editedName).toBe("Исходное имя");
    expect(createdProjects).toBe(0);

    response.resolve("second");
    await opening;

    expect(selectedProject).toBe("second");
    expect(gate.isBlocked).toBe(false);
    expect(gate.allowMutation()).toBe(true);
  });

  it("lets only the newest delayed transition apply data and release the gate", async () => {
    const gate = new TransitionGate();
    const firstResponse = deferred<string>();
    const secondResponse = deferred<string>();
    let selectedProject: string | null = null;

    const first = gate.begin();
    const firstOpening = firstResponse.promise.then((project) => {
      if (gate.isCurrent(first)) selectedProject = project;
      return gate.finish(first);
    });
    const second = gate.begin();
    const secondOpening = secondResponse.promise.then((project) => {
      if (gate.isCurrent(second)) selectedProject = project;
      return gate.finish(second);
    });

    expect(gate.isCurrent(first)).toBe(false);
    firstResponse.resolve("stale-project");
    expect(await firstOpening).toBe(false);
    expect(selectedProject).toBeNull();
    expect(gate.isBlocked).toBe(true);

    expect(gate.isCurrent(second)).toBe(true);
    secondResponse.resolve("current-project");
    expect(await secondOpening).toBe(true);
    expect(selectedProject).toBe("current-project");
    expect(gate.isBlocked).toBe(false);
  });

  it("invalidates a delayed transition so it cannot reopen a closed project", async () => {
    const response = deferred<string>();
    const gate = new TransitionGate();
    let selectedProject: string | null = null;
    const token = gate.begin();
    const opening = response.promise.then((project) => {
      if (gate.isCurrent(token)) selectedProject = project;
      gate.finish(token);
    });

    gate.invalidate();
    response.resolve("late-project");
    await opening;

    expect(selectedProject).toBeNull();
    expect(gate.isBlocked).toBe(false);
    expect(gate.finish(token)).toBe(false);
  });
});
