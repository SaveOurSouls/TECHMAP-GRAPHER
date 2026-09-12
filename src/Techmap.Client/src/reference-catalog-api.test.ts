import { describe, expect, it, vi } from "vitest";
import {
  bytesToBase64,
  createReferenceCatalogApi,
  ReferenceCatalogApiError,
  type XlsxPreviewRequest,
  type XlsxProfilePreviewRequest,
} from "./reference-catalog-api";
import { parseRuntimeConfig } from "./runtime-config";

const config = parseRuntimeConfig({
  configVersion: 1,
  basePath: "/techmap/",
  apiBasePath: "/techmap/api/v1/",
  appVersion: "1.0.0",
  apiVersion: "1",
  schemaVersion: "7",
});
const session = {
  csrfNonce: "A".repeat(43),
  instanceId: "12345678-1234-4123-8123-123456789abc",
};
const hash = "a".repeat(64);
const diagnosticHash = "b".repeat(64);
const previewId = "12345678-1234-4123-8123-123456789abc";
const snapshotId = "22345678-1234-4123-8123-123456789abc";
const request: XlsxPreviewRequest = {
  fileName: "source.xlsx",
  contentBase64: "UEsDBA==",
  sheetName: null,
  headerRow: 1,
  firstDataRow: 2,
  entityType: "generic-record",
  keyColumn: "RecordKey",
  fields: null,
};
const profileRequest: XlsxProfilePreviewRequest = {
  fileName: "База данных. Технология.xlsx",
  contentBase64: "UEsDBA==",
  profileId: "technology.operations",
};

