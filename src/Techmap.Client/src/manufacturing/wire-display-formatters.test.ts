import { expect, it } from "vitest";
import { formatWireMaterial, formatWireName, formatWireTerminalPair } from "./wire-display-formatters";

it("keeps technical wire IDs out of operator-facing names", () => {
  expect(formatWireName("UL1007")).toBe("Провод UL1007");
  expect(formatWireName("62493d29-ce90-4b47-8c2a-2f66baea20cc")).toBe("Провод");
  expect(formatWireName("UL1007 · 62493d29-ce90-4b47-8c2a-2f66baea20cc")).toBe("Провод UL1007");
});

it("joins only populated material properties and terminal details", () => {
  expect(formatWireMaterial("UL1007", "28AWG", "Красный")).toBe("UL1007 · 28AWG · Красный");
  expect(formatWireTerminalPair("SXH-002T-P0.6", "SXH-002T-P0.6")).toBe("SXH-002T-P0.6 - SXH-002T-P0.6");
  expect(formatWireTerminalPair("TERM-A / SEAL-A", "SEAL-B / TERM-B")).toBe("TERM-A / SEAL-A - SEAL-B / TERM-B");
});
