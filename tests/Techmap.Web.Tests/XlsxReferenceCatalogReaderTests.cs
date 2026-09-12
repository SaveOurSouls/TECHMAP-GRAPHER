using Techmap.Domain;
using Techmap.Infrastructure.Xlsx;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class XlsxReferenceCatalogReaderTests
{
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
    public async Task Formula_cached_value_is_never_imported()
    {
        var preview = await PreviewAsync(XlsxTestFixtureBuilder.FormulaWorkbook());

        Assert.False(preview.Validation.IsValid);
        Assert.Contains(preview.Validation.Diagnostics, item =>
            item.Code == "xlsx_formula_not_allowed" && item.SourceLocation == "'Catalog'!E2");
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
