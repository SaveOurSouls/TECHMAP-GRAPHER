using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Techmap.Web.Tests;

internal sealed class XlsxTestFixtureBuilder
{
    private const string SpreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private const string OfficeRelationshipsNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private const string PackageRelationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
    private const string ContentTypesNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
    private static readonly DateTimeOffset StableEntryTimestamp =
        new(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly string[] DefaultHeaders = ["RecordKey", "Name", "Value", "Unit"];

    private readonly List<string?> headers = [.. DefaultHeaders];
    private readonly List<IReadOnlyList<string?>> rows = [];
    private readonly Dictionary<string, FormulaCell> formulas = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, ScalarCell> scalarCells = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<string> sharedStrings = [];
    private readonly List<WorksheetHyperlink> worksheetHyperlinks = [];
    private string worksheetName = "Catalog";
    private int headerRowNumber = 1;
    private Uri? externalReference;

    public static byte[] MinimalValidWorkbook() =>
        new XlsxTestFixtureBuilder()
            .AddRow("TER-001", "Terminal 1", "0", "mm")
            .Build();

    public static byte[] MissingRequiredColumnWorkbook(string requiredHeader = "RecordKey")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(requiredHeader);
        var remaining = DefaultHeaders
            .Where(header => !string.Equals(header, requiredHeader, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (remaining.Length == DefaultHeaders.Length)
        {
            throw new ArgumentException("The requested required header is not part of the default fixture.", nameof(requiredHeader));
        }

        return new XlsxTestFixtureBuilder()
            .WithHeaders(remaining)
            .AddRow("Terminal 1", "0", "mm")
            .Build();
    }

    public static byte[] FormulaWorkbook() =>
        new XlsxTestFixtureBuilder()
            .WithHeaders([.. DefaultHeaders, "Computed"])
            .AddRow("TER-001", "Terminal 1", "0", "mm", null)
            .WithFormula("E2", "1+1", "2")
            .Build();

    public static byte[] TypedScalarWorkbook() =>
        new XlsxTestFixtureBuilder()
            .WithHeaders("RecordKey", "NumericZero", "TextZero", "EmptyText", "Enabled", "SharedText")
            .AddRow("0007", null, "0", "", null, null)
            .WithNumber("B2", "0")
            .WithBoolean("E2", true)
            .WithSharedString("F2", "Общая строка")
            .Build();

    public static byte[] DuplicateHeaderWorkbook()
    {
        var builder = new XlsxTestFixtureBuilder();
        builder.headers.Clear();
        builder.headers.AddRange(["RecordKey", "Name", "Name"]);
        return builder.AddRow("TER-001", "Первое", "Второе").Build();
    }

    public static byte[] PreviewTruncationWorkbook()
    {
        var builder = new XlsxTestFixtureBuilder();
        for (var index = 1; index <= 101; index++)
        {
            builder.AddRow($"TER-{index:000}", $"Terminal {index}", index.ToString(), "mm");
        }
        return builder.Build();
    }

    public static byte[] ExternalReferenceWorkbook() =>
        new XlsxTestFixtureBuilder()
            .WithHeaders([.. DefaultHeaders, "ExternalValue"])
            .AddRow("TER-001", "Terminal 1", "0", "mm", null)
            .WithFormula("E2", "'[1]ExternalCatalog'!A1", "cached", cachedValueIsText: true)
            .WithExternalReference(new Uri("file:///C:/fixtures/external-catalog.xlsx"))
            .Build();

    public static byte[] CorruptZip() =>
        [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xff];

    public XlsxTestFixtureBuilder WithWorksheetName(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (name.Length > 31 || name.IndexOfAny(['[', ']', ':', '*', '?', '/', '\\']) >= 0)
        {
            throw new ArgumentException("The worksheet name is not valid for XLSX.", nameof(name));
        }

        worksheetName = name;
        return this;
    }

    public XlsxTestFixtureBuilder WithHeaders(params string[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (values.Length == 0 || values.Any(string.IsNullOrWhiteSpace))
        {
            throw new ArgumentException("At least one non-empty header is required.", nameof(values));
        }

        if (values.Distinct(StringComparer.OrdinalIgnoreCase).Count() != values.Length)
        {
            throw new ArgumentException("Headers must be unique ignoring case.", nameof(values));
        }

        headers.Clear();
        headers.AddRange(values);
        return this;
    }

    public XlsxTestFixtureBuilder WithHeaderRow(int rowNumber)
    {
        if (rowNumber is < 1 or > 1_048_575)
        {
            throw new ArgumentOutOfRangeException(nameof(rowNumber));
        }

        headerRowNumber = rowNumber;
        return this;
    }

    public XlsxTestFixtureBuilder AddRow(params string?[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        if (values.Length > headers.Count)
        {
            throw new ArgumentException("A fixture row cannot contain more cells than the header row.", nameof(values));
        }

        rows.Add(values.ToArray());
        return this;
    }

    public XlsxTestFixtureBuilder WithFormula(
        string cellReference,
        string formula,
        string cachedValue,
        bool cachedValueIsText = false)
    {
        var normalizedReference = NormalizeCellReference(cellReference);
        ArgumentException.ThrowIfNullOrWhiteSpace(formula);
        ArgumentNullException.ThrowIfNull(cachedValue);
        formulas[normalizedReference] = new FormulaCell(formula, cachedValue, cachedValueIsText);
        return this;
    }

    public XlsxTestFixtureBuilder WithNumber(string cellReference, string invariantValue)
    {
        var normalizedReference = NormalizeCellReference(cellReference);
        ArgumentException.ThrowIfNullOrWhiteSpace(invariantValue);
        scalarCells[normalizedReference] = new ScalarCell(ScalarCellKind.Number, invariantValue);
        return this;
    }

    public XlsxTestFixtureBuilder WithBoolean(string cellReference, bool value)
    {
        scalarCells[NormalizeCellReference(cellReference)] =
            new ScalarCell(ScalarCellKind.Boolean, value ? "1" : "0");
        return this;
    }

    public XlsxTestFixtureBuilder WithSharedString(string cellReference, string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var index = sharedStrings.Count;
        sharedStrings.Add(value);
        scalarCells[NormalizeCellReference(cellReference)] =
            new ScalarCell(ScalarCellKind.SharedString, index.ToString());
        return this;
    }

    public XlsxTestFixtureBuilder WithExternalReference(Uri source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!source.IsAbsoluteUri)
        {
            throw new ArgumentException("An external workbook reference must be an absolute URI.", nameof(source));
        }

        externalReference = source;
        return this;
    }

    public XlsxTestFixtureBuilder WithWorksheetHyperlink(
        string cellReference,
        Uri target,
        string relationshipType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink")
    {
        var normalizedReference = NormalizeCellReference(cellReference);
        ArgumentNullException.ThrowIfNull(target);
        ArgumentException.ThrowIfNullOrWhiteSpace(relationshipType);
        if (!target.IsAbsoluteUri)
        {
            throw new ArgumentException("A worksheet hyperlink target must be an absolute URI.", nameof(target));
        }

        worksheetHyperlinks.Add(new WorksheetHyperlink(normalizedReference, target, relationshipType));
        return this;
    }

    public string WriteTo(string directory, string fileName = "fixture.xlsx")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        if (!string.Equals(Path.GetExtension(fileName), ".xlsx", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("The fixture filename must have an .xlsx extension.", nameof(fileName));
        }

        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, fileName);
        File.WriteAllBytes(path, Build());
        return path;
    }

    public byte[] Build()
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true, Encoding.UTF8))
        {
            AddXml(archive, "[Content_Types].xml", ContentTypes());
            AddXml(archive, "_rels/.rels", PackageRelationships());
            AddXml(archive, "xl/workbook.xml", Workbook());
            AddXml(archive, "xl/_rels/workbook.xml.rels", WorkbookRelationships());
            AddXml(archive, "xl/worksheets/sheet1.xml", Worksheet());

            if (worksheetHyperlinks.Count > 0)
            {
                AddXml(archive, "xl/worksheets/_rels/sheet1.xml.rels", WorksheetRelationships());
            }

            if (sharedStrings.Count > 0)
            {
                AddXml(archive, "xl/sharedStrings.xml", SharedStringTable());
            }

            if (externalReference is not null)
            {
                AddXml(archive, "xl/externalLinks/externalLink1.xml", ExternalLink());
                AddXml(archive, "xl/externalLinks/_rels/externalLink1.xml.rels", ExternalLinkRelationships());
            }
        }

        return output.ToArray();
    }

