import { describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../runtime-config";
import { createComponentTemplateApi } from "./component-template-api";
import { newTemplateContent } from "./template-model";

const config = parseRuntimeConfig({ configVersion: 1, basePath: "/", apiBasePath: "/api/v1/", appVersion: "1", apiVersion: "1", schemaVersion: "7" });
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };
const templateId = "12345678-1234-4123-8123-123456789abc";
function detail(version = 1) {
  return { templateId, version, code: "JST-XH", name: "JST XH", articleBindings: [], assets: [], content: newTemplateContent(), createdUtc: "2026-09-14T00:00:00Z", updatedUtc: "2026-09-14T00:00:00Z" };
}

describe("component template API", () => {
  it("sends expectedVersion when saving an immutable version", async () => {
    let requestedUrl: RequestInfo | URL | undefined;
    let requestedInit: RequestInit | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = url; requestedInit = init;
      return new Response(JSON.stringify(detail(4)), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const api = createComponentTemplateApi(config, session, fetcher);
    const content = newTemplateContent();
    await api.save(templateId, { expectedVersion: 3, code: "JST-XH", name: "JST XH", articleBindings: [], content });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(requestedUrl).toBe(`/api/v1/component-templates/${templateId}`);
    expect(requestedInit?.method).toBe("PUT");
    expect(requestedInit?.headers).toMatchObject({ "X-Techmap-CSRF": session.csrfNonce });
    const body = JSON.parse(String(requestedInit?.body));
    expect(body).toMatchObject({ expectedVersion: 3, content: { schemaVersion: 1 } });
    expect(body.schemaVersion).toBeUndefined();
  });

  it("explains an optimistic version conflict", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "component_template_version_conflict", currentVersion: 7 }), { status: 409, headers: { "Content-Type": "application/json" } }));
    const api = createComponentTemplateApi(config, session, fetcher);
    await expect(api.save(templateId, { expectedVersion: 3, code: "A", name: "B", articleBindings: [], content: newTemplateContent() })).rejects.toThrow("актуальная версия 7");
  });

  it("uses the server message for validation errors", async () => {
    const api = createComponentTemplateApi(config, session, async () => new Response(JSON.stringify({ error: "invalid_component_template", message: "Вид drawing не найден." }), { status: 400, headers: { "Content-Type": "application/json" } }));
    await expect(api.create({ code: "A", name: "B", articleBindings: [], content: newTemplateContent() })).rejects.toThrow("Вид drawing не найден.");
  });

  it("loads compact list responses without requiring content", async () => {
    const item = detail();
    const { content: _content, ...summary } = item;
    const api = createComponentTemplateApi(config, session, async () => new Response(JSON.stringify({ items: [summary] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(api.list()).resolves.toMatchObject([{ templateId, code: "JST-XH", version: 1 }]);
  });

  it("uploads, reads and removes immutable image assets", async () => {
    const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      ...detail(2),
      assets: [{ assetId, sha256: "a".repeat(64), sizeBytes: 68, fileName: "contact.png", mediaType: "image/png" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const api = createComponentTemplateApi(config, session, fetcher);

    await expect(api.addAsset(templateId, {
      expectedVersion: 1,
      fileName: "contact.png",
      mediaType: "image/png",
      contentBase64: "iVBORw0KGgo=",
    })).resolves.toMatchObject({ version: 2, assets: [{ assetId, fileName: "contact.png" }] });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/component-templates/${templateId}/assets`);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ expectedVersion: 1, mediaType: "image/png" });
    expect(api.assetContentUrl(templateId, 2, assetId)).toBe(`/api/v1/component-templates/${templateId}/versions/2/assets/${assetId}/content`);

    await api.removeAsset(templateId, assetId, 2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/v1/component-templates/${templateId}/assets/${assetId}`);
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });
});
