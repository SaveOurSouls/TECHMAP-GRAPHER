import { describe, expect, it } from "vitest";
import {
  RuntimeConfigError,
  buildApiUrl,
  buildRuntimeConfigUrl,
  loadRuntimeConfig,
  parseRuntimeConfig,
} from "./runtime-config";

const rootConfig = {
  configVersion: 1,
  basePath: "/",
  apiBasePath: "/api/v1/",
  appVersion: "1.0.0",
  apiVersion: "1",
  schemaVersion: "0",
};

describe("runtime config", () => {
  it.each([
    ["http://127.0.0.1:8762/assets/app.js", "http://127.0.0.1:8762/runtime-config.json"],
    ["http://127.0.0.1:8762/techmap/assets/app.js", "http://127.0.0.1:8762/techmap/runtime-config.json"],
  ])("finds runtime config relative to a production bundle", (moduleUrl, expected) => {
    expect(buildRuntimeConfigUrl(moduleUrl).href).toBe(expected);
  });

  it("builds a root-hosted API URL without an external origin", () => {
    const config = parseRuntimeConfig(rootConfig);
    expect(buildApiUrl(config, "health")).toBe("/api/v1/health");
  });

  it("keeps the application prefix in API URLs", () => {
    const config = parseRuntimeConfig({
      ...rootConfig,
      basePath: "/techmap/",
      apiBasePath: "/techmap/api/v1/",
    });
    expect(buildApiUrl(config, "/projects/")).toBe("/techmap/api/v1/projects");
  });

  it("reports unavailable config separately", () => {
    expect(() => parseRuntimeConfig(undefined)).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigError>>({ code: "CONFIG_UNAVAILABLE" }),
    );
  });

  it("reports an unavailable runtime config response", async () => {
    await expect(loadRuntimeConfig(
      new URL("http://localhost/runtime-config.json"),
      async () => ({ ok: false, json: async () => rootConfig }),
    )).rejects.toMatchObject({ code: "CONFIG_UNAVAILABLE" });
  });

  it("reports malformed runtime config JSON", async () => {
    await expect(loadRuntimeConfig(
      new URL("http://localhost/runtime-config.json"),
      async () => ({
        ok: true,
        json: async () => { throw new SyntaxError("bad json"); },
      }),
    )).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it.each([
    { ...rootConfig, basePath: "techmap/" },
    { ...rootConfig, basePath: "/techmap" },
    { ...rootConfig, apiBasePath: "/outside/api/v1/", basePath: "/techmap/" },
    { ...rootConfig, apiBasePath: "/api/v1/extra/" },
    { ...rootConfig, appVersion: "" },
  ])("rejects malformed config %#", (value) => {
    expect(() => parseRuntimeConfig(value)).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigError>>({ code: "CONFIG_INVALID" }),
    );
  });

  it("reports incompatible config and API versions", () => {
    expect(() => parseRuntimeConfig({ ...rootConfig, configVersion: 2 })).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigError>>({ code: "CONFIG_INCOMPATIBLE" }),
    );
    expect(() => parseRuntimeConfig({ ...rootConfig, apiVersion: "2" })).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigError>>({ code: "CONFIG_INCOMPATIBLE" }),
    );
  });

  it("does not allow an endpoint to escape the API base path", () => {
    const config = parseRuntimeConfig(rootConfig);
    expect(() => buildApiUrl(config, "../diagnostics")).toThrowError(
      expect.objectContaining<Partial<RuntimeConfigError>>({ code: "CONFIG_INVALID" }),
    );
  });
});
