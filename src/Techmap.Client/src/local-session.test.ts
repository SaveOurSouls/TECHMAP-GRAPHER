import { describe, expect, it, vi } from "vitest";
import { createMutationHeaders, loadLocalSession } from "./local-session";
import { parseRuntimeConfig } from "./runtime-config";

const config = parseRuntimeConfig({
  configVersion: 1,
  basePath: "/techmap/",
  apiBasePath: "/techmap/api/v1/",
  appVersion: "1.0.0",
  apiVersion: "1",
  schemaVersion: "0",
});

const session = {
  csrfNonce: "A".repeat(43),
  instanceId: "12345678-1234-4123-8123-123456789abc",
};

describe("local HTTP session", () => {
  it("loads the CSRF nonce through same-origin credentials and keeps the base path", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => session }));

    await expect(loadLocalSession(config, fetcher)).resolves.toEqual(session);
    expect(fetcher).toHaveBeenCalledWith("/techmap/api/v1/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it.each([
    null,
    {},
    { ...session, csrfNonce: "short" },
    { ...session, instanceId: "not-a-guid" },
  ])("rejects malformed session payload %#", async (value) => {
    await expect(loadLocalSession(
      config,
      async () => ({ ok: true, json: async () => value }),
    )).rejects.toThrow("повреждённую");
  });

  it("builds JSON mutation headers without a session token", () => {
    const headers = createMutationHeaders(session);

    expect(headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Techmap-CSRF": session.csrfNonce,
    });
    expect(JSON.stringify(headers)).not.toContain("Techmap.Session");
  });
});
