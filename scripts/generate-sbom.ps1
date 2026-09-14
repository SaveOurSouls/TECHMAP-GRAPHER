param(
    [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")),
    [string]$PackageRoot,
    [string]$OutputPath,
    [string]$DotNetThirdPartyNoticesPath,
    [long]$SourceDateEpoch = -1
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path -LiteralPath $RepositoryRoot).Path
if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    $PackageRoot = Join-Path $repo "artifacts\m2-05\TECHMAP-GRAPHER"
}
if (-not (Test-Path -LiteralPath $PackageRoot -PathType Container)) { throw "Package root does not exist: $PackageRoot" }
$package = (Resolve-Path -LiteralPath $PackageRoot).Path
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $package "SBOM.spdx.json" }
if (-not (Test-Path -LiteralPath (Split-Path -Parent $OutputPath) -PathType Container)) { throw "SBOM output directory does not exist" }

$pnpmLock = Join-Path $repo "pnpm-lock.yaml"
$versionFile = Join-Path $repo "package\VERSION.json"
if (-not (Test-Path -LiteralPath $pnpmLock -PathType Leaf)) { throw "Missing pnpm-lock.yaml" }
if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) { throw "Missing package/VERSION.json" }

if ([string]::IsNullOrWhiteSpace($DotNetThirdPartyNoticesPath)) {
    $dotnetRoot = Split-Path -Parent (Get-Command dotnet -ErrorAction Stop).Source
    $DotNetThirdPartyNoticesPath = Join-Path $dotnetRoot "ThirdPartyNotices.txt"
}
if (-not (Test-Path -LiteralPath $DotNetThirdPartyNoticesPath -PathType Leaf)) {
    throw ".NET ThirdPartyNotices.txt not found: $DotNetThirdPartyNoticesPath"
}
Copy-Item -LiteralPath $DotNetThirdPartyNoticesPath -Destination (Join-Path $package "DOTNET-THIRD-PARTY-NOTICES.txt") -Force

function Get-PnpmLicense([string]$Name) {
    switch -Wildcard ($Name) {
        "@typescript/typescript-*" { "Apache-2.0"; break }
        "typescript" { "Apache-2.0"; break }
        "detect-libc" { "Apache-2.0"; break }
        "expect-type" { "Apache-2.0"; break }
        "lightningcss" { "MPL-2.0"; break }
        "lightningcss-*" { "MPL-2.0"; break }
        "picocolors" { "ISC"; break }
        "siginfo" { "ISC"; break }
        "source-map-js" { "BSD-3-Clause"; break }
        "@jridgewell/*" { "MIT"; break }
        "@oxc-project/*" { "MIT"; break }
        "@rolldown/*" { "MIT"; break }
        "@types/*" { "MIT"; break }
        "@vitest/*" { "MIT"; break }
        { $_ -in @("assertion-error", "chai", "csstype", "es-module-lexer", "estree-walker", "fdir", "fsevents", "magic-string", "nanoid", "obug", "picomatch", "postcss", "react", "react-dom", "rolldown", "scheduler", "stackback", "std-env", "tinybench", "tinyexec", "tinyglobby", "vite", "vitest", "why-is-node-running") } { "MIT"; break }
        default { throw "No reviewed license mapping for pnpm package: $Name" }
    }
}

function Get-NuGetLicense([string]$Name) {
    if ($Name.StartsWith("DocumentFormat.OpenXml", [StringComparison]::OrdinalIgnoreCase)) { return "MIT" }
    if ($Name.StartsWith("SQLitePCLRaw.", [StringComparison]::OrdinalIgnoreCase)) { return "Apache-2.0" }
    if ($Name.StartsWith("xunit.", [StringComparison]::OrdinalIgnoreCase)) { return "Apache-2.0" }
    if ($Name.StartsWith("Microsoft.", [StringComparison]::OrdinalIgnoreCase) -or $Name.StartsWith("System.", [StringComparison]::OrdinalIgnoreCase)) { return "MIT" }
    throw "No reviewed license mapping for NuGet package: $Name"
}

function New-SpdxId([string]$Kind, [string]$Name, [string]$Version) {
    "SPDXRef-$("$Kind-$Name-$Version" -replace '[^A-Za-z0-9.-]', '-')"
}

function New-SpdxPackage([string]$Kind, [string]$Name, [string]$Version, [string]$License, [string]$Scope, [string]$Purl, [string]$Purpose = "LIBRARY") {
    [ordered]@{
        SPDXID = New-SpdxId $Kind $Name $Version
        name = $Name
        versionInfo = $Version
        downloadLocation = "NOASSERTION"
        filesAnalyzed = $false
        licenseConcluded = "NOASSERTION"
        licenseDeclared = $License
        copyrightText = "NOASSERTION"
        primaryPackagePurpose = $Purpose
        comment = "TECHMAP dependency scope: $Scope. Version source: committed lock or runtime manifest."
        externalRefs = @([ordered]@{ referenceCategory = "PACKAGE-MANAGER"; referenceType = "purl"; referenceLocator = $Purl })
    }
}

$pnpmPackages = @()
$inPackages = $false
foreach ($line in Get-Content -LiteralPath $pnpmLock) {
    if ($line -eq "packages:") { $inPackages = $true; continue }
    if ($line -eq "snapshots:") { break }
    if (-not $inPackages -or $line -notmatch "^  ([^ ].+):$") { continue }
    $key = $Matches[1].Trim("'")
    $separator = $key.LastIndexOf("@", [StringComparison]::Ordinal)
    if ($separator -le 0) { throw "Malformed pnpm package key: $key" }
    $name = $key.Substring(0, $separator)
    $version = $key.Substring($separator + 1)
    $scope = if ($name -in @("react", "react-dom", "scheduler")) { "distributed" } else { "build/test" }
    $pnpmPackages += New-SpdxPackage "npm" $name $version (Get-PnpmLicense $name) $scope "pkg:npm/$([uri]::EscapeDataString($name))@$version"
}

