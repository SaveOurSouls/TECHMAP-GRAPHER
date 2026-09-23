using Techmap.Domain;
using Techmap.Infrastructure.Xlsx;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class XlsxReferenceCatalogReaderTests
{
    [Fact]
    public async Task Wire_profile_detects_row_three_and_preserves_all_columns_and_duplicate_variants()
    {
        var bytes = new XlsxTestFixtureBuilder().WithWorksheetName("Любое имя").WithHeaderRow(3)
            .WithHeaders("Марка", "Core", "Сечение C", "Pair", "Сечение P", "Артикул", "Цвет", "Цена", "Пусто")
            .AddRow("TEST", "1C", "0,35", "", "", "0007", "красный", null, null)
            .AddRow("", "", "", "", "", "", "", "", "")
            .AddRow("TEST", "1C", "0,35", "", "", "0008", "синий", "15", null)
            .AddRow("TEST", "3C", "0,5", "2P", "0,22", "0009", "", "20", null)
            .WithFormula("H4", "2*5", "10").Build();
        var preview = await PreviewAsync(bytes, XlsxKnownProfiles.Get("technology.wires").Mapping);
        Assert.True(preview.Validation.IsValid, string.Join("; ", preview.Validation.Diagnostics.Select(d => d.Message)));
        Assert.Equal("Любое имя", preview.SelectedSheet);
        Assert.Equal(9, preview.Columns.Count);
        Assert.Equal(3, preview.RecordCount);
        Assert.Equal(3, preview.Records.Select(r => r.SourceKey).Distinct().Count());
        Assert.Equal("TEST", preview.Records[0].Payload.GetProperty("Марка").GetString());
        Assert.Equal("0007", preview.Records[0].Payload.GetProperty("Артикул").GetString());
        Assert.Equal(10, preview.Records[0].Payload.GetProperty("Цена").GetInt32());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, preview.Records[0].Payload.GetProperty("Пусто").ValueKind);
        Assert.Equal("2P", preview.Records[2].Payload.GetProperty("Pair").GetString());
    }

    [Fact]
    public async Task Wire_profile_requires_its_headers_and_does_not_guess_the_first_sheet()
    {
        var error = await Assert.ThrowsAsync<XlsxImportException>(() => PreviewAsync(
            XlsxTestFixtureBuilder.MinimalValidWorkbook(), XlsxKnownProfiles.Get("technology.wires").Mapping));
        Assert.Equal("xlsx_profile_sheet_ambiguous", error.Code);
    }

    [Fact]
    public async Task Wire_profile_uses_cached_formula_sections_in_both_key_and_payload()
    {
        var bytes = new XlsxTestFixtureBuilder().WithHeaderRow(3)
            .WithHeaders("Марка", "Core", "Сечение C", "Pair", "Сечение P")
            .AddRow("TEST", "1C", null, "", "")
            .WithFormula("C4", "1/2", "0.5").Build();
        var preview = await PreviewAsync(bytes, XlsxKnownProfiles.Get("technology.wires").Mapping);
        Assert.True(preview.Validation.IsValid);
        Assert.Equal(0.5m, preview.Records[0].Payload.GetProperty("Сечение C").GetDecimal());
    }

    [Fact]
    public async Task Wire_profile_preserves_duplicate_headers_and_source_errors_and_skips_notes_without_a_mark()
    {
        var bytes = new XlsxTestFixtureBuilder().WithHeaderRow(3)
            .WithHeaders("Марка", "Core", "Сечение C", "Pair", "Сечение P", "Жесткость", "Дубликат", "Цена")
            .WithDuplicateHeader(6, "Жесткость").WithError("H4", "#REF!")
            .AddRow("TEST", "1C", "30", "", "", "Гибкий", "Другое", "#REF!")
            .AddRow(null, null, null, null, null, "ПАМЯТКА", null, null).Build();
        var preview = await PreviewAsync(bytes, XlsxKnownProfiles.Get("technology.wires").Mapping);
        Assert.True(preview.Validation.IsValid);
        var record = Assert.Single(preview.Records);
        Assert.Equal("Гибкий", record.Payload.GetProperty("Жесткость").GetString());
        Assert.Equal("Другое", record.Payload.GetProperty("Жесткость [G]").GetString());
        Assert.Equal("#REF!", record.Payload.GetProperty("Цена").GetString());
        Assert.Contains(preview.Validation.Diagnostics, d => d.Code == "xlsx_duplicate_header_preserved");
        Assert.Contains(preview.Validation.Diagnostics, d => d.Code == "xlsx_unkeyed_rows_skipped");
        Assert.Contains(preview.Validation.Diagnostics, d => d.Code == "xlsx_source_error_preserved");
    }
    [Fact]
    public async Task Valid_workbook_builds_preview_without_publishing_and_preserves_textual_zero()
    {
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.MinimalValidWorkbook());

        Assert.True(preview.Validation.IsValid);
        Assert.Equal("Catalog", preview.SelectedSheet);
        Assert.Equal(1, preview.RecordCount);
        Assert.Equal("TER-001", Assert.Single(preview.Records).SourceKey);
        Assert.Equal("0", preview.Records[0].Payload.GetProperty("Value").GetString());
        Assert.StartsWith("sha256:" + preview.SourceSha256 + ";mapping-sha256:", preview.Validation.Snapshot!.Provenance.VersionFingerprint);
    }

    [Fact]
    public async Task Missing_key_column_is_an_addressed_blocking_diagnostic()
    {
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.MissingRequiredColumnWorkbook());

        Assert.False(preview.Validation.IsValid);
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_required_column_missing" &&
            item.Field == "RecordKey" &&
            item.SourceLocation == "'Catalog'!1");
    }

    [Fact]
    public async Task Mapped_formula_uses_cached_value_and_warns_without_blocking()
    {
        var mapping = DefaultMapping() with
        {
            Fields = [new XlsxFieldMapping("Computed", "computed", XlsxFieldValueKind.Decimal, Required: true)],
        };
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.FormulaWorkbook(), mapping);

        Assert.True(preview.Validation.IsValid);
        Assert.Equal(2m, Assert.Single(preview.Records).Payload.GetProperty("computed").GetDecimal());
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_cached_formula_values_used" &&
            item.Field == "computed" &&
            item.Severity == ReferenceCatalogDiagnosticSeverity.Warning &&
            item.SourceLocation == "'Catalog'!E2");
    }

    [Fact]
    public async Task Required_formula_without_cached_value_blocks_import()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .WithHeaders("RecordKey", "Computed")
            .AddRow("TER-001", null)
            .WithFormula("B2", "1+1", "")
            .Build();
        var mapping = DefaultMapping() with
        {
            Fields = [new XlsxFieldMapping("Computed", "computed", XlsxFieldValueKind.Decimal, Required: true)],
        };

        var preview = await PreviewAsync(bytes, mapping);

        Assert.False(preview.Validation.IsValid);
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_formula_cached_value_missing" && item.SourceLocation == "'Catalog'!B2");
    }

    [Fact]
    public async Task Raw_scalar_mapping_distinguishes_number_text_blank_boolean_and_shared_string()
    {
        var mapping = new XlsxCatalogMapping(
            "Catalog", 1, 2, "terminal", "RecordKey",
            [
                new XlsxFieldMapping("NumericZero", "NumericZero"),
                new XlsxFieldMapping("TextZero", "TextZero"),
                new XlsxFieldMapping("EmptyText", "EmptyText", AllowBlank: true),
                new XlsxFieldMapping("Enabled", "Enabled"),
                new XlsxFieldMapping("SharedText", "SharedText"),
            ]);
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.TypedScalarWorkbook(), mapping);

        Assert.True(preview.Validation.IsValid);
        var record = Assert.Single(preview.Records);
        Assert.Equal("0007", record.SourceKey);
        Assert.Equal(0, record.Payload.GetProperty("NumericZero").GetInt64());
        Assert.Equal("0", record.Payload.GetProperty("TextZero").GetString());
        Assert.Equal("", record.Payload.GetProperty("EmptyText").GetString());
        Assert.True(record.Payload.GetProperty("Enabled").GetBoolean());
        Assert.Equal("Общая строка", record.Payload.GetProperty("SharedText").GetString());
    }

    [Fact]
    public async Task Duplicate_header_is_a_blocking_addressed_diagnostic()
    {
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.DuplicateHeaderWorkbook());

        Assert.False(preview.Validation.IsValid);
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_duplicate_header" && item.SourceLocation == "'Catalog'!C1");
    }

    [Fact]
    public async Task Preview_is_bounded_but_candidate_keeps_all_records()
    {
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.PreviewTruncationWorkbook());

        Assert.True(preview.Validation.IsValid);
        Assert.True(preview.IsTruncated);
        Assert.Equal(101, preview.SourceRowCount);
        Assert.Equal(101, preview.RecordCount);
        Assert.Equal(XlsxReferenceCatalogReader.MaximumPreviewRows, preview.Records.Count);
        Assert.Equal(101, preview.Validation.Snapshot!.Records.Count);
    }

    [Fact]
    public async Task Data_beyond_supported_row_range_is_rejected_instead_of_silently_truncated()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .AddRow("TER-001", "Terminal 1", "0", "mm")
            .WithSharedString("A100001", "TER-OVER-LIMIT")
            .Build();

        var error = await Assert.ThrowsAsync<XlsxImportException>(() => PreviewAsync(bytes));

        Assert.Equal("xlsx_row_limit", error.Code);
        Assert.Equal("'Catalog'!100001", error.SourceLocation);
    }

    [Fact]
    public async Task Required_blank_and_not_applicable_policy_are_distinct()
    {
        var blankBytes = new XlsxTestFixtureBuilder()
            .WithHeaders("RecordKey", "Value")
            .AddRow("TER-001", "")
            .Build();
        var strictMapping = new XlsxCatalogMapping(
            "Catalog", 1, 2, "terminal", "RecordKey",
            [new XlsxFieldMapping("Value", "value", Required: true)]);

        var blank = await PreviewAsync(blankBytes, strictMapping);
        Assert.Contains(blank.Validation.Diagnostics, item => item.Code == "xlsx_required_value_blank");

        var naBytes = new XlsxTestFixtureBuilder()
            .WithHeaders("RecordKey", "Value")
            .AddRow("TER-001", "-")
            .Build();
        var allowedMapping = strictMapping with
        {
            Fields = [new XlsxFieldMapping(
                "Value", "value", Required: true,
                NotApplicableTokens: ["-"], AllowNotApplicable: true)],
        };
        var notApplicable = await PreviewAsync(naBytes, allowedMapping);

        Assert.True(notApplicable.Validation.IsValid);
        Assert.Equal(System.Text.Json.JsonValueKind.Null,
            Assert.Single(notApplicable.Records).Payload.GetProperty("value").ValueKind);
    }

    [Fact]
    public async Task Optional_physical_blank_requires_explicit_permission()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .WithHeaders("RecordKey", "Value")
            .AddRow("TER-001", "")
            .Build();
        var strict = DefaultMapping() with
        {
            Fields = [new XlsxFieldMapping("Value", "value")],
        };
        var allowed = strict with
        {
            Fields = [new XlsxFieldMapping("Value", "value", AllowBlank: true)],
        };

        var rejected = await PreviewAsync(bytes, strict);
        var accepted = await PreviewAsync(bytes, allowed);

        Assert.Contains(rejected.Validation.Diagnostics, item => item.Code == "xlsx_blank_not_allowed");
        Assert.True(accepted.Validation.IsValid);
        Assert.Equal("", Assert.Single(accepted.Records).Payload.GetProperty("value").GetString());
    }

    [Fact]
    public void Interpretation_fingerprint_changes_with_mapping_and_file_identity()
    {
        var bytes = XlsxTestFixtureBuilder.MinimalValidWorkbook();
        var first = DefaultMapping();
        var second = first with { EntityType = "wire" };

        Assert.NotEqual(
            XlsxReferenceCatalogReader.CreateVersionFingerprint(bytes, "catalog.xlsx", first),
            XlsxReferenceCatalogReader.CreateVersionFingerprint(bytes, "catalog.xlsx", second));
        Assert.NotEqual(
            XlsxReferenceCatalogReader.CreateVersionFingerprint(bytes, "catalog.xlsx", first),
            XlsxReferenceCatalogReader.CreateVersionFingerprint(bytes, "renamed.xlsx", first));
    }

    [Fact]
    public async Task Formula_in_unmapped_data_column_is_still_blocking()
    {
        var mapping = DefaultMapping() with
        {
            Fields = [new XlsxFieldMapping("Name", "name")],
        };

        var preview = await PreviewAsync(XlsxTestFixtureBuilder.FormulaWorkbook(), mapping);

        Assert.False(preview.Validation.IsValid);
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_formula_not_allowed" && item.SourceLocation == "'Catalog'!E2");
    }

    [Fact]
    public async Task Known_profile_uses_only_its_table_and_imports_acknowledged_cached_formula_values()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .WithWorksheetName("БД.ОП")
            .WithHeaderRow(2)
            .WithHeaders(
                "Номер", "Название", "Апликаторы / модули", "Программа", "Машина", "Полуфабрикат",
                "Провод", "Разъем", "Инструмент", "Время Операции", "Время подготовки, сек",
                "Расход на настройку м; шт;", "Время Чел, сек/оп; сек/м", "Время машины, сек/оп; сек/м",
                "Уд.Цена ЧЛ, сек", "Уд.Цена ЧЛ_МАГ, сек", "Уд.Цена МШ, сек", "Тип операции",
                "Время ручных работ для взятия полуфабриката", "Время ручных работ",
                "Время ручных работ для снятия полуфабриката", "Скорость проката, сек/м",
                "Скорость работы инструмента", "Кол-во операций инструмента", "Время доп.операции",
                "Инструкция", "Отказы")
            .AddRow("CUT_WIRE_auto", "Резка", null, null, "EW-05F", null, null, null, null, null,
                "180", "2", "0", null, "0.4", "0.4", "0.1", "Погонный", null, null, null,
                "3", "0.5", "1", null, "word", "word")
            .WithFormula("J3", "MAX(M3,N3)", "3.5")
            .WithFormula("N3", "V3+W3*X3", "3.5")
            .WithFormula("AA4", "1+1", "2")
            .Build();
        var profile = XlsxKnownProfiles.Get("technology.operations");

        var preview = await PreviewAsync(bytes, profile.Mapping);

        Assert.True(preview.Validation.IsValid);
        var record = Assert.Single(preview.Records);
        Assert.Equal("CUT_WIRE_auto", record.SourceKey);
        Assert.Equal(3.5m, record.Payload.GetProperty("legacyOperationTime").GetDecimal());
        Assert.Equal(3.5m, record.Payload.GetProperty("legacyMachineTime").GetDecimal());
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_cached_formula_values_used" &&
            item.Field == "legacyOperationTime" &&
            item.Severity == ReferenceCatalogDiagnosticSeverity.Warning);
        Assert.DoesNotContain(preview.Validation.Diagnostics, item => item.SourceLocation == "'БД.ОП'!AA4");
    }

    [Fact]
    public async Task Composite_profile_preserves_duplicate_variants_and_materializes_only_present_layers()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .WithHeaders("Series", "Cable", "D1", "D2", "D3", "L1", "L2", "L3")
            .AddRow("BNC", "RG58", "1.0", "-", "3.5", "5", "0", "12")
            .AddRow("BNC", "RG58", "1.0", "-", "3.5", "5", "0", "12")
            .Build();
        var mapping = new XlsxCatalogMapping(
            "Catalog", 1, 2, "coax-termination", "Cable",
            [
                new XlsxFieldMapping("Series", "series", XlsxFieldValueKind.TextScalar),
                new XlsxFieldMapping("Cable", "cable", XlsxFieldValueKind.TextScalar),
                new XlsxFieldMapping("D1", "layerD1", SkipBlank: true),
                new XlsxFieldMapping("D2", "layerD2", SkipBlank: true),
                new XlsxFieldMapping("D3", "layerD3", SkipBlank: true),
                new XlsxFieldMapping("L1", "layerL1", SkipBlank: true),
                new XlsxFieldMapping("L2", "layerL2", SkipBlank: true),
                new XlsxFieldMapping("L3", "layerL3", SkipBlank: true),
            ],
            CompositeKeyColumns: ["Series", "Cable", "L1", "L2", "L3"],
            PreserveDuplicateRows: true,
            LayerArray: new XlsxLayerArrayMapping(
                "layers",
                [
                    new XlsxLayerMemberMapping(1, "layerD1", "layerL1"),
                    new XlsxLayerMemberMapping(2, "layerD2", "layerL2"),
                    new XlsxLayerMemberMapping(3, "layerD3", "layerL3"),
                ],
                ["-", "—"]));

        var preview = await PreviewAsync(bytes, mapping);

        Assert.True(preview.Validation.IsValid);
        Assert.Equal(2, preview.RecordCount);
        Assert.EndsWith(" #1", preview.Records[0].SourceKey, StringComparison.Ordinal);
        Assert.EndsWith(" #2", preview.Records[1].SourceKey, StringComparison.Ordinal);
        Assert.NotEqual(preview.Records[0].SourceKey, preview.Records[1].SourceKey);
        var layers = preview.Records[0].Payload.GetProperty("layers");
        Assert.Equal(2, layers.GetArrayLength());
        Assert.Equal(1, layers[0].GetProperty("index").GetInt32());
        Assert.Equal("5", layers[0].GetProperty("stripLengthMm").GetString());
        Assert.Equal(3, layers[1].GetProperty("index").GetInt32());
        Assert.Equal("12", layers[1].GetProperty("stripLengthMm").GetString());
        Assert.False(preview.Records[0].Payload.TryGetProperty("layerD1", out _));
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_duplicate_rows_preserved" &&
            item.Severity == ReferenceCatalogDiagnosticSeverity.Warning);
    }

    [Fact]
    public async Task SprKab_known_profiles_read_their_independent_table_layouts()
    {
        var coaxBytes = new XlsxTestFixtureBuilder()
            .WithWorksheetName("СПР.КАБ")
            .WithHeaders("Кабель", "D1", "D2", "D3")
            .AddRow("RG-58", "0.9", "3.0", "5.0")
            .Build();
        var awgHeaders = new[]
        {
            "AWG", "ГОСТ", "Ø жилы", "МГТФ", "МС", "M22759", "PTFE", "UL1061", "UL1571",
            "UL1007", "UL1015", "МГШВ", "НВ-4", "Силикон", "РКГМ", "ПВАМ", "ПГВА", "FLRY", "TXL", "GXL",
        };
        var awgBytes = new XlsxTestFixtureBuilder()
            .WithWorksheetName("СПР.КАБ")
            .WithHeaderRow(28)
            .WithHeaders(awgHeaders)
            .AddRow("36", "0.01", "0.127", "0.45", "—", "0.5", "0.45")
            .WithNumber("A29", "36")
            .Build();

        var coax = await PreviewAsync(coaxBytes, XlsxKnownProfiles.Get("technology.coax-cables").Mapping);
        var awg = await PreviewAsync(awgBytes, XlsxKnownProfiles.Get("technology.awg-reference").Mapping);

        Assert.True(coax.Validation.IsValid);
        Assert.Equal(3, Assert.Single(coax.Records).Payload.GetProperty("layers").GetArrayLength());
        Assert.True(awg.Validation.IsValid);
        Assert.Equal("36", Assert.Single(awg.Records).SourceKey);
        Assert.Equal("0.01", awg.Records[0].Payload.GetProperty("sectionMm2").GetString());
    }

    [Fact]
    public async Task External_relationship_and_corrupt_zip_are_rejected_before_candidate_creation()
    {
        var external = await Assert.ThrowsAsync<XlsxImportException>(() =>
            PreviewAsync(XlsxTestFixtureBuilder.ExternalReferenceWorkbook()));
        var corrupt = await Assert.ThrowsAsync<XlsxImportException>(() =>
            PreviewAsync(XlsxTestFixtureBuilder.CorruptZip()));

        Assert.Equal("xlsx_active_content_not_allowed", external.Code);
        Assert.Equal("xlsx_invalid", corrupt.Code);
    }

    [Theory]
    [InlineData("http://example.test/catalog/TER-001")]
    [InlineData("https://example.test/catalog/TER-001")]
    public async Task Web_hyperlink_relationship_is_accepted(string target)
    {
        var bytes = new XlsxTestFixtureBuilder()
            .AddRow("TER-001", "Terminal 1", "0", "mm")
            .WithWorksheetHyperlink("B2", new Uri(target))
            .Build();

        var preview = await PreviewAsync(bytes);

        Assert.True(preview.Validation.IsValid);
        Assert.Equal("TER-001", Assert.Single(preview.Records).SourceKey);
    }

    [Fact]
    public async Task File_hyperlink_relationship_is_rejected()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .AddRow("TER-001", "Terminal 1", "0", "mm")
            .WithWorksheetHyperlink("B2", new Uri("file:///C:/fixtures/terminal.html"))
            .Build();

        var error = await Assert.ThrowsAsync<XlsxImportException>(() => PreviewAsync(bytes));

        Assert.Equal("xlsx_external_relationship_not_allowed", error.Code);
        Assert.Equal("xl/worksheets/_rels/sheet1.xml.rels", error.SourceLocation);
    }

    [Fact]
    public async Task Spoofed_relationship_type_ending_in_hyperlink_is_rejected()
    {
        var bytes = new XlsxTestFixtureBuilder()
            .AddRow("TER-001", "Terminal 1", "0", "mm")
            .WithWorksheetHyperlink(
                "B2",
                new Uri("https://example.test/catalog/TER-001"),
                "https://attacker.example/relationships/hyperlink")
            .Build();

        var error = await Assert.ThrowsAsync<XlsxImportException>(() => PreviewAsync(bytes));

        Assert.Equal("xlsx_external_relationship_not_allowed", error.Code);
        Assert.Equal("xl/worksheets/_rels/sheet1.xml.rels", error.SourceLocation);
    }

    [Fact]
    public async Task External_workbook_relationship_is_rejected()
    {
        var error = await Assert.ThrowsAsync<XlsxImportException>(() =>
            PreviewAsync(XlsxTestFixtureBuilder.ExternalReferenceWorkbook()));

        Assert.Equal("xlsx_active_content_not_allowed", error.Code);
    }

    private static XlsxCatalogMapping DefaultMapping() => new(
        "Catalog",
        HeaderRow: 1,
        FirstDataRow: 2,
        EntityType: "terminal",
        KeyColumn: "RecordKey");

    private static Task<XlsxCatalogPreview> PreviewAsync(byte[] bytes, XlsxCatalogMapping? mapping = null) =>
        new XlsxReferenceCatalogReader().PreviewAsync(
            new MemoryStream(bytes, writable: false),
            "catalog.xlsx",
            "technology-database",
            mapping ?? DefaultMapping(),
            new ReferenceCatalogSnapshotIdentity(Guid.Parse("10000000-0000-0000-0000-000000000001")),
            new DateTimeOffset(2026, 9, 12, 18, 0, 0, TimeSpan.Zero),
            TestContext.Current.CancellationToken);
}
