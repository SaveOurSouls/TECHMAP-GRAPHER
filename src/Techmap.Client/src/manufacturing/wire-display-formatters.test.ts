import { expect, it } from "vitest";
import { formatWireColorIndicator, formatWireMaterial, formatWireName, formatWireTerminalPair } from "./wire-display-formatters";

it("keeps technical wire IDs out of operator-facing names", () => {
  expect(formatWireName("UL1007")).toBe("Провод UL1007");
  expect(formatWireName("62493d29-ce90-4b47-8c2a-2f66baea20cc")).toBe("Провод");
  expect(formatWireName("UL1007 · 62493d29-ce90-4b47-8c2a-2f66baea20cc")).toBe("Провод UL1007");
});

it("joins only populated material properties and terminal details", () => {
  expect(formatWireMaterial("UL1007 · 28AWG", "28AWG", "Красный")).toBe("UL1007 · 28AWG · Красный");
  expect(formatWireTerminalPair("SXH-002T-P0.6", "SXH-002T-P0.6")).toBe("SXH-002T-P0.6 - SXH-002T-P0.6");
  expect(formatWireTerminalPair("TERM-A / SEAL-A", "SEAL-B / TERM-B")).toBe("TERM-A / SEAL-A - SEAL-B / TERM-B");
});

it("builds a palette backed one or two color indicator", () => {
  expect(formatWireColorIndicator("красный")).toMatchObject({ known: true, primary: "#D32F2F", secondary: null, background: "#D32F2F" });
  expect(formatWireColorIndicator("красный", "черный").background).toBe("linear-gradient(225deg, #D32F2F 0 49%, #8da0aa 49% 51%, #202124 51% 100%)");
  expect(formatWireColorIndicator("неизвестный")).toMatchObject({ known: false, background: "#D9E2E7" });
});