$nugetByKey = @{}
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $repo "src")).TrimEnd('\') + '\'
$locks = Get-ChildItem -LiteralPath (Join-Path $repo "src"), (Join-Path $repo "tests") -Filter "packages.lock.json" -Recurse -File
foreach ($path in $locks) {
    $scope = if ($path.FullName.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) { "distributed" } else { "test" }
    $lock = Get-Content -LiteralPath $path.FullName -Raw | ConvertFrom-Json
    foreach ($framework in $lock.dependencies.PSObject.Properties) {
        foreach ($dependency in $framework.Value.PSObject.Properties) {
            if ($dependency.Value.type -eq "Project") { continue }
            $name = $dependency.Name
            $version = [string]$dependency.Value.resolved
            if ([string]::IsNullOrWhiteSpace($version)) { throw "Unresolved NuGet dependency $name" }
            $key = "$name@$version"
            if (-not $nugetByKey.ContainsKey($key) -or $scope -eq "distributed") {
                $nugetByKey[$key] = New-SpdxPackage "nuget" $name $version (Get-NuGetLicense $name) $scope "pkg:nuget/$([uri]::EscapeDataString($name))@$version"
            }
        }
    }
}
$nugetPackages = @($nugetByKey.Values)
$runtimePackages = @(
    (New-SpdxPackage "runtime" "Microsoft.NETCore.App.Runtime.win-x64" "10.0.12" "MIT" "distributed" "pkg:nuget/Microsoft.NETCore.App.Runtime.win-x64@10.0.12" "FRAMEWORK"),
    (New-SpdxPackage "runtime" "Microsoft.AspNetCore.App.Runtime.win-x64" "10.0.12" "MIT" "distributed" "pkg:nuget/Microsoft.AspNetCore.App.Runtime.win-x64@10.0.12" "FRAMEWORK")
)

$version = [string](Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).appVersion
if ([string]::IsNullOrWhiteSpace($version)) { throw "VERSION.json has no appVersion" }
if ($SourceDateEpoch -lt 0) {
    if (-not [string]::IsNullOrWhiteSpace($env:SOURCE_DATE_EPOCH)) { $SourceDateEpoch = [long]$env:SOURCE_DATE_EPOCH }
    else {
        Push-Location $repo
        try { $SourceDateEpoch = [long](git log -1 --format=%ct) }
        finally { Pop-Location }
    }
}
$created = [DateTimeOffset]::FromUnixTimeSeconds($SourceDateEpoch).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", [Globalization.CultureInfo]::InvariantCulture)

$commit = "unknown"
Push-Location $repo
try { $candidate = git rev-parse HEAD; if ($LASTEXITCODE -eq 0) { $commit = $candidate.Trim() } }
finally { Pop-Location }

$productId = "SPDXRef-TECHMAP-GRAPHER"
$product = [ordered]@{ SPDXID = $productId; name = "TECHMAP-GRAPHER"; versionInfo = $version; downloadLocation = "NOASSERTION"; filesAnalyzed = $false; licenseConcluded = "NOASSERTION"; licenseDeclared = "NOASSERTION"; copyrightText = "NOASSERTION"; primaryPackagePurpose = "APPLICATION" }
$dependencies = @($runtimePackages + $pnpmPackages + $nugetPackages) | Sort-Object { $_.SPDXID }
$relationships = foreach ($item in $dependencies) {
    if ($item.comment -match "scope: distributed") { [ordered]@{ spdxElementId = $productId; relationshipType = "CONTAINS"; relatedSpdxElement = $item.SPDXID } }
    elseif ($item.comment -match "scope: test") { [ordered]@{ spdxElementId = $item.SPDXID; relationshipType = "TEST_DEPENDENCY_OF"; relatedSpdxElement = $productId } }
    else { [ordered]@{ spdxElementId = $item.SPDXID; relationshipType = "BUILD_DEPENDENCY_OF"; relatedSpdxElement = $productId } }
}

$document = [ordered]@{
    spdxVersion = "SPDX-2.3"
    dataLicense = "CC0-1.0"
    SPDXID = "SPDXRef-DOCUMENT"
    name = "TECHMAP-GRAPHER-$version-win-x64"
    documentNamespace = "https://techmap-grapher.invalid/spdx/$version/win-x64/$commit"
    creationInfo = [ordered]@{ created = $created; creators = @("Organization: TECHMAP-GRAPHER", "Tool: scripts/generate-sbom.ps1"); comment = "Generated offline. SOURCE_DATE_EPOCH or Git commit time makes the result reproducible." }
    documentDescribes = @($productId)
    packages = @($product) + $dependencies
    relationships = @($relationships | Sort-Object spdxElementId, relationshipType)
}

$json = $document | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", (New-Object Text.UTF8Encoding($false)))

[pscustomobject]@{
    Output = [IO.Path]::GetFullPath($OutputPath)
    Packages = 1 + $dependencies.Count
    DistributedDependencies = @($dependencies | Where-Object { $_.comment -match "scope: distributed" }).Count
    BuildDependencies = @($dependencies | Where-Object { $_.comment -match "scope: build/test" }).Count
    TestDependencies = @($dependencies | Where-Object { $_.comment -match "scope: test" }).Count
    SourceDateEpoch = $SourceDateEpoch
}
