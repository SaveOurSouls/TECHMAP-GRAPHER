param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$experimentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = Resolve-Path (Join-Path $experimentRoot "..\\..")
$hostRoot = Join-Path $experimentRoot "host"
$buildRoot = Join-Path $repositoryRoot "build\\m0-04"
$packageRoot = Join-Path $buildRoot "TECHMAP-M0-04"
$dotnetHome = Join-Path $buildRoot ".dotnet-cli-home"
$appData = Join-Path $buildRoot ".appdata"
$archive = Join-Path $buildRoot "TECHMAP-M0-04-win-x64.zip"

New-Item -ItemType Directory -Force -Path $buildRoot, $dotnetHome, $appData | Out-Null
$env:DOTNET_CLI_HOME = $dotnetHome
$env:APPDATA = $appData
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = "false"

if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}

dotnet restore (Join-Path $hostRoot "Techmap.Host.csproj") `
    --configfile (Join-Path $hostRoot "NuGet.Config") `
    --runtime win-x64
if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with code $LASTEXITCODE" }
dotnet publish (Join-Path $hostRoot "Techmap.Host.csproj") `
    --configuration $Configuration `
    --runtime win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:DebugType=None `
    --no-restore `
    --output $packageRoot
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with code $LASTEXITCODE" }

# Standalone Kestrel does not use IIS integration artifacts.
Remove-Item -LiteralPath (Join-Path $packageRoot "web.config") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $packageRoot "aspnetcorev2_inprocess.dll") -Force -ErrorAction SilentlyContinue

Copy-Item -LiteralPath (Join-Path $experimentRoot "package\\README-START.html") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $experimentRoot "package\\VERSION.json") -Destination $packageRoot

$resolvedPackageRoot = (Resolve-Path -LiteralPath $packageRoot).Path
$checksums = Get-ChildItem -LiteralPath $resolvedPackageRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
        [pscustomobject]@{
            file = $_.FullName.Substring($resolvedPackageRoot.Length + 1).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            bytes = $_.Length
        }
    }
$checksumDocument = [pscustomobject]@{
    format = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    files = $checksums
}
$checksumDocument | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $packageRoot "SHA256SUMS.json") -Encoding utf8

Compress-Archive -LiteralPath $packageRoot -DestinationPath $archive

$files = Get-ChildItem -LiteralPath $packageRoot -Recurse -File
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
[pscustomobject]@{
    Package = $packageRoot
    Archive = $archive
    Files = $files.Count
    MiB = [math]::Round($bytes / 1MB, 2)
    Runtime = "Self-contained Windows x64"
}
