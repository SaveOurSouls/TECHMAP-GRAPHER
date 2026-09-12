import { createMutationHeaders, type LocalSession } from "./local-session";
import { buildApiUrl, type RuntimeConfig } from "./runtime-config";

export type ProjectStatus = "draft" | "active" | "completed";

export interface ProjectSummary {
  readonly projectId: string;
  readonly designation: string;
  readonly increment: number;
  readonly name: string;
  readonly batchQuantity: number;
  readonly status: ProjectStatus;
  readonly revision: number;
  readonly harnessCount: number;
  readonly createdUtc: string;
  readonly updatedUtc: string;
}

export interface HarnessSummary {
  readonly harnessId: string;
  readonly designation: string;
  readonly sortOrder: number;
  readonly createdUtc: string;
  readonly updatedUtc: string;
}

export interface ProjectDetails extends Omit<ProjectSummary, "harnessCount"> {
  readonly harnesses: readonly HarnessSummary[];
}

export interface CreateProjectRequest {
  readonly designation: string;
  readonly name: string;
  readonly batchQuantity: number;
  readonly status: ProjectStatus;
}

export interface UpdateProjectRequest {
  readonly name?: string;
  readonly batchQuantity?: number;
  readonly status?: ProjectStatus;
}

export interface ProjectCommandEnvelope {
  readonly commandId: string;
  readonly expectedRevision: number;
}

export interface ProjectCommandResult {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly project: ProjectDetails;
}

export interface ProjectApi {
  listProjects(): Promise<readonly ProjectSummary[]>;
  getProject(projectId: string): Promise<ProjectDetails>;
  createProject(request: CreateProjectRequest): Promise<ProjectDetails>;
  updateProject(
    projectId: string,
    envelope: ProjectCommandEnvelope,
    request: UpdateProjectRequest,
  ): Promise<ProjectCommandResult>;
  copyProject(projectId: string): Promise<ProjectDetails>;
  addHarness(
    projectId: string,
    envelope: ProjectCommandEnvelope,
    designation: string,
  ): Promise<ProjectCommandResult>;
  deleteHarness(
    projectId: string,
    harnessId: string,
    envelope: ProjectCommandEnvelope,
  ): Promise<ProjectCommandResult>;
}

export class ProjectApiError extends Error {
  readonly code: string | null;
  readonly currentRevision: number | null;