function profiles() {
  return [
    {
      profileId: "technology.operations",
      displayName: "БД.ОП — операции",
      sourceId: "technology-operations",
      sheetName: "БД.ОП",
      entityType: "operation",
      keyColumn: "Номер",
      description: "Операции и исходные параметры времени.",
    },
    {
      profileId: "technology.equipment",
      displayName: "БД.ОБ — оборудование",
      sourceId: "technology-equipment",
      sheetName: "БД.ОБ",
      entityType: "equipment",
      keyColumn: "Инв. номер",
      description: "Физические единицы оборудования.",
    },
  ];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function diagnostic(severity: "warning" | "error" = "warning") {
  return {
    diagnosticId: diagnosticHash,
    severity,
    code: "review-required",
    message: "Проверьте строку.",
    entityType: "generic-record",
    sourceKey: "A-1",
    field: "value",
    sourceLocation: "'Лист1'!2",
  };
}

function preview() {
  return {
    previewId,
    expiresUtc: "2026-09-12T18:30:00Z",
    activeSnapshotId: null,
    snapshotId,
    sourceId: "technology-database",
    fileName: "source.xlsx",
    sourceSha256: hash,
    sheets: [{ name: "Лист1", hidden: false }],
    selectedSheet: "Лист1",
    headerRow: 1,
    firstDataRow: 2,
    entityType: "generic-record",
    keyColumn: "RecordKey",
    columns: [{ header: "Value", columnIndex: 2, targetProperty: "value", valueKind: "rawscalar" }],
    sourceRowCount: 1,
    recordCount: 1,
    isTruncated: false,
    validationSha256: hash,
    canPublish: true,
    records: [{ rowNumber: 2, sourceKey: "A-1", payload: { value: 0 }, sourceLocation: "'Лист1'!2" }],
    diagnostics: [diagnostic()],
  };
}

function snapshot() {
  return {
    snapshotId,
    sourceId: "technology-database",
    contractVersion: 1,
    capturedUtc: "2026-09-12T18:00:00Z",
    sourceKind: "xlsx",
    versionFingerprint: `sha256:${hash}`,
    sourceUri: "source.xlsx",
    sha256: hash,
    records: [{
      recordId: hash,
      entityType: "generic-record",
      sourceKey: "A-1",
      payload: { value: 0 },
      sourceLocation: "'Лист1'!2",
    }],
    diagnostics: [diagnostic()],
  };
}

describe("reference catalog API", () => {
  it("discovers all named XLSX profiles without assuming a fixed count", async () => {
    const fetcher = vi.fn(async () => jsonResponse(profiles()));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.getXlsxProfiles()).resolves.toEqual([
      expect.objectContaining({ profileId: "technology.operations", sourceId: "technology-operations" }),
      expect.objectContaining({ profileId: "technology.equipment", keyColumn: "Инв. номер" }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "/techmap/api/v1/reference-import/xlsx-profiles",
      expect.objectContaining({ method: "GET", headers: { Accept: "application/json" } }),
    );
  });

  it("sends a profile preview to the source declared by the selected profile", async () => {
    const response = { ...preview(), sourceId: "technology-operations", selectedSheet: "БД.ОП" };
    const fetcher = vi.fn(async () => jsonResponse(response));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.previewXlsxProfile("technology-operations", profileRequest)).resolves.toEqual(
      expect.objectContaining({ sourceId: "technology-operations", selectedSheet: "БД.ОП" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/techmap/api/v1/reference-sources/technology-operations/xlsx-profile-previews",
      expect.objectContaining({ method: "POST", body: JSON.stringify(profileRequest) }),
    );
  });

  it("rejects duplicate profile identities from a malformed response", async () => {
    const fetcher = vi.fn(async () => jsonResponse([profiles()[0], profiles()[0]]));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.getXlsxProfiles()).rejects.toThrow("повторяющиеся профили");
  });

  it("encodes binary input in bounded base64 chunks", () => {
    const bytes = new Uint8Array(3 * 8192 + 5);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
    const encoded = bytesToBase64(bytes);
    const decoded = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));

    expect(decoded).toEqual(bytes);
  });

  it("sends preview through the configured base path with CSRF and parses zero as data", async () => {
    const fetcher = vi.fn(async () => jsonResponse(preview()));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.previewXlsx("technology-database", request)).resolves.toEqual(
      expect.objectContaining({ recordCount: 1, canPublish: true, activeSnapshotId: null }),
    );
    expect((await api.previewXlsx("technology-database", request)).records[0]?.payload.value).toBe(0);
    expect(fetcher).toHaveBeenLastCalledWith(
      "/techmap/api/v1/reference-sources/technology-database/xlsx-previews",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Techmap-CSRF": session.csrfNonce,
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it("treats a missing active snapshot as an honest empty state", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      error: "catalog_active_snapshot_not_found",
      message: "The reference source does not have an active snapshot.",
    }, 404));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.getActive("technology-database")).resolves.toBeNull();
  });

  it("publishes only the validated preview token and exact warning set", async () => {
    const publication = { status: "published", previousActiveSnapshotId: null, snapshot: snapshot() };
    const fetcher = vi.fn(async () => jsonResponse(publication, 201));
    const api = createReferenceCatalogApi(config, session, fetcher);
    const body = {
      previewId,
      expectedValidationSha256: hash,
      expectedActiveSnapshotId: null,
      acknowledgedWarningIds: [diagnosticHash],
    };

    await expect(api.publishXlsx("technology-database", body)).resolves.toEqual(
      expect.objectContaining({ status: "published" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/techmap/api/v1/reference-sources/technology-database/xlsx-publications",
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });

  it("keeps null fields for server-side automatic column mapping", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return jsonResponse(preview());
    });
    const api = createReferenceCatalogApi(config, session, fetcher);

    await api.previewXlsx("technology-database", request);

    expect(JSON.parse(requests[0]!.body as string)).toMatchObject({
      fields: null,
    });
  });

  it("keeps a stable backend error code for recovery from an expired preview", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      error: "xlsx_preview_expired",
      message: "Предварительный просмотр истёк. Проверьте файл ещё раз.",
    }, 410));
    const api = createReferenceCatalogApi(config, session, fetcher);

    const error = await api.publishXlsx("technology-database", {
      previewId,
      expectedValidationSha256: hash,
      expectedActiveSnapshotId: null,
      acknowledgedWarningIds: [],
    }).catch(value => value);
    expect(error).toBeInstanceOf(ReferenceCatalogApiError);
    expect(error).toMatchObject({ code: "xlsx_preview_expired" });
  });

  it("rejects an internally inconsistent preview response", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...preview(), validationSha256: null }));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.previewXlsx("technology-database", request)).rejects.toThrow(
      "несогласованный результат проверки XLSX",
    );
  });

  it("requires the active snapshot baseline in every preview response", async () => {
    const { activeSnapshotId: _, ...withoutBaseline } = preview();
    const fetcher = vi.fn(async () => jsonResponse(withoutBaseline));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.previewXlsx("technology-database", request)).rejects.toThrow(
      "activeSnapshotId",
    );
  });

  it("rejects a resolved XLSX value kind unknown to the client", async () => {
    const malformed = preview();
    malformed.columns[0]!.valueKind = "raw";
    const fetcher = vi.fn(async () => jsonResponse(malformed));
    const api = createReferenceCatalogApi(config, session, fetcher);

    await expect(api.previewXlsx("technology-database", request)).rejects.toThrow(
      "valueKind",
    );
  });
});
