param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot
)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$manifestPath = Join-Path $resolvedRoot "PACKAGE-MANIFEST.json"
$versionPath = Join-Path $resolvedRoot "VERSION.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if ($manifest.format -ne 1 -or $manifest.algorithm -ne "SHA-256") {
    throw "Unsupported package manifest"
}

$actualVersionHash = (Get-FileHash -LiteralPath $versionPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualVersionHash -ne $manifest.productManifestSha256) {
    throw "VERSION.json checksum mismatch"
}

$expected = @{}
foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if ([string]::IsNullOrWhiteSpace($relative) -or
        [System.IO.Path]::IsPathRooted($relative) -or
        $relative.Contains("..") -or
        $expected.ContainsKey($relative.ToLowerInvariant())) {
        throw "Invalid or duplicate manifest path: $relative"
    }
    $expected[$relative.ToLowerInvariant()] = $entry
}

$actualFiles = Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File |
    Where-Object Name -ne "PACKAGE-MANIFEST.json"
if ($actualFiles.Count -ne $expected.Count) { throw "Package inventory count mismatch" }

foreach ($file in $actualFiles) {
    $relative = $file.FullName.Substring($resolvedRoot.Length + 1).Replace('\', '/')
    $key = $relative.ToLowerInvariant()
    if (!$expected.ContainsKey($key)) { throw "Unexpected package file: $relative" }
    $entry = $expected[$key]
    $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($file.Length -ne $entry.bytes -or $hash -ne $entry.sha256) {
        throw "Package file checksum mismatch: $relative"
    }
}

[pscustomobject]@{ Status = "ok"; Files = $actualFiles.Count; Package = $resolvedRoot }
