import { createMutationHeaders, type LocalSession } from "../local-session";
import { buildApiUrl, type RuntimeConfig } from "../runtime-config";
import type { TemplateContent } from "./template-model";

export interface ArticleBinding { readonly sourceId: string; readonly entityType: string; readonly articleKey: string; }
export interface ComponentTemplateSummary {
  readonly templateId: string; readonly version: number; readonly code: string; readonly name: string;
  readonly articleBindings: readonly ArticleBinding[]; readonly createdUtc: string; readonly updatedUtc?: string;
}
export interface ComponentTemplate extends ComponentTemplateSummary { readonly content: TemplateContent; }
export interface ComponentTemplateApi {
  list(): Promise<readonly ComponentTemplateSummary[]>;
  get(templateId: string): Promise<ComponentTemplate>;
  create(body: { code: string; name: string; articleBindings: ArticleBinding[]; content: TemplateContent }): Promise<ComponentTemplate>;
  save(templateId: string, body: { expectedVersion: number; code: string; name: string; articleBindings: ArticleBinding[]; content: TemplateContent }): Promise<ComponentTemplate>;
  remove(templateId: string, expectedVersion: number): Promise<void>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Сервер вернул повреждённый шаблон компонента.");
  return value as Record<string, unknown>;
}
function stringField(r: Record<string, unknown>, key: string): string {
  if (typeof r[key] !== "string") throw new Error(`Поле ответа «${key}» задано неверно.`);
  return r[key] as string;
}
function integerField(r: Record<string, unknown>, key: string): number {
  if (!Number.isSafeInteger(r[key]) || Number(r[key]) < 0) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return Number(r[key]);
}
function parseBinding(value: unknown): ArticleBinding {
  const r = record(value);
  return Object.freeze({ sourceId: stringField(r, "sourceId"), entityType: stringField(r, "entityType"), articleKey: stringField(r, "articleKey") });
}
function parseTemplate(value: unknown): ComponentTemplate {
  const r = record(value);
  const templateId = stringField(r, "templateId");
  if (!idPattern.test(templateId)) throw new Error("Поле ответа «templateId» задано неверно.");
  const bindings = Array.isArray(r.articleBindings) ? r.articleBindings.map(parseBinding) : [];
  const content = record(r.content) as unknown as TemplateContent;
  if (content.schemaVersion !== 1 || !Array.isArray(content.views)) throw new Error("Шаблон имеет неподдерживаемую схему содержимого.");
  return Object.freeze({ templateId, version: integerField(r, "version"), code: stringField(r, "code"), name: stringField(r, "name"), articleBindings: bindings, content, createdUtc: stringField(r, "createdUtc"), updatedUtc: typeof r.updatedUtc === "string" ? r.updatedUtc : undefined });
}
function parseList(value: unknown): readonly ComponentTemplateSummary[] {
  const r = record(value);
  if (!Array.isArray(r.items)) throw new Error("Сервер вернул повреждённый список шаблонов.");
  return r.items.map(item => {
    const parsed = parseTemplate({ ...record(item), content: { schemaVersion: 1, views: [] } });
    return { templateId: parsed.templateId, version: parsed.version, code: parsed.code, name: parsed.name, articleBindings: parsed.articleBindings, createdUtc: parsed.createdUtc, updatedUtc: parsed.updatedUtc };
  });
}

export function createComponentTemplateApi(config: RuntimeConfig, session: LocalSession, fetcher: Fetcher = fetch): ComponentTemplateApi {
  const headers = createMutationHeaders(session);
  async function request<T>(path: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
    let response: Response;
    try { response = await fetcher(buildApiUrl(config, `component-templates${path}`), { credentials: "same-origin", cache: "no-store", ...init }); }
    catch { throw new Error("Не удалось связаться с локальным сервером."); }
    if (!response.ok) {
      let detail = `Сервер не выполнил запрос (HTTP ${response.status}).`;
      try { const body = record(await response.json()); if (body.error === "component_template_version_conflict") detail = `Шаблон уже изменён (актуальная версия ${String(body.currentVersion ?? "?")}). Обновите его перед сохранением.`; else if (typeof body.message === "string" && body.message.trim()) detail = body.message; } catch { /* status fallback */ }
      throw new Error(detail);
    }
    if (response.status === 204) return undefined as T;
    return parse(await response.json());
  }
  const api: ComponentTemplateApi = {
    list: () => request("", { method: "GET", headers: { Accept: "application/json" } }, parseList),
    get: id => request(`/${encodeURIComponent(id)}`, { method: "GET", headers: { Accept: "application/json" } }, parseTemplate),
    create: body => request("", { method: "POST", headers, body: JSON.stringify(body) }, parseTemplate),
    save: (id, body) => request(`/${encodeURIComponent(id)}`, { method: "PUT", headers, body: JSON.stringify(body) }, parseTemplate),
    remove: async (id, expectedVersion) => { await request(`/${encodeURIComponent(id)}`, { method: "DELETE", headers, body: JSON.stringify({ expectedVersion }) }, () => undefined); },
  };
  return Object.freeze(api);
}