    private XDocument ContentTypes()
    {
        XNamespace contentTypes = ContentTypesNamespace;
        var root = new XElement(contentTypes + "Types",
            new XElement(contentTypes + "Default",
                new XAttribute("Extension", "rels"),
                new XAttribute("ContentType", "application/vnd.openxmlformats-package.relationships+xml")),
            new XElement(contentTypes + "Default",
                new XAttribute("Extension", "xml"),
                new XAttribute("ContentType", "application/xml")),
            new XElement(contentTypes + "Override",
                new XAttribute("PartName", "/xl/workbook.xml"),
                new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
            new XElement(contentTypes + "Override",
                new XAttribute("PartName", "/xl/worksheets/sheet1.xml"),
                new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")));

        if (sharedStrings.Count > 0)
        {
            root.Add(new XElement(contentTypes + "Override",
                new XAttribute("PartName", "/xl/sharedStrings.xml"),
                new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml")));
        }

        if (externalReference is not null)
        {
            root.Add(new XElement(contentTypes + "Override",
                new XAttribute("PartName", "/xl/externalLinks/externalLink1.xml"),
                new XAttribute("ContentType", "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml")));
        }

        return XmlDocument(root);
    }

    private static XDocument PackageRelationships()
    {
        XNamespace relationships = PackageRelationshipsNamespace;
        return XmlDocument(new XElement(relationships + "Relationships",
            new XElement(relationships + "Relationship",
                new XAttribute("Id", "rId1"),
                new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
                new XAttribute("Target", "xl/workbook.xml"))));
    }

    private XDocument Workbook()
    {
        XNamespace spreadsheet = SpreadsheetNamespace;
        XNamespace relationships = OfficeRelationshipsNamespace;
        var root = new XElement(spreadsheet + "workbook",
            new XAttribute(XNamespace.Xmlns + "r", relationships),
            new XElement(spreadsheet + "workbookPr", new XAttribute("updateLinks", "never")),
            new XElement(spreadsheet + "sheets",
                new XElement(spreadsheet + "sheet",
                    new XAttribute("name", worksheetName),
                    new XAttribute("sheetId", "1"),
                    new XAttribute(relationships + "id", "rId1"))));

        if (externalReference is not null)
        {
            root.Add(new XElement(spreadsheet + "externalReferences",
                new XElement(spreadsheet + "externalReference",
                    new XAttribute(relationships + "id", sharedStrings.Count > 0 ? "rId3" : "rId2"))));
        }

        root.Add(new XElement(spreadsheet + "calcPr",
            new XAttribute("calcMode", "manual"),
            new XAttribute("fullCalcOnLoad", "0"),
            new XAttribute("forceFullCalc", "0")));
        return XmlDocument(root);
    }

    private XDocument WorkbookRelationships()
    {
        XNamespace relationships = PackageRelationshipsNamespace;
        var root = new XElement(relationships + "Relationships",
            new XElement(relationships + "Relationship",
                new XAttribute("Id", "rId1"),
                new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"),
                new XAttribute("Target", "worksheets/sheet1.xml")));

        if (sharedStrings.Count > 0)
        {
            root.Add(new XElement(relationships + "Relationship",
                new XAttribute("Id", "rId2"),
                new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"),
                new XAttribute("Target", "sharedStrings.xml")));
        }

        if (externalReference is not null)
        {
            root.Add(new XElement(relationships + "Relationship",
                new XAttribute("Id", sharedStrings.Count > 0 ? "rId3" : "rId2"),
                new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink"),
                new XAttribute("Target", "externalLinks/externalLink1.xml")));
        }

        return XmlDocument(root);
    }

    private XDocument Worksheet()
    {
        XNamespace spreadsheet = SpreadsheetNamespace;
        var cells = new Dictionary<string, XElement>(StringComparer.OrdinalIgnoreCase);
        AddTextRow(cells, headerRowNumber, headers);
        for (var index = 0; index < rows.Count; index++)
        {
            AddTextRow(cells, headerRowNumber + index + 1, rows[index]);
        }

        foreach (var formula in formulas)
        {
            cells[formula.Key] = FormulaElement(spreadsheet, formula.Key, formula.Value);
        }

        foreach (var scalar in scalarCells)
        {
            cells[scalar.Key] = ScalarElement(spreadsheet, scalar.Key, scalar.Value);
        }

        var sheetData = new XElement(spreadsheet + "sheetData");
        foreach (var row in cells
            .Select(cell => new { Reference = ParseCellReference(cell.Key), Cell = cell.Value })
            .GroupBy(cell => cell.Reference.Row)
            .OrderBy(group => group.Key))
        {
            sheetData.Add(new XElement(spreadsheet + "row",
                new XAttribute("r", row.Key),
                row.OrderBy(cell => cell.Reference.Column).Select(cell => cell.Cell)));
        }

        XNamespace relationships = OfficeRelationshipsNamespace;
        var root = new XElement(spreadsheet + "worksheet",
            new XAttribute(XNamespace.Xmlns + "r", relationships),
            sheetData);
        if (worksheetHyperlinks.Count > 0)
        {
            root.Add(new XElement(spreadsheet + "hyperlinks",
                worksheetHyperlinks.Select((hyperlink, index) =>
                    new XElement(spreadsheet + "hyperlink",
                        new XAttribute("ref", hyperlink.CellReference),
                        new XAttribute(relationships + "id", $"rId{index + 1}")))));
        }

        return XmlDocument(root);
    }

    private XDocument WorksheetRelationships()
    {
        XNamespace relationships = PackageRelationshipsNamespace;
        return XmlDocument(new XElement(relationships + "Relationships",
            worksheetHyperlinks.Select((hyperlink, index) =>
                new XElement(relationships + "Relationship",
                    new XAttribute("Id", $"rId{index + 1}"),
                    new XAttribute("Type", hyperlink.RelationshipType),
                    new XAttribute("Target", hyperlink.Target.AbsoluteUri),
                    new XAttribute("TargetMode", "External")))));
    }

    private static void AddTextRow(
        IDictionary<string, XElement> cells,
        int rowNumber,
        IReadOnlyList<string?> values)
    {
        XNamespace spreadsheet = SpreadsheetNamespace;
        for (var index = 0; index < values.Count; index++)
        {
            if (values[index] is not { } value)
            {
                continue;
            }

            var reference = $"{ColumnName(index + 1)}{rowNumber}";
            var text = new XElement(spreadsheet + "t", value);
            if (value.Length != value.Trim().Length)
            {
                text.Add(new XAttribute(XNamespace.Xml + "space", "preserve"));
            }

            cells[reference] = new XElement(spreadsheet + "c",
                new XAttribute("r", reference),
                new XAttribute("t", "inlineStr"),
                new XElement(spreadsheet + "is", text));
        }
    }

    private static XElement FormulaElement(
        XNamespace spreadsheet,
        string reference,
        FormulaCell formula) =>
        new(spreadsheet + "c",
            new XAttribute("r", reference),
            formula.CachedValueIsText ? new XAttribute("t", "str") : null,
            new XElement(spreadsheet + "f", formula.Expression),
            new XElement(spreadsheet + "v", formula.CachedValue));

    private static XElement ScalarElement(
        XNamespace spreadsheet,
        string reference,
        ScalarCell scalar) =>
        new(spreadsheet + "c",
            new XAttribute("r", reference),
            scalar.Kind switch
            {
                ScalarCellKind.Boolean => new XAttribute("t", "b"),
                ScalarCellKind.SharedString => new XAttribute("t", "s"),
                _ => null,
            },
            new XElement(spreadsheet + "v", scalar.Value));

    private XDocument SharedStringTable()
    {
        XNamespace spreadsheet = SpreadsheetNamespace;
        return XmlDocument(new XElement(spreadsheet + "sst",
            new XAttribute("count", sharedStrings.Count),
            new XAttribute("uniqueCount", sharedStrings.Count),
            sharedStrings.Select(value => new XElement(spreadsheet + "si", new XElement(spreadsheet + "t", value)))));
    }

    private static XDocument ExternalLink()
    {
        XNamespace spreadsheet = SpreadsheetNamespace;
        XNamespace relationships = OfficeRelationshipsNamespace;
        return XmlDocument(new XElement(spreadsheet + "externalLink",
            new XAttribute(XNamespace.Xmlns + "r", relationships),
            new XElement(spreadsheet + "externalBook",
                new XAttribute(relationships + "id", "rId1"),
                new XElement(spreadsheet + "sheetNames",
                    new XElement(spreadsheet + "sheetName", new XAttribute("val", "ExternalCatalog"))))));
    }

    private XDocument ExternalLinkRelationships()
    {
        XNamespace relationships = PackageRelationshipsNamespace;
        return XmlDocument(new XElement(relationships + "Relationships",
            new XElement(relationships + "Relationship",
                new XAttribute("Id", "rId1"),
                new XAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath"),
                new XAttribute("Target", externalReference!.AbsoluteUri),
                new XAttribute("TargetMode", "External"))));
    }

    private static XDocument XmlDocument(XElement root) =>
        new(new XDeclaration("1.0", "UTF-8", "yes"), root);

    private static void AddXml(ZipArchive archive, string path, XDocument document)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.NoCompression);
        entry.LastWriteTime = StableEntryTimestamp;
        entry.ExternalAttributes = 0;
        using var entryStream = entry.Open();
        using var writer = XmlWriter.Create(entryStream, new XmlWriterSettings
        {
            Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            Indent = false,
            CloseOutput = false,
        });
        document.Save(writer);
    }

    private static string NormalizeCellReference(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var parsed = ParseCellReference(value);
        return $"{ColumnName(parsed.Column)}{parsed.Row}";
    }

    private static (int Column, int Row) ParseCellReference(string value)
    {
        var split = 0;
        while (split < value.Length && char.IsAsciiLetter(value[split]))
        {
            split++;
        }

        if (split == 0 || split == value.Length ||
            !int.TryParse(value.AsSpan(split), out var row) || row <= 0)
        {
            throw new ArgumentException("A cell reference must use A1 notation.", nameof(value));
        }

        var column = 0;
        foreach (var character in value.AsSpan(0, split))
        {
            column = checked((column * 26) + (char.ToUpperInvariant(character) - 'A' + 1));
        }

        if (column is <= 0 or > 16_384 || row > 1_048_576)
        {
            throw new ArgumentOutOfRangeException(nameof(value), "The cell reference exceeds XLSX limits.");
        }

        return (column, row);
    }

    private static string ColumnName(int number)
    {
        var builder = new StringBuilder();
        while (number > 0)
        {
            number--;
            builder.Insert(0, (char)('A' + (number % 26)));
            number /= 26;
        }

        return builder.ToString();
    }

    private sealed record FormulaCell(string Expression, string CachedValue, bool CachedValueIsText);
    private sealed record ScalarCell(ScalarCellKind Kind, string Value);
    private sealed record WorksheetHyperlink(string CellReference, Uri Target, string RelationshipType);
    private enum ScalarCellKind { Number, Boolean, SharedString }
}
