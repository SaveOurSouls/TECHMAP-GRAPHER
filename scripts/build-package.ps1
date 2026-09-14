param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [string]$ArtifactSlice = "m3-03"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ($ArtifactSlice -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') {
    throw "ArtifactSlice must contain only lowercase ASCII letters, digits, dots, underscores, and hyphens."
}
$artifactsRoot = Join-Path $repositoryRoot "artifacts\$ArtifactSlice"
$clientRoot = Join-Path $repositoryRoot "src\Techmap.Client"
$webRoot = Join-Path $repositoryRoot "src\Techmap.Web"
$staticRoot = Join-Path $webRoot "wwwroot"
$packageRoot = Join-Path $artifactsRoot "TECHMAP-GRAPHER"
$archivePath = Join-Path $artifactsRoot "TECHMAP-GRAPHER-win-x64.zip"
$dotnetHome = Join-Path $artifactsRoot ".dotnet-cli-home"
$appData = Join-Path $artifactsRoot ".appdata"

function Assert-WithinArtifacts([string]$Path) {
    $candidate = [IO.Path]::GetFullPath($Path)
    $allowed = [IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
    if (!$candidate.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the package artifacts directory: $candidate"
    }
}

Assert-WithinArtifacts $packageRoot
Assert-WithinArtifacts $archivePath

New-Item -ItemType Directory -Force -Path $artifactsRoot, $dotnetHome, $appData | Out-Null
$env:DOTNET_CLI_HOME = $dotnetHome
$env:APPDATA = $appData
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = "false"

if (Test-Path -LiteralPath $staticRoot) {
    $resolvedStaticRoot = [IO.Path]::GetFullPath($staticRoot)
    $expectedStaticRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "src\Techmap.Web\wwwroot"))
    if ($resolvedStaticRoot -ne $expectedStaticRoot) { throw "Unexpected generated web root: $resolvedStaticRoot" }
    Remove-Item -LiteralPath $staticRoot -Recurse -Force
}
if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

Push-Location $repositoryRoot
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with code $LASTEXITCODE" }
    pnpm --filter @techmap/client test
    if ($LASTEXITCODE -ne 0) { throw "client tests failed with code $LASTEXITCODE" }
    pnpm --filter @techmap/client build
    if ($LASTEXITCODE -ne 0) { throw "client build failed with code $LASTEXITCODE" }

    New-Item -ItemType Directory -Force -Path $staticRoot | Out-Null
    Copy-Item -Path (Join-Path $clientRoot "dist\*") -Destination $staticRoot -Recurse

    dotnet restore "Techmap-Grapher.slnx" --locked-mode --runtime win-x64 -p:NuGetAudit=false
    if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with code $LASTEXITCODE" }
    dotnet test "Techmap-Grapher.slnx" --configuration $Configuration --no-restore -- `
        --minimum-expected-tests 1
    if ($LASTEXITCODE -ne 0) { throw "dotnet test failed with code $LASTEXITCODE" }
    dotnet publish (Join-Path $webRoot "Techmap.Web.csproj") `
        --configuration $Configuration `
        --runtime win-x64 `
        --self-contained true `
        --no-restore `
        -p:PublishSingleFile=true `
        -p:DebugType=None `
        --output $packageRoot
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Remove-Item -LiteralPath (Join-Path $packageRoot "web.config") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $packageRoot "aspnetcorev2_inprocess.dll") -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $repositoryRoot "package\README-START.html") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $repositoryRoot "package\VERSION.json") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $repositoryRoot "THIRD-PARTY-NOTICES.md") -Destination $packageRoot
$examplesRoot = Join-Path $packageRoot "Examples"
New-Item -ItemType Directory -Force -Path $examplesRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot "package\Examples\README.txt") -Destination $examplesRoot
& (Join-Path $repositoryRoot "scripts\generate-reference-example.ps1") `
    -OutputPath (Join-Path $examplesRoot "reference-catalog.xlsx") | Out-Host

& (Join-Path $repositoryRoot "scripts\generate-sbom.ps1") `
    -RepositoryRoot $repositoryRoot `
    -PackageRoot $packageRoot `
    -OutputPath (Join-Path $packageRoot "SBOM.spdx.json") | Out-Host

$resolvedPackageRoot = (Resolve-Path -LiteralPath $packageRoot).Path
$files = Get-ChildItem -LiteralPath $resolvedPackageRoot -Recurse -File |
    Where-Object Name -ne "PACKAGE-MANIFEST.json" |
    Sort-Object FullName |
    ForEach-Object {
        [pscustomobject]@{
            path = $_.FullName.Substring($resolvedPackageRoot.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

$manifest = [pscustomobject]@{
    format = 1
    algorithm = "SHA-256"
    productManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $packageRoot "VERSION.json") -Algorithm SHA256).Hash.ToLowerInvariant()
    files = $files
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $packageRoot "PACKAGE-MANIFEST.json") -Encoding utf8

& (Join-Path $repositoryRoot "scripts\verify-package.ps1") -PackageRoot $packageRoot | Out-Null

Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath
$packagedFiles = Get-ChildItem -LiteralPath $packageRoot -Recurse -File
$packageBytes = ($packagedFiles | Measure-Object -Property Length -Sum).Sum
$archiveBytes = (Get-Item -LiteralPath $archivePath).Length

if ($archiveBytes -gt 75MB) { throw "Portable ZIP budget exceeded: $archiveBytes bytes" }
if ($packageBytes -gt 200MB) { throw "Portable package unpacked budget exceeded: $packageBytes bytes" }

[pscustomobject]@{
    Package = $packageRoot
    Archive = $archivePath
    Files = $packagedFiles.Count
    PackageMiB = [math]::Round($packageBytes / 1MB, 2)
    ArchiveMiB = [math]::Round($archiveBytes / 1MB, 2)
}
