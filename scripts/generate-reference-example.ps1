param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [IO.Path]::GetDirectoryName($resolvedOutput)
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
Remove-Item -LiteralPath $resolvedOutput -Force -ErrorAction SilentlyContinue

$utf8 = [Text.UTF8Encoding]::new($false)
$stableTimestamp = [DateTimeOffset]::new(2026, 9, 13, 0, 0, 0, [TimeSpan]::Zero)

function Add-XlsxPart {
    param(
        [Parameter(Mandatory = $true)]$Archive,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    $entry = $Archive.CreateEntry($Path, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $stableTimestamp
    $stream = $entry.Open()
    try {
        $bytes = $utf8.GetBytes($Content)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

$rows = @(
    @("RecordKey", "Name", "Series", "CrossSection", "Color"),
    @("WIRE-0001", "Hook-up wire", "MW-1", "0.35", "Red"),
    @("WIRE-0002", "Hook-up wire", "MW-1", "0.50", "Black"),
    @("WIRE-0003", "Hook-up wire", "MW-2", "0.75", "White"),
    @("WIRE-0004", "Shielded wire", "SH-1", "1.00", "Gray"),
    @("WIRE-0005", "Power wire", "PW-1", "2.50", "Blue"),
    @("WIRE-0006", "Twisted-pair wire", "TP-1", "0.22", "Orange"),
    @("0007", "Leading-zero key example", "TEST", "0", "Green")
)

function ConvertTo-InlineCell {
    param([string]$Reference, [string]$Value)
    $escaped = [Security.SecurityElement]::Escape($Value)
    return "<c r=`"$Reference`" t=`"inlineStr`"><is><t>$escaped</t></is></c>"
}

$sheetRows = for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
    $rowNumber = $rowIndex + 1
    $cells = for ($columnIndex = 0; $columnIndex -lt $rows[$rowIndex].Count; $columnIndex++) {
        $column = [char]([int][char]'A' + $columnIndex)
        ConvertTo-InlineCell -Reference "$column$rowNumber" -Value $rows[$rowIndex][$columnIndex]
    }
    "<row r=`"$rowNumber`">$($cells -join '')</row>"
}

$contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>'
$packageRelationships = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
$workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<workbookPr updateLinks="never"/><sheets><sheet name="Catalog" sheetId="1" r:id="rId1"/></sheets>' +
    '<calcPr calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/></workbook>'
$workbookRelationships = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>'
$worksheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:E8"/><sheetData>' + ($sheetRows -join '') + '</sheetData></worksheet>'

$fileStream = [IO.File]::Open($resolvedOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
try {
    $archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false, $utf8)
    try {
        Add-XlsxPart $archive '[Content_Types].xml' $contentTypes
        Add-XlsxPart $archive '_rels/.rels' $packageRelationships
        Add-XlsxPart $archive 'xl/workbook.xml' $workbook
        Add-XlsxPart $archive 'xl/_rels/workbook.xml.rels' $workbookRelationships
        Add-XlsxPart $archive 'xl/worksheets/sheet1.xml' $worksheet
    } finally {
        $archive.Dispose()
    }
} finally {
    $fileStream.Dispose()
}

[pscustomobject]@{
    Path = $resolvedOutput
    Bytes = (Get-Item -LiteralPath $resolvedOutput).Length
    Sha256 = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash.ToLowerInvariant()
}
