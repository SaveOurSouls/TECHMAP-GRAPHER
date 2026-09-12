using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Techmap.Domain;

namespace Techmap.Infrastructure.Xlsx;

public enum XlsxFieldValueKind
{
    RawScalar,
    Text,
    Int64,
    Decimal,
    Boolean,
}

public sealed record XlsxFieldMapping(
    string SourceColumn,
    string TargetProperty,
    XlsxFieldValueKind ValueKind = XlsxFieldValueKind.RawScalar,
    bool Required = false,
    IReadOnlyList<string>? NotApplicableTokens = null,
    bool AllowBlank = false,
    bool AllowNotApplicable = false,
    bool AllowFormulaCachedValue = false,
    bool SkipBlank = false);

public sealed record XlsxCatalogMapping(
    string? SheetName,
    uint HeaderRow,
    uint FirstDataRow,
    string EntityType,
    string KeyColumn,
    IReadOnlyList<XlsxFieldMapping>? Fields = null,
    uint? LastDataRow = null,
    bool IgnoreUnmappedFormulas = false,
    bool StopAtFirstMissingKey = false,
    string? ProfileId = null);

public sealed record XlsxSheetInspection(string Name, bool Hidden);

public sealed record XlsxResolvedColumn(string Header, int ColumnIndex, string TargetProperty, string ValueKind);

public sealed record XlsxPreviewRecord(
    uint RowNumber,
    string SourceKey,
    JsonElement Payload,
    string SourceLocation);

public sealed record XlsxCatalogPreview(
    string FileName,
    string SourceSha256,
    IReadOnlyList<XlsxSheetInspection> Sheets,
    string SelectedSheet,
    uint HeaderRow,
    uint FirstDataRow,
    string EntityType,
    string KeyColumn,
    IReadOnlyList<XlsxResolvedColumn> Columns,
    int SourceRowCount,
    int RecordCount,
    bool IsTruncated,
    IReadOnlyList<XlsxPreviewRecord> Records,
    ReferenceCatalogValidationResult Validation);

public sealed class XlsxImportException : IOException
{
    public XlsxImportException(
        string code,
        string message,
        string? sourceLocation = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        SourceLocation = sourceLocation;
    }

    public string Code { get; }
    public string? SourceLocation { get; }
}

public sealed class XlsxReferenceCatalogReader
{
    public const int MaximumInputBytes = 25 * 1024 * 1024;
    public const int MaximumZipEntries = 2_000;
    public const long MaximumPartBytes = 64L * 1024 * 1024;
    public const long MaximumExpandedBytes = 256L * 1024 * 1024;
    public const int MaximumCompressionRatio = 100;
    public const int MaximumSheets = 64;
    public const int MaximumRows = 100_000;
    public const int MaximumColumns = 512;
    public const int MaximumCells = 2_000_000;
    public const int MaximumSharedStrings = 500_000;
    public const long MaximumSharedStringCharacters = 16L * 1024 * 1024;
    public const int MaximumCellCharacters = 32_767;
    public const int MaximumPreviewRows = 100;
    public const int MaximumMappedFields = 256;
    public const int MaximumDiagnostics = 5_000;
    public const long MaximumCandidateBytes = 32L * 1024 * 1024;
    public const long MaximumWorksheetPartBytes = 16L * 1024 * 1024;
    public const long MaximumSharedStringsPartBytes = 16L * 1024 * 1024;

    private static readonly Regex CellReferencePattern = new(
        "^(?<column>[A-Z]{1,3})(?<row>[1-9][0-9]*)$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly string[] ForbiddenPartFragments =
    [
        "/vbaproject", "/activex/", "/embeddings/",
        "/connections", "/querytables/", "/model/",
    ];
    private static readonly string[] ForbiddenContentTypeFragments =
    [
        "vbaproject", "activex", "oleobject", "externallink",
        "connections", "querytable", "spreadsheetml.model",
    ];
    private static readonly string[] ForbiddenRelationshipTypeFragments =
    [
        "/vbaproject", "/control", "/oleobject", "/externallink",
        "/connections", "/querytable", "/package", "/attachedtemplate",
        "/externaldata", "/dataconnection", "/linkeddatatype", "/webextension",
        "/altchunk",
    ];
    private static readonly string[] WebHyperlinkRelationshipTypes =
    [
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        "http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink",
    ];

    public static string CreateVersionFingerprint(
        ReadOnlySpan<byte> sourceBytes,
        string fileName,
        XlsxCatalogMapping mapping)
    {
        ArgumentNullException.ThrowIfNull(mapping);
        ValidateMapping(mapping);
        var safeFileName = SafeFileName(fileName);
        var sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(sourceBytes));
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("fileName", safeFileName);
            writer.WriteString("sheetName", mapping.SheetName?.Normalize(NormalizationForm.FormC));
            writer.WriteNumber("headerRow", mapping.HeaderRow);
            writer.WriteNumber("firstDataRow", mapping.FirstDataRow);
            if (mapping.LastDataRow is uint lastDataRow) writer.WriteNumber("lastDataRow", lastDataRow); else writer.WriteNull("lastDataRow");
            writer.WriteBoolean("ignoreUnmappedFormulas", mapping.IgnoreUnmappedFormulas);
            writer.WriteBoolean("stopAtFirstMissingKey", mapping.StopAtFirstMissingKey);
            if (mapping.ProfileId is null) writer.WriteNull("profileId"); else writer.WriteString("profileId", mapping.ProfileId.Normalize(NormalizationForm.FormC));
            writer.WriteString("entityType", mapping.EntityType.Normalize(NormalizationForm.FormC));
            writer.WriteString("keyColumn", mapping.KeyColumn.Normalize(NormalizationForm.FormC));
            writer.WritePropertyName("fields");
            if (mapping.Fields is null)
            {
                writer.WriteNullValue();
            }
            else
            {
                writer.WriteStartArray();
                foreach (var field in mapping.Fields)
                {
                    writer.WriteStartObject();
                    writer.WriteBoolean("allowBlank", field.AllowBlank);
                    writer.WriteBoolean("allowNotApplicable", field.AllowNotApplicable);
                    writer.WriteBoolean("allowFormulaCachedValue", field.AllowFormulaCachedValue);
                    writer.WriteBoolean("skipBlank", field.SkipBlank);
                    writer.WritePropertyName("notApplicableTokens");
                    writer.WriteStartArray();
                    foreach (var token in (field.NotApplicableTokens ?? [])
                                 .Select(value => value.Normalize(NormalizationForm.FormC))
                                 .Order(StringComparer.Ordinal))
                        writer.WriteStringValue(token);
                    writer.WriteEndArray();
                    writer.WriteBoolean("required", field.Required);
                    writer.WriteString("sourceColumn", field.SourceColumn.Normalize(NormalizationForm.FormC));
                    writer.WriteString("targetProperty", field.TargetProperty.Normalize(NormalizationForm.FormC));
                    writer.WriteString("valueKind", field.ValueKind.ToString());
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }
        var mappingSha256 = Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
        return $"sha256:{sourceSha256};mapping-sha256:{mappingSha256}";
    }

    public async Task<XlsxCatalogPreview> PreviewAsync(
        Stream source,
        string fileName,
        string sourceId,
        XlsxCatalogMapping mapping,
        ReferenceCatalogSnapshotIdentity snapshotId,
        DateTimeOffset capturedUtc,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(mapping);
        ValidateMapping(mapping);
        var safeFileName = SafeFileName(fileName);
        var bytes = await ReadBoundedAsync(source, cancellationToken).ConfigureAwait(false);
        Preflight(bytes, cancellationToken);
        var sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes));
        var versionFingerprint = CreateVersionFingerprint(bytes, safeFileName, mapping);

