import { expect, it } from "vitest";
import * as commands from "./commands";
import { applyEditorCommand } from "./editor-command-dispatcher";
import { createConnector, createWire } from "./editor-command-factories";
import { e4RoutingIssues, normalizeE4RoutingDocument } from "./command-e4-routing";

it("preserves the complete public command facade without exposing unchecked handlers", () => {
  expect({ ...commands }).toEqual({ applyEditorCommand, createConnector, createWire, e4RoutingIssues, normalizeE4RoutingDocument });
});
