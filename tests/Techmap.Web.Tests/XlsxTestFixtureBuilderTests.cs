using System.IO.Compression;
using System.Xml.Linq;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class XlsxTestFixtureBuilderTests
{
    private static readonly XNamespace Spreadsheet =
        "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace PackageRelationships =
        "http://schemas.openxmlformats.org/package/2006/relationships";

    [Fact]
    public void Minimal_workbook_contains_required_open_xml_parts_and_inline_cells()
    {
        using var archive = Open(XlsxTestFixtureBuilder.MinimalValidWorkbook());

        Assert.NotNull(archive.GetEntry("[Content_Types].xml"));
        Assert.NotNull(archive.GetEntry("_rels/.rels"));
        Assert.NotNull(archive.GetEntry("xl/workbook.xml"));
        Assert.NotNull(archive.GetEntry("xl/_rels/workbook.xml.rels"));
        var worksheet = ReadXml(archive, "xl/worksheets/sheet1.xml");
        Assert.Equal(
            ["RecordKey", "Name", "Value", "Unit", "TER-001", "Terminal 1", "0", "mm"],
            worksheet.Descendants(Spreadsheet + "t").Select(element => element.Value));
    }

    [Fact]
    public void Missing_column_fixture_omits_record_key_header()
    {
        using var archive = Open(XlsxTestFixtureBuilder.MissingRequiredColumnWorkbook());
        var worksheet = ReadXml(archive, "xl/worksheets/sheet1.xml");

        Assert.DoesNotContain(
            worksheet.Descendants(Spreadsheet + "t"),
            element => element.Value == "RecordKey");
        Assert.Contains(
            worksheet.Descendants(Spreadsheet + "t"),
            element => element.Value == "Name");
    }

    [Fact]
    public void Formula_fixture_keeps_formula_and_cached_value_without_calculation()
    {
        using var archive = Open(XlsxTestFixtureBuilder.FormulaWorkbook());
        var worksheet = ReadXml(archive, "xl/worksheets/sheet1.xml");
        var formulaCell = Assert.Single(
            worksheet.Descendants(Spreadsheet + "c"),
            element => (string?)element.Attribute("r") == "E2");

        Assert.Equal("1+1", formulaCell.Element(Spreadsheet + "f")?.Value);
        Assert.Equal("2", formulaCell.Element(Spreadsheet + "v")?.Value);
        var workbook = ReadXml(archive, "xl/workbook.xml");
        Assert.Equal("manual", (string?)workbook.Descendants(Spreadsheet + "calcPr").Single().Attribute("calcMode"));
    }

    [Fact]
    public void External_reference_fixture_marks_target_external_and_disables_updates()
    {
        using var archive = Open(XlsxTestFixtureBuilder.ExternalReferenceWorkbook());
        var relationships = ReadXml(archive, "xl/externalLinks/_rels/externalLink1.xml.rels");
        var relationship = Assert.Single(relationships.Descendants(PackageRelationships + "Relationship"));

        Assert.Equal("External", (string?)relationship.Attribute("TargetMode"));
        Assert.Equal("file:///C:/fixtures/external-catalog.xlsx", (string?)relationship.Attribute("Target"));
        var workbook = ReadXml(archive, "xl/workbook.xml");
        Assert.Equal("never", (string?)workbook.Descendants(Spreadsheet + "workbookPr").Single().Attribute("updateLinks"));
    }

    [Fact]
    public void Corrupt_zip_fixture_cannot_be_opened_as_an_archive()
    {
        using var stream = new MemoryStream(XlsxTestFixtureBuilder.CorruptZip());
        Assert.Throws<InvalidDataException>(() => new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true));
    }

    private static ZipArchive Open(byte[] bytes) =>
        new(new MemoryStream(bytes), ZipArchiveMode.Read);

    private static XDocument ReadXml(ZipArchive archive, string path)
    {
        using var stream = Assert.IsType<ZipArchiveEntry>(archive.GetEntry(path)).Open();
        return XDocument.Load(stream);
    }
}
