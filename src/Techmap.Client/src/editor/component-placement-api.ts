import { createMutationHeaders, type LocalSession } from "../local-session";
import { buildApiUrl, type RuntimeConfig } from "../runtime-config";
import { HarnessDesignApiError } from "./design-api";
import type { ConnectorInstance } from "./model";

export interface PlaceComponentRequest {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly placementId: string;
  readonly sourceTemplateId: string;
  readonly sourceVersion: number;
  readonly sourceId: string;
  readonly entityType: string;
  readonly articleKey: string;
  readonly instance: ConnectorInstance;
}

export interface ComponentPlacementResult {
  readonly commandId: string;
  readonly resultingRevision: number;
  readonly snapshotId: string;
}

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createComponentPlacementApi(
  config: RuntimeConfig,
  session: LocalSession,
  fetcher: Fetcher = fetch,
) {
  const headers = createMutationHeaders(session);
  return {
    async place(projectId: string, harnessId: string, body: PlaceComponentRequest): Promise<ComponentPlacementResult> {
      let response: Response;
      try {
        response = await fetcher(buildApiUrl(config,
          `projects/${encodeURIComponent(projectId)}/harnesses/${encodeURIComponent(harnessId)}/component-placements`), {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers,
          body: JSON.stringify(body),
        });
      } catch {
        throw new HarnessDesignApiError("Не удалось связаться с локальным сервером.", null, null);
      }
      if (!response.ok) {
        const value = await readResponseObject(response, false);
        const code = typeof value?.error === "string" ? value.error : null;
        const currentRevision = value && Number.isSafeInteger(value.currentRevision) && Number(value.currentRevision) >= 0
          ? Number(value.currentRevision) : null;
        const message = code === "design_revision_conflict"
          ? "Документ изменился после открытия. Перезагрузите жгут перед повторным размещением."
          : typeof value?.message === "string" && value.message.trim()
            ? value.message : `Сервер не выполнил запрос (HTTP ${response.status}).`;
        throw new HarnessDesignApiError(message, code, currentRevision);
      }
      return parseComponentPlacementResult(await readResponseObject(response, true), body, projectId, harnessId);
    },
  };
}

/**
 * Decode the placement envelope at the trust boundary. Placement is an atomic
 * command, so accepting a partial or stale response would leave the editor's
 * in-memory history out of sync with the server. Keep this parser exported for
 * focused contract tests without exposing the transport implementation.
 */
export function parseComponentPlacementResult(
  value: unknown,
  request: Pick<PlaceComponentRequest, "commandId" | "expectedRevision" | "placementId">,
  projectId?: string,
  harnessId?: string,
): ComponentPlacementResult {
  const envelope = requireRecord(value);
  const commandId = requireString(envelope.commandId, "commandId");
  const expectedRevision = requireNonNegativeInteger(envelope.expectedRevision, "expectedRevision");
  const resultingRevision = requireNonNegativeInteger(envelope.resultingRevision, "resultingRevision");
  const snapshot = requireRecord(envelope.snapshot);
  const snapshotId = requireString(snapshot.snapshotId, "snapshot.snapshotId");
  const placement = requireRecord(envelope.placement);
  const placementId = requireString(placement.placementId, "placement.placementId");
  const placementSnapshotId = requireString(placement.snapshotId, "placement.snapshotId");
  const instance = requireRecord(placement.instance);
  const instanceId = requireString(instance.id, "placement.instance.id");
  if (!idPattern.test(commandId) || commandId !== request.commandId ||
      expectedRevision !== request.expectedRevision ||
      resultingRevision !== request.expectedRevision + 1 ||
      !idPattern.test(snapshotId) || !idPattern.test(placementId) ||
      placementId !== request.placementId || placementSnapshotId !== snapshotId ||
      instanceId !== placementId ||
      (projectId !== undefined && snapshot.projectId !== projectId) ||
      (harnessId !== undefined && placement.harnessId !== harnessId)) {
    throw new Error("Сервер вернул повреждённый результат размещения компонента.");
  }
  return { commandId, resultingRevision, snapshotId };
}

async function readResponseObject(response: Response, required: boolean): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    if (!required) return {};
    throw new Error("Сервер вернул пустой или нечитаемый результат размещения компонента.");
  }
  if (!required && (value === null || typeof value !== "object" || Array.isArray(value))) return {};
  return requireRecord(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Сервер вернул повреждённый результат размещения компонента.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Поле ответа «${name}» задано неверно.`);
  return value;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Поле ответа «${name}» задано неверно.`);
  return Number(value);
}
