import { createLazyWorkspace } from "../lazy-workspace";

export async function loadHarnessEditor() {
  const module = await import("./HarnessDesignEditorSurface");
  return { default: module.HarnessDesignEditor };
}

export const LazyHarnessDesignEditor = createLazyWorkspace(loadHarnessEditor, "Открываем редактор…");