        try
        {
            using var packageStream = new MemoryStream(bytes, writable: false);
            using var document = SpreadsheetDocument.Open(packageStream, false, new OpenSettings
            {
                AutoSave = false,
                MaxCharactersInPart = MaximumPartBytes,
            });
            return ReadDocument(
                document,
                safeFileName,
                sha256,
                versionFingerprint,
                sourceId,
                mapping,
                snapshotId,
                capturedUtc,
                cancellationToken);
        }
        catch (XlsxImportException)
        {
            throw;
        }
        catch (Exception error) when (error is OpenXmlPackageException or InvalidDataException or XmlException or FormatException)
        {
            throw new XlsxImportException("xlsx_invalid", "Файл XLSX повреждён или имеет неподдерживаемую структуру.", innerException: error);
        }
    }

    private static XlsxCatalogPreview ReadDocument(
        SpreadsheetDocument document,
        string fileName,
        string sha256,
        string versionFingerprint,
        string sourceId,
        XlsxCatalogMapping mapping,
        ReferenceCatalogSnapshotIdentity snapshotId,
        DateTimeOffset capturedUtc,
        CancellationToken cancellationToken)
    {
        var workbookPart = document.WorkbookPart
            ?? throw new XlsxImportException("xlsx_workbook_missing", "В XLSX отсутствует книга.");
        var sheetElements = workbookPart.Workbook.Sheets?.Elements<Sheet>().ToArray() ?? [];
        if (sheetElements.Length == 0 || sheetElements.Length > MaximumSheets)
            throw new XlsxImportException("xlsx_sheet_limit", "Число листов XLSX недопустимо.");

        var sheets = sheetElements.Select(sheet =>
        {
            var state = sheet.State?.Value;
            return new XlsxSheetInspection(
                Required(sheet.Name?.Value, "xlsx_sheet_name_missing", "Лист XLSX не имеет имени."),
                state == SheetStateValues.Hidden || state == SheetStateValues.VeryHidden);
        }).ToArray();
        if (sheets.Select(item => item.Name.Normalize(NormalizationForm.FormC))
            .Distinct(StringComparer.Ordinal).Count() != sheets.Length)
        {
            throw new XlsxImportException("xlsx_duplicate_sheet", "Имена листов XLSX неоднозначны после Unicode-нормализации.");
        }

        var selectedIndex = mapping.SheetName is null
            ? Array.FindIndex(sheets, item => !item.Hidden)
            : Array.FindIndex(sheets, item => string.Equals(item.Name, mapping.SheetName, StringComparison.Ordinal));
        if (selectedIndex < 0)
            throw new XlsxImportException("xlsx_sheet_not_found", "Выбранный лист XLSX не найден.");
        var selectedElement = sheetElements[selectedIndex];
        var relationshipId = Required(selectedElement.Id?.Value, "xlsx_sheet_relationship_missing", "Лист не связан с данными.");
        if (workbookPart.GetPartById(relationshipId) is not WorksheetPart worksheetPart)
            throw new XlsxImportException("xlsx_sheet_relationship_invalid", "Связь выбранного листа повреждена.");

        var sharedStrings = ReadSharedStrings(workbookPart.SharedStringTablePart, cancellationToken);
        var selectedSheetName = sheets[selectedIndex].Name;
        var headerRow = EnumerateRows(
                worksheetPart, sharedStrings, selectedSheetName,
                mapping.HeaderRow, mapping.HeaderRow, cancellationToken)
            .Select(item => item.Cells)
            .SingleOrDefault();
        if (headerRow is null)
        {
            return InvalidPreview(
                fileName, sha256, versionFingerprint, sheets, sheets[selectedIndex].Name, sourceId, mapping,
                snapshotId, capturedUtc, "xlsx_header_row_missing", "Строка заголовков отсутствует.");
        }

        var diagnostics = new List<ReferenceCatalogDiagnosticInput>();
        var headers = ResolveHeaders(headerRow, selectedSheetName, mapping.HeaderRow, diagnostics);
        var normalizedKey = NormalizeHeader(mapping.KeyColumn);
        if (!headers.TryGetValue(normalizedKey, out var keyColumn))
        {
            AddDiagnostic(diagnostics, Error(
                "xlsx_required_column_missing",
                $"Не найден обязательный столбец «{mapping.KeyColumn}».",
                field: mapping.KeyColumn,
                location: Location(sheets[selectedIndex].Name, mapping.HeaderRow)));
        }

        var requestedFields = mapping.Fields is not null
            ? mapping.Fields
            : headers.Where(item => !string.Equals(item.Key, normalizedKey, StringComparison.Ordinal))
                .Select(item => new XlsxFieldMapping(item.Key, item.Key))
                .ToArray();
        var duplicateSources = requestedFields
            .Select(item => NormalizeHeader(item.SourceColumn))
            .GroupBy(value => value, StringComparer.Ordinal)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        foreach (var duplicateSource in duplicateSources)
            AddDiagnostic(diagnostics, Error(
                "xlsx_source_column_duplicate",
                $"Столбец «{duplicateSource}» сопоставлен более одного раза.",
                field: duplicateSource,
                location: Location(selectedSheetName, mapping.HeaderRow)));
        var resolved = ResolveFields(headers, requestedFields, sheets[selectedIndex].Name, mapping.HeaderRow, diagnostics);
        var consumedColumns = resolved.Select(item => item.ColumnIndex).ToHashSet();
        if (keyColumn is not null) consumedColumns.Add(keyColumn.ColumnIndex);
        var headersByColumn = headers.Values.ToDictionary(item => item.ColumnIndex);

        var records = new List<ReferenceCatalogRecordInput>();
        var previewRecords = new List<XlsxPreviewRecord>();
        var cachedFormulaFields = new Dictionary<string, (int Count, string FirstLocation)>(StringComparer.Ordinal);
        var sourceRows = 0;
        long candidateBytes = 0;
        foreach (var parsedRow in EnumerateRows(
                     worksheetPart, sharedStrings, selectedSheetName,
                     mapping.FirstDataRow, mapping.LastDataRow ?? MaximumRows, cancellationToken,
                     rejectRowsAfterMaximum: mapping.LastDataRow is null))
        {
            var rowNumber = parsedRow.RowNumber;
            var cells = parsedRow.Cells;
            cancellationToken.ThrowIfCancellationRequested();
            if (mapping.StopAtFirstMissingKey && keyColumn is not null &&
                (!cells.TryGetValue(keyColumn.ColumnIndex, out var boundaryKey) ||
                 boundaryKey.State is ParsedCellState.Missing or ParsedCellState.Blank))
                break;
            sourceRows++;
            if (sourceRows > MaximumRows)
                throw new XlsxImportException("xlsx_row_limit", $"Лист содержит более {MaximumRows} строк данных.");
            var rowLocation = Location(sheets[selectedIndex].Name, rowNumber);
            foreach (var (column, formulaCell) in cells.Where(item =>
                         item.Value.State == ParsedCellState.Formula &&
                         !consumedColumns.Contains(item.Key) &&
                         !mapping.IgnoreUnmappedFormulas))
            {
                AddDiagnostic(diagnostics, Error(
                    "xlsx_formula_not_allowed",
                    "Формулы нельзя использовать в строках импортируемого диапазона.",
                    mapping.EntityType,
                    field: headersByColumn.TryGetValue(column, out var header) ? header.Header : ColumnName(column),
                    location: formulaCell.Reference));
            }
            if (keyColumn is null)
                continue;
            if (!cells.TryGetValue(keyColumn.ColumnIndex, out var keyCell) ||
                keyCell.State is ParsedCellState.Missing or ParsedCellState.Blank)
            {
                AddDiagnostic(diagnostics, Error(
                    "xlsx_key_missing", "В строке отсутствует ключ записи.", field: mapping.KeyColumn,
                    location: keyColumn is null ? rowLocation : Location(selectedSheetName, CellReference(keyColumn.ColumnIndex, rowNumber))));
                continue;
            }
            if (keyCell.State == ParsedCellState.Formula)
            {
                AddDiagnostic(diagnostics, Error("xlsx_formula_not_allowed", "Формулы нельзя использовать в ключах и импортируемых полях.", field: mapping.KeyColumn, location: keyCell.Reference));
                continue;
            }
            if (keyCell.State == ParsedCellState.Error)
            {
                AddDiagnostic(diagnostics, Error("xlsx_cell_error", "Ячейка ключа содержит ошибку Excel.", field: mapping.KeyColumn, location: keyCell.Reference));
                continue;
            }
            if (keyCell.Kind != ParsedValueKind.Text || string.IsNullOrEmpty(keyCell.Text))
            {
                AddDiagnostic(diagnostics, Error("xlsx_key_must_be_text", "Ключ записи должен быть непустым текстом, чтобы сохранить ведущие нули.", field: mapping.KeyColumn, location: keyCell.Reference));
                continue;
            }

            var payloadValues = new SortedDictionary<string, object?>(StringComparer.Ordinal);
            foreach (var field in resolved)
            {
                if (!cells.TryGetValue(field.ColumnIndex, out var cell))
                {
                    if (field.Mapping.Required)
                        AddDiagnostic(diagnostics, Error(
                            "xlsx_required_value_missing", $"Не заполнено обязательное поле «{field.Mapping.SourceColumn}».",
                            mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty,
                            Location(selectedSheetName, CellReference(field.ColumnIndex, rowNumber))));
                    continue;
                }
                if (cell.State == ParsedCellState.Formula)
                {
                    if (!field.Mapping.AllowFormulaCachedValue)
                    {
                        AddDiagnostic(diagnostics, Error("xlsx_formula_not_allowed", "Формулы нельзя использовать в импортируемых полях.", mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty, cell.Reference));
                        continue;
                    }
                    if (cell.Text.Length == 0)
                    {
                        if (field.Mapping.Required)
                            AddDiagnostic(diagnostics, Error("xlsx_formula_cached_value_missing", "У формулы отсутствует сохранённый результат.", mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty, cell.Reference));
                        continue;
                    }
                    cachedFormulaFields[field.Mapping.TargetProperty] = cachedFormulaFields.TryGetValue(field.Mapping.TargetProperty, out var usage)
                        ? (usage.Count + 1, usage.FirstLocation)
                        : (1, cell.Reference);
                }
                if (cell.State == ParsedCellState.Error)
                {
                    AddDiagnostic(diagnostics, Error("xlsx_cell_error", "Ячейка содержит ошибку Excel.", mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty, cell.Reference));
                    continue;
                }
                if (cell.State == ParsedCellState.Blank && !field.Mapping.AllowBlank)
                {
                    if (field.Mapping.SkipBlank)
                        continue;
                    AddDiagnostic(diagnostics, Error(
                        field.Mapping.Required ? "xlsx_required_value_blank" : "xlsx_blank_not_allowed",
                        $"Поле «{field.Mapping.SourceColumn}» не допускает пустую ячейку.",
                        mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty, cell.Reference));
                    continue;
                }
                if (cell.Kind == ParsedValueKind.Text && field.Mapping.NotApplicableTokens?.Any(token =>
                        string.Equals(
                            token.Normalize(NormalizationForm.FormC),
                            cell.Text.Normalize(NormalizationForm.FormC),
                            StringComparison.Ordinal)) == true)
                {
                    if (!field.Mapping.AllowNotApplicable)
                    {
                        AddDiagnostic(diagnostics, Error(
                            "xlsx_not_applicable_not_allowed", $"Поле «{field.Mapping.SourceColumn}» не допускает неприменимое значение.",
                            mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty, cell.Reference));
                        continue;
                    }
                    payloadValues[field.Mapping.TargetProperty] = null;
                    continue;
                }
                if (!TryConvert(cell, field.Mapping.ValueKind, out var value))
                {
                    AddDiagnostic(diagnostics, Error("xlsx_value_type_invalid", $"Значение не соответствует типу {field.Mapping.ValueKind}.", mapping.EntityType, keyCell.Text, field.Mapping.TargetProperty, cell.Reference));
                    continue;
                }
                payloadValues[field.Mapping.TargetProperty] = value;
            }

            using var payloadDocument = JsonDocument.Parse(JsonSerializer.Serialize(payloadValues));
            var payload = payloadDocument.RootElement.Clone();
            var recordLocation = Location(sheets[selectedIndex].Name, rowNumber);
            candidateBytes = checked(candidateBytes + Encoding.UTF8.GetByteCount(payload.GetRawText()) +
                                     Encoding.UTF8.GetByteCount(keyCell.Text) +
                                     Encoding.UTF8.GetByteCount(recordLocation) + 256L);
            if (candidateBytes > MaximumCandidateBytes)
                throw new XlsxImportException("xlsx_candidate_too_large", "Импортируемые данные слишком велики для одного снимка.");
            records.Add(new ReferenceCatalogRecordInput(mapping.EntityType, keyCell.Text, payload, recordLocation));
            if (previewRecords.Count < MaximumPreviewRows)
                previewRecords.Add(new XlsxPreviewRecord(rowNumber, keyCell.Text, payload, recordLocation));
        }

        foreach (var (field, usage) in cachedFormulaFields.OrderBy(item => item.Key, StringComparer.Ordinal))
        {
            AddDiagnostic(diagnostics, Warning(
                "xlsx_cached_formula_values_used",
                $"Для поля «{field}» использованы сохранённые в XLSX результаты формул ({usage.Count}). Проверьте, что книга была пересчитана перед загрузкой.",
                mapping.EntityType,
                field: field,
                location: usage.FirstLocation));
        }

        var draft = ReferenceCatalogDraft.Create(
            snapshotId,
            sourceId,
            1,
            capturedUtc,
            new ReferenceCatalogProvenanceInput("xlsx", versionFingerprint, fileName),
            records,
            diagnostics);
        var validation = draft.Validate();
        return new XlsxCatalogPreview(
            fileName, sha256, sheets, sheets[selectedIndex].Name,
            mapping.HeaderRow, mapping.FirstDataRow, mapping.EntityType, mapping.KeyColumn,
            resolved.Select(field => new XlsxResolvedColumn(
                field.Mapping.SourceColumn, field.ColumnIndex, field.Mapping.TargetProperty,
                field.Mapping.ValueKind.ToString().ToLowerInvariant())).ToArray(),
            sourceRows, records.Count, records.Count > MaximumPreviewRows,
            previewRecords, validation);
    }

    private static XlsxCatalogPreview InvalidPreview(
        string fileName,
        string sha256,
        string versionFingerprint,
        IReadOnlyList<XlsxSheetInspection> sheets,
        string selectedSheet,
        string sourceId,
        XlsxCatalogMapping mapping,
        ReferenceCatalogSnapshotIdentity snapshotId,
        DateTimeOffset capturedUtc,
        string code,
        string message)
    {
        var validation = ReferenceCatalogDraft.Create(
            snapshotId, sourceId, 1, capturedUtc,
            new ReferenceCatalogProvenanceInput("xlsx", versionFingerprint, fileName),
            [], [Error(code, message, location: Location(selectedSheet, mapping.HeaderRow))]).Validate();
        return new XlsxCatalogPreview(
            fileName, sha256, sheets, selectedSheet, mapping.HeaderRow, mapping.FirstDataRow,
            mapping.EntityType, mapping.KeyColumn, [], 0, 0, false, [], validation);
    }

    private static Dictionary<string, HeaderCell> ResolveHeaders(
        IReadOnlyDictionary<int, ParsedCell> row,
        string sheetName,
        uint headerRow,
        ICollection<ReferenceCatalogDiagnosticInput> diagnostics)
    {
        var result = new Dictionary<string, HeaderCell>(StringComparer.Ordinal);
        foreach (var (column, cell) in row.OrderBy(item => item.Key))
        {
            if (cell.State == ParsedCellState.Formula)
            {
                AddDiagnostic(diagnostics, Error("xlsx_formula_not_allowed", "Заголовок не может быть формулой.", location: cell.Reference));
                continue;
            }
            if (cell.Kind != ParsedValueKind.Text || string.IsNullOrWhiteSpace(cell.Text))
                continue;
            var header = NormalizeHeader(cell.Text);
            if (!result.TryAdd(header, new HeaderCell(header, column)))
                AddDiagnostic(diagnostics, Error("xlsx_duplicate_header", $"Заголовок «{header}» встречается несколько раз.", field: header, location: cell.Reference));
        }
        if (result.Count == 0)
            AddDiagnostic(diagnostics, Error("xlsx_headers_missing", "В выбранной строке нет текстовых заголовков.", location: Location(sheetName, headerRow)));
        return result;
    }

    private static IReadOnlyList<ResolvedField> ResolveFields(
        IReadOnlyDictionary<string, HeaderCell> headers,
        IReadOnlyList<XlsxFieldMapping> requested,
        string sheetName,
        uint headerRow,
        ICollection<ReferenceCatalogDiagnosticInput> diagnostics)
    {
        var result = new List<ResolvedField>();
        var targets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var mapping in requested)
        {
            var source = NormalizeHeader(mapping.SourceColumn);
            var target = mapping.TargetProperty.Normalize(NormalizationForm.FormC);
            if (string.IsNullOrWhiteSpace(target) || !targets.Add(target))
            {
                AddDiagnostic(diagnostics, Error("xlsx_target_property_invalid", $"Имя поля «{mapping.TargetProperty}» пустое или повторяется.", field: mapping.TargetProperty, location: Location(sheetName, headerRow)));
                continue;
            }
            if (!headers.TryGetValue(source, out var header))
            {
                AddDiagnostic(diagnostics, Error("xlsx_required_column_missing", $"Не найден столбец «{mapping.SourceColumn}».", field: mapping.SourceColumn, location: Location(sheetName, headerRow)));
                continue;
            }
            result.Add(new ResolvedField(header.ColumnIndex, mapping with { SourceColumn = source, TargetProperty = target }));
        }
        return result;
    }

    private static bool TryConvert(ParsedCell cell, XlsxFieldValueKind kind, out object? value)
    {
        value = null;
        if (cell.State == ParsedCellState.Blank)
        {
            value = "";
            return true;
        }
        switch (kind)
        {
            case XlsxFieldValueKind.Text when cell.Kind == ParsedValueKind.Text:
                value = cell.Text;
                return true;
            case XlsxFieldValueKind.Int64 when cell.Kind == ParsedValueKind.Number &&
                                               long.TryParse(cell.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var integer):
                value = integer;
                return true;
            case XlsxFieldValueKind.Decimal when cell.Kind == ParsedValueKind.Number &&
                                               decimal.TryParse(cell.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number):
                value = number;
                return true;
            case XlsxFieldValueKind.Boolean when cell.Kind == ParsedValueKind.Boolean:
                value = cell.Text == "1";
                return true;
            case XlsxFieldValueKind.RawScalar:
                if (cell.Kind == ParsedValueKind.Text) value = cell.Text;
                else if (cell.Kind == ParsedValueKind.Boolean) value = cell.Text == "1";
                else if (cell.Kind == ParsedValueKind.Number && long.TryParse(cell.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var rawInteger)) value = rawInteger;
                else if (cell.Kind == ParsedValueKind.Number && decimal.TryParse(cell.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var rawNumber)) value = rawNumber;
                else return false;
                return true;
            default:
                return false;
        }
    }

    private static string NormalizeHeader(string value) =>
        Regex.Replace(value.Normalize(NormalizationForm.FormC).Trim(), @"\s+", " ");

    private static IEnumerable<ParsedRow> EnumerateRows(
        WorksheetPart worksheetPart,
        IReadOnlyList<string> sharedStrings,
        string sheetName,
        uint minimumRow,
        uint maximumRow,
        CancellationToken cancellationToken,
        bool rejectRowsAfterMaximum = false)
    {
        var cellCount = 0;
        var rowCount = 0;
        uint previousRowNumber = 0;
        using var reader = OpenXmlReader.Create(worksheetPart);
        while (reader.Read())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (reader.ElementType != typeof(Row) || !reader.IsStartElement)
                continue;
            if (++rowCount > MaximumRows)
                throw new XlsxImportException("xlsx_row_limit", $"Число строк листа превышает {MaximumRows}.");
            var rawRowNumber = reader.Attributes.FirstOrDefault(attribute => attribute.LocalName == "r").Value;
            if (!uint.TryParse(rawRowNumber, NumberStyles.None, CultureInfo.InvariantCulture, out var rowNumber) || rowNumber == 0)
                throw new XlsxImportException("xlsx_row_reference_invalid", "Строка не имеет корректного номера.");
            if (rowNumber <= previousRowNumber)
                throw new XlsxImportException("xlsx_row_order_invalid", "Номера строк XLSX повторяются или идут не по порядку.");
            previousRowNumber = rowNumber;
            if (rowNumber > maximumRow)
            {
                if (rejectRowsAfterMaximum)
                    throw new XlsxImportException(
                        "xlsx_row_limit",
                        $"Строки данных должны находиться в диапазоне до {maximumRow} включительно.",
                        Location(sheetName, rowNumber));
                yield break;
            }
            var cells = new Dictionary<int, ParsedCell>();
            if (reader.ReadFirstChild())
            {
                do
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (reader.ElementType != typeof(Cell) || !reader.IsStartElement)
                        continue;
                    if (++cellCount > MaximumCells)
                        throw new XlsxImportException("xlsx_cell_limit", $"Число заполненных ячеек превышает {MaximumCells}.");
                    var cell = reader.LoadCurrentElement() as Cell
                        ?? throw new XlsxImportException("xlsx_cell_invalid", "Ячейка XLSX повреждена.");
                    var reference = Required(cell.CellReference?.Value, "xlsx_cell_reference_missing", "Ячейка не имеет адреса.");
                    var parsedReference = ParseReference(reference);
                    if (parsedReference.Row != rowNumber || !cells.TryAdd(
                            parsedReference.Column,
                            ParseCell(cell, sharedStrings, reference, Location(sheetName, reference))))
                        throw new XlsxImportException("xlsx_cell_reference_invalid", $"Адрес ячейки «{reference}» некорректен.", reference);
                }
                while (reader.ReadNextSibling());
            }
            if (rowNumber >= minimumRow && cells.Count > 0)
                yield return new ParsedRow(rowNumber, cells);
        }
    }

    private static ParsedCell ParseCell(
        Cell cell,
        IReadOnlyList<string> sharedStrings,
        string reference,
        string sourceLocation)
    {
        var dataType = cell.DataType?.Value;
        if (dataType == CellValues.Error)
            return new ParsedCell(sourceLocation, ParsedCellState.Error, ParsedValueKind.Text, cell.CellValue?.Text ?? "");
        string text;
        ParsedValueKind kind;
        if (dataType == CellValues.InlineString)
        {
            text = cell.InlineString?.InnerText ?? "";
            kind = ParsedValueKind.Text;
        }
        else if (dataType == CellValues.SharedString)
        {
            if (!int.TryParse(cell.CellValue?.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var index) ||
                index < 0 || index >= sharedStrings.Count)
                throw new XlsxImportException("xlsx_shared_string_index_invalid", "Индекс общей строки XLSX повреждён.", sourceLocation);
            text = sharedStrings[index];
            kind = ParsedValueKind.Text;
        }
        else if (dataType == CellValues.String)
        {
            text = cell.CellValue?.Text ?? "";
            kind = ParsedValueKind.Text;
        }
        else if (dataType == CellValues.Boolean)
        {
            text = cell.CellValue?.Text ?? "";
            if (text is not ("0" or "1"))
                throw new XlsxImportException("xlsx_boolean_invalid", "Логическое значение XLSX повреждено.", sourceLocation);
            kind = ParsedValueKind.Boolean;
        }
        else
        {
            text = cell.CellValue?.Text ?? "";
            kind = ParsedValueKind.Number;
        }
        if (text.Length > MaximumCellCharacters)
            throw new XlsxImportException("xlsx_cell_text_limit", "Текст ячейки XLSX слишком длинный.", sourceLocation);
        return new ParsedCell(
            sourceLocation,
            cell.CellFormula is not null
                ? ParsedCellState.Formula
                : text.Length == 0 ? ParsedCellState.Blank : ParsedCellState.Value,
            kind,
            text);
    }

    private static IReadOnlyList<string> ReadSharedStrings(
        SharedStringTablePart? part,
        CancellationToken cancellationToken)
    {
        if (part is null)
            return [];
        var result = new List<string>();
        long characters = 0;
        using var stream = part.GetStream(FileMode.Open, FileAccess.Read);
        using var reader = SecureXmlReader(stream);
        while (reader.Read())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "si")
                continue;
            if (result.Count >= MaximumSharedStrings)
                throw new XlsxImportException("xlsx_shared_string_limit", "В XLSX слишком много общих строк.");

            var current = new StringBuilder();
            using (var itemReader = reader.ReadSubtree())
            {
                while (itemReader.Read())
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (itemReader.NodeType != XmlNodeType.Element || itemReader.LocalName != "t")
                        continue;
                    var value = itemReader.ReadElementContentAsString();
                    if (current.Length + value.Length > MaximumCellCharacters)
                        throw new XlsxImportException("xlsx_shared_string_limit", "Текст общей строки XLSX слишком длинный.");
                    current.Append(value);
                }
            }

            characters = checked(characters + current.Length);
            if (characters > MaximumSharedStringCharacters)
                throw new XlsxImportException("xlsx_shared_string_limit", "Общие строки XLSX превышают допустимый размер.");
            result.Add(current.ToString());
        }
        return result;
    }

    private static async Task<byte[]> ReadBoundedAsync(Stream source, CancellationToken cancellationToken)
    {
        using var output = new MemoryStream();
        var buffer = new byte[128 * 1024];
        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (output.Length + read > MaximumInputBytes)
                throw new XlsxImportException("xlsx_too_large", $"Файл XLSX не должен превышать {MaximumInputBytes / 1024 / 1024} МиБ.");
            output.Write(buffer, 0, read);
        }
        return output.ToArray();
    }

    private static void Preflight(byte[] bytes, CancellationToken cancellationToken)
    {
        if (bytes.Length < 4 || bytes[0] != 0x50 || bytes[1] != 0x4b)
            throw new XlsxImportException("xlsx_invalid", "Файл не является XLSX.");
        try
        {
            using var archive = new ZipArchive(new MemoryStream(bytes, writable: false), ZipArchiveMode.Read);
            if (archive.Entries.Count == 0 || archive.Entries.Count > MaximumZipEntries)
                throw new XlsxImportException("xlsx_zip_entry_limit", "Число частей XLSX недопустимо.");
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long expanded = 0;
            long compressed = 0;
            foreach (var entry in archive.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                ValidateEntryName(entry.FullName, names);
                var normalizedName = "/" + entry.FullName.Replace('\\', '/').ToLowerInvariant();
                if (ForbiddenPartFragments.Any(normalizedName.Contains))
                    throw new XlsxImportException("xlsx_active_content_not_allowed", $"Часть «{entry.FullName}» запрещена.");
                if (entry.Length > MaximumPartBytes)
                    throw new XlsxImportException("xlsx_part_too_large", $"Часть «{entry.FullName}» слишком велика.");
                if (normalizedName.StartsWith("/xl/worksheets/", StringComparison.Ordinal) &&
                    entry.Length > MaximumWorksheetPartBytes)
                    throw new XlsxImportException("xlsx_worksheet_too_large", $"Лист «{entry.FullName}» слишком велик.");
                if (string.Equals(normalizedName, "/xl/sharedstrings.xml", StringComparison.Ordinal) &&
                    entry.Length > MaximumSharedStringsPartBytes)
                    throw new XlsxImportException("xlsx_shared_string_limit", "Таблица общих строк XLSX слишком велика.");
                if (entry.Length > 1024 * 1024 &&
                    (entry.CompressedLength == 0 || entry.Length > entry.CompressedLength * MaximumCompressionRatio))
                    throw new XlsxImportException("xlsx_compression_ratio_limit", "Коэффициент сжатия XLSX небезопасен.");
                expanded = checked(expanded + entry.Length);
                compressed = checked(compressed + entry.CompressedLength);
                if (expanded > MaximumExpandedBytes)
                    throw new XlsxImportException("xlsx_expanded_size_limit", "Распакованный XLSX слишком велик.");
                using var stream = entry.Open();
                var buffer = new byte[64 * 1024];
                long actual = 0;
                while (true)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var read = stream.Read(buffer, 0, buffer.Length);
                    if (read == 0) break;
                    actual += read;
                    if (actual > MaximumPartBytes || actual > entry.Length)
                        throw new XlsxImportException("xlsx_part_too_large", $"Часть «{entry.FullName}» превышает заявленный размер.");
                }
                if (actual != entry.Length)
                    throw new XlsxImportException("xlsx_invalid", $"Часть «{entry.FullName}» повреждена.");
                if (entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase))
                    RejectUnsafeRelationships(entry, cancellationToken);
            }
            if (expanded > 1024 * 1024 &&
                (compressed == 0 || expanded > compressed * MaximumCompressionRatio))
                throw new XlsxImportException("xlsx_compression_ratio_limit", "Общий коэффициент сжатия XLSX небезопасен.");
            var types = archive.GetEntry("[Content_Types].xml")
                ?? throw new XlsxImportException("xlsx_content_types_missing", "В XLSX отсутствует описание типов частей.");
            using var typesStream = types.Open();
            using var reader = SecureXmlReader(typesStream);
            while (reader.Read())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (reader.NodeType == XmlNodeType.Element &&
                    (reader.Name.EndsWith("Override", StringComparison.Ordinal) || reader.Name.EndsWith("Default", StringComparison.Ordinal)) &&
                    reader.GetAttribute("ContentType") is { } contentType &&
                    (contentType.Contains("macroEnabled", StringComparison.OrdinalIgnoreCase) ||
                     contentType.Contains("binary", StringComparison.OrdinalIgnoreCase) ||
                     ForbiddenContentTypeFragments.Any(fragment =>
                         contentType.Contains(fragment, StringComparison.OrdinalIgnoreCase))))
                    throw new XlsxImportException("xlsx_active_content_not_allowed", "XLSX содержит макросы или бинарную книгу.");
            }
        }
        catch (XlsxImportException)
        {
            throw;
        }
        catch (Exception error) when (error is InvalidDataException or IOException or XmlException or OverflowException)
        {
            throw new XlsxImportException("xlsx_invalid", "ZIP-контейнер XLSX повреждён.", innerException: error);
        }
    }

    private static void RejectUnsafeRelationships(ZipArchiveEntry entry, CancellationToken cancellationToken)
    {
        using var stream = entry.Open();
        using var reader = SecureXmlReader(stream);
        while (reader.Read())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (reader.NodeType != XmlNodeType.Element ||
                !reader.Name.EndsWith("Relationship", StringComparison.Ordinal)) continue;
            var relationshipType = reader.GetAttribute("Type");
            if (string.Equals(reader.GetAttribute("TargetMode"), "External", StringComparison.OrdinalIgnoreCase) &&
                !IsSafeWebHyperlink(relationshipType, reader.GetAttribute("Target")))
                throw new XlsxImportException(
                    "xlsx_external_relationship_not_allowed",
                    "XLSX содержит запрещённую внешнюю связь. Обычные веб-гиперссылки разрешены.",
                    entry.FullName);
            if (relationshipType is not null &&
                ForbiddenRelationshipTypeFragments.Any(fragment =>
                    relationshipType.EndsWith(fragment, StringComparison.OrdinalIgnoreCase)))
                throw new XlsxImportException("xlsx_active_content_not_allowed", "XLSX содержит запрещённый тип связи.", entry.FullName);
        }
    }

    private static bool IsSafeWebHyperlink(string? relationshipType, string? target) =>
        relationshipType is not null &&
        WebHyperlinkRelationshipTypes.Contains(relationshipType, StringComparer.Ordinal) &&
        target is { Length: > 0 and <= 8_192 } &&
        Uri.TryCreate(target, UriKind.Absolute, out var uri) &&
        (string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) ||
         string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase));

    private static XmlReader SecureXmlReader(Stream stream) => XmlReader.Create(stream, new XmlReaderSettings
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        MaxCharactersInDocument = MaximumPartBytes,
        MaxCharactersFromEntities = 0,
        CloseInput = false,
    });

    private static void ValidateEntryName(string name, ISet<string> names)
    {
        if (string.IsNullOrEmpty(name) || name.StartsWith('/') || name.StartsWith('\\') ||
            name.Contains('\\') || name.Any(char.IsControl) || !names.Add(name) ||
            name.Split('/').Any(segment => segment is "" or "." or ".."))
            throw new XlsxImportException("xlsx_zip_path_invalid", "XLSX содержит небезопасное или повторяющееся имя части.");
    }

    private static (int Column, uint Row) ParseReference(string reference)
    {
        var match = CellReferencePattern.Match(reference);
        if (!match.Success || !uint.TryParse(match.Groups["row"].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var row))
            throw new XlsxImportException("xlsx_cell_reference_invalid", $"Адрес ячейки «{reference}» некорректен.", reference);
        var column = 0;
        foreach (var character in match.Groups["column"].Value)
            column = checked(column * 26 + character - 'A' + 1);
        if (column is < 1 or > MaximumColumns)
            throw new XlsxImportException("xlsx_column_limit", $"Столбец «{reference}» выходит за предел {MaximumColumns}.", reference);
        return (column, row);
    }

    private static string SafeFileName(string fileName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        var name = Path.GetFileName(fileName);
        if (!string.Equals(Path.GetExtension(name), ".xlsx", StringComparison.OrdinalIgnoreCase) ||
            name.Length > 255 || name.Any(char.IsControl))
            throw new XlsxImportException("xlsx_file_name_invalid", "Нужен файл с расширением .xlsx.");
        return name.Normalize(NormalizationForm.FormC);
    }

    private static void ValidateMapping(XlsxCatalogMapping mapping)
    {
        if (mapping.HeaderRow is < 1 or > MaximumRows ||
            mapping.FirstDataRow <= mapping.HeaderRow || mapping.FirstDataRow > MaximumRows ||
            mapping.LastDataRow is uint lastDataRow && (lastDataRow < mapping.FirstDataRow || lastDataRow > MaximumRows) ||
            string.IsNullOrWhiteSpace(mapping.EntityType) || mapping.EntityType.Length > 128 ||
            string.IsNullOrWhiteSpace(mapping.KeyColumn) || mapping.KeyColumn.Length > 256 ||
            mapping.SheetName is { Length: > 31 } ||
            mapping.ProfileId is { Length: > 128 })
        {
            throw new XlsxImportException("xlsx_mapping_invalid", "Параметры сопоставления XLSX недопустимы.");
        }
        if (mapping.Fields is { Count: 0 } or { Count: > MaximumMappedFields })
            throw new XlsxImportException("xlsx_mapping_invalid", $"Укажите от 1 до {MaximumMappedFields} импортируемых полей либо используйте автоматическое сопоставление.");
        foreach (var field in mapping.Fields ?? [])
        {
            if (field is null ||
                string.IsNullOrWhiteSpace(field.SourceColumn) || field.SourceColumn.Length > 256 ||
                string.IsNullOrWhiteSpace(field.TargetProperty) || field.TargetProperty.Length > 256 ||
                field.SourceColumn.Any(char.IsControl) || field.TargetProperty.Any(char.IsControl))
            {
                throw new XlsxImportException("xlsx_mapping_invalid", "Сопоставление содержит пустое или недопустимое поле.");
            }
            var tokens = field.NotApplicableTokens ?? [];
            if (tokens.Count > 16 || tokens.Any(token =>
                    string.IsNullOrEmpty(token) || token.Length > 64 || token.Any(char.IsControl)) ||
                tokens.Select(token => token.Normalize(NormalizationForm.FormC))
                    .Distinct(StringComparer.Ordinal).Count() != tokens.Count)
            {
                throw new XlsxImportException("xlsx_mapping_invalid", "Маркеры неприменимого значения заданы некорректно.");
            }
        }
    }

    private static string Location(string sheetName, uint row) => $"'{sheetName.Replace("'", "''", StringComparison.Ordinal)}'!{row}";

    private static string Location(string sheetName, string cellReference) =>
        $"'{sheetName.Replace("'", "''", StringComparison.Ordinal)}'!{cellReference}";

    private static string CellReference(int column, uint row) => $"{ColumnName(column)}{row}";

    private static string ColumnName(int column)
    {
        var result = "";
        while (column > 0)
        {
            column--;
            result = (char)('A' + column % 26) + result;
            column /= 26;
        }
        return result;
    }

    private static void AddDiagnostic(
        ICollection<ReferenceCatalogDiagnosticInput> diagnostics,
        ReferenceCatalogDiagnosticInput diagnostic)
    {
        if (diagnostics.Count >= MaximumDiagnostics)
            throw new XlsxImportException("xlsx_diagnostic_limit", $"Число ошибок превышает {MaximumDiagnostics}. Исправьте структуру файла и повторите проверку.");
        diagnostics.Add(diagnostic);
    }

    private static string Required(string? value, string code, string message) =>
        string.IsNullOrEmpty(value) ? throw new XlsxImportException(code, message) : value;

    private static ReferenceCatalogDiagnosticInput Error(
        string code,
        string message,
        string? entityType = null,
        string? sourceKey = null,
        string? field = null,
        string? location = null) => new(
        ReferenceCatalogDiagnosticSeverity.Error,
        code,
        message,
        entityType,
        sourceKey,
        field,
        location);

    private static ReferenceCatalogDiagnosticInput Warning(
        string code,
        string message,
        string? entityType = null,
        string? sourceKey = null,
        string? field = null,
        string? location = null) => new(
        ReferenceCatalogDiagnosticSeverity.Warning,
        code,
        message,
        entityType,
        sourceKey,
        field,
        location);

    private sealed record HeaderCell(string Header, int ColumnIndex);
    private sealed record ResolvedField(int ColumnIndex, XlsxFieldMapping Mapping);
    private sealed record ParsedRow(uint RowNumber, IReadOnlyDictionary<int, ParsedCell> Cells);
    private enum ParsedCellState { Missing, Blank, Value, Formula, Error }
    private enum ParsedValueKind { Text, Number, Boolean }
    private sealed record ParsedCell(string Reference, ParsedCellState State, ParsedValueKind Kind, string Text);
}