  constructor(message: string, code: string | null = null, currentRevision: number | null = null) {
    super(message);
    this.name = "ProjectApiError";
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

type ProjectFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const statuses = new Set<ProjectStatus>(["draft", "active", "completed"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const apiErrorMessages: Readonly<Record<string, string>> = {
  invalid_designation: "Проверьте обозначение: поле не заполнено или содержит недопустимое значение.",
  invalid_name: "Проверьте название проекта.",
  invalid_batch_quantity: "Количество в партии должно быть положительным целым числом.",
  invalid_status: "Выбран неизвестный статус проекта.",
  invalid_request: "Запрос не содержит изменений.",
  project_not_found: "Проект не найден. Обновите список проектов.",
  harness_not_found: "Жгут не найден. Обновите карточку проекта.",
  harness_limit_reached: "В проекте уже создано максимально допустимое количество жгутов.",
  invalid_session: "Локальная сессия завершена. Перезапустите приложение.",
  revision_conflict: "Проект изменился после открытия. Обновите карточку перед повторной отправкой.",
  command_id_reused: "Этот идентификатор команды уже использован для другой операции.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string, minimum: number): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`Поле ответа «${key}» задано неверно.`);
  }
  return value as number;
}

function parseStatus(value: unknown): ProjectStatus {
  if (typeof value !== "string" || !statuses.has(value as ProjectStatus)) {
    throw new Error("Поле ответа «status» задано неверно.");
  }
  return value as ProjectStatus;
}

function parseProjectSummary(value: unknown): ProjectSummary {
  if (!isRecord(value)) throw new Error("Сервер вернул повреждённые данные проекта.");
  const projectId = requireString(value, "projectId");
  if (!uuidPattern.test(projectId)) throw new Error("Поле ответа «projectId» задано неверно.");
  return Object.freeze({
    projectId,
    designation: requireString(value, "designation"),
    increment: requireInteger(value, "increment", 1),
    name: requireString(value, "name"),
    batchQuantity: requireInteger(value, "batchQuantity", 1),
    status: parseStatus(value.status),
    revision: requireInteger(value, "revision", 0),
    harnessCount: requireInteger(value, "harnessCount", 0),
    createdUtc: requireString(value, "createdUtc"),
    updatedUtc: requireString(value, "updatedUtc"),
  });
}

function parseHarness(value: unknown): HarnessSummary {
  if (!isRecord(value)) throw new Error("Сервер вернул повреждённые данные жгута.");
  const harnessId = requireString(value, "harnessId");
  if (!uuidPattern.test(harnessId)) throw new Error("Поле ответа «harnessId» задано неверно.");
  return Object.freeze({
    harnessId,
    designation: requireString(value, "designation"),
    sortOrder: requireInteger(value, "sortOrder", 0),
    createdUtc: requireString(value, "createdUtc"),
    updatedUtc: requireString(value, "updatedUtc"),
  });
}

function parseProjectDetails(value: unknown): ProjectDetails {
  if (!isRecord(value) || !Array.isArray(value.harnesses)) {
    throw new Error("Сервер вернул повреждённые данные проекта.");
  }
  const projectId = requireString(value, "projectId");
  if (!uuidPattern.test(projectId)) throw new Error("Поле ответа «projectId» задано неверно.");
  return Object.freeze({
    projectId,
    designation: requireString(value, "designation"),
    increment: requireInteger(value, "increment", 1),
    name: requireString(value, "name"),
    batchQuantity: requireInteger(value, "batchQuantity", 1),
    status: parseStatus(value.status),
    revision: requireInteger(value, "revision", 0),
    createdUtc: requireString(value, "createdUtc"),
    updatedUtc: requireString(value, "updatedUtc"),
    harnesses: Object.freeze(value.harnesses.map(parseHarness)),
  });
}

function parseProjectList(value: unknown): readonly ProjectSummary[] {
  if (!isRecord(value) || !Array.isArray(value.projects)) {
    throw new Error("Сервер вернул повреждённый список проектов.");
  }
  return Object.freeze(value.projects.map(parseProjectSummary));
}

function parseCommandResult(
  value: unknown,
  requested: ProjectCommandEnvelope,
): ProjectCommandResult {
  if (!isRecord(value)) throw new Error("Сервер вернул повреждённый результат команды.");
  const commandId = requireString(value, "commandId");
  const expectedRevision = requireInteger(value, "expectedRevision", 0);
  const resultingRevision = requireInteger(value, "resultingRevision", 1);
  const project = parseProjectDetails(value.project);
  if (
    !uuidPattern.test(commandId) ||
    commandId.toLocaleLowerCase() !== requested.commandId.toLocaleLowerCase() ||
    expectedRevision !== requested.expectedRevision ||
    resultingRevision !== project.revision ||
    resultingRevision <= expectedRevision
  ) {
    throw new Error("Сервер вернул несогласованный результат команды.");
  }
  return Object.freeze({ commandId, expectedRevision, resultingRevision, project });
}

async function responseError(response: Response): Promise<ProjectApiError> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const code = typeof body.error === "string" ? body.error : null;
      const currentRevision = Number.isSafeInteger(body.currentRevision) &&
        (body.currentRevision as number) >= 0
        ? body.currentRevision as number
        : null;
      const knownMessage = typeof body.error === "string" ? apiErrorMessages[body.error] : undefined;
      if (knownMessage) {
        return new ProjectApiError(knownMessage, code, currentRevision);
      }
      if (typeof body.detail === "string" && body.detail.trim() !== "") {
        return new ProjectApiError(body.detail, code, currentRevision);
      }
      if (typeof body.message === "string" && body.message.trim() !== "") {
        return new ProjectApiError(body.message, code, currentRevision);
      }
      if (typeof body.title === "string" && body.title.trim() !== "") {
        return new ProjectApiError(body.title, code, currentRevision);
      }
    }
  } catch {
    // The status-based message below also covers non-JSON error responses.
  }
  if (response.status === 404) return new ProjectApiError("Запрошенный проект или жгут не найден.");
  if (response.status === 409) return new ProjectApiError("Изменение конфликтует с текущими данными. Обновите список и повторите попытку.");
  return new ProjectApiError(`Сервер не выполнил запрос (HTTP ${response.status}).`);
}

export function createProjectApi(
  config: RuntimeConfig,
  session: LocalSession,
  fetcher: ProjectFetcher = fetch,
): ProjectApi {
  const mutationHeaders = createMutationHeaders(session);

  async function request<T>(
    resource: string,
    init: RequestInit,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(buildApiUrl(config, resource), {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
      });
    } catch {
      throw new Error("Не удалось связаться с локальным сервером.");
    }
    if (!response.ok) throw await responseError(response);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error("Сервер вернул нечитаемый ответ.");
    }
    return parse(data);
  }

  const projectResource = (projectId: string): string => `projects/${encodeURIComponent(projectId)}`;

  return Object.freeze({
    listProjects: () => request("projects", {
      method: "GET",
      headers: { Accept: "application/json" },
    }, parseProjectList),
    getProject: (projectId: string) => request(projectResource(projectId), {
      method: "GET",
      headers: { Accept: "application/json" },
    }, parseProjectDetails),
    createProject: (body: CreateProjectRequest) => request("projects", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify(body),
    }, parseProjectDetails),
    updateProject: (
      projectId: string,
      envelope: ProjectCommandEnvelope,
      body: UpdateProjectRequest,
    ) => request(projectResource(projectId), {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({ ...envelope, ...body }),
    }, value => parseCommandResult(value, envelope)),
    copyProject: (projectId: string) => request(`${projectResource(projectId)}/copies`, {
      method: "POST",
      headers: mutationHeaders,
    }, parseProjectDetails),
    addHarness: (
      projectId: string,
      envelope: ProjectCommandEnvelope,
      designation: string,
    ) => request(`${projectResource(projectId)}/harnesses`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ ...envelope, designation }),
    }, value => parseCommandResult(value, envelope)),
    deleteHarness: (
      projectId: string,
      harnessId: string,
      envelope: ProjectCommandEnvelope,
    ) => request(
      `${projectResource(projectId)}/harnesses/${encodeURIComponent(harnessId)}`,
      { method: "DELETE", headers: mutationHeaders, body: JSON.stringify(envelope) },
      value => parseCommandResult(value, envelope),
    ),
  });
}
