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
    --configfile (Join-Path $hostRoot "NuGet.Config")
dotnet publish (Join-Path $hostRoot "Techmap.Host.csproj") `
    --configuration $Configuration `
    --self-contained false `
    --no-restore `
    --output $packageRoot

Compress-Archive -LiteralPath $packageRoot -DestinationPath $archive

$files = Get-ChildItem -LiteralPath $packageRoot -Recurse -File
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
[pscustomobject]@{
    Package = $packageRoot
    Archive = $archive
    Files = $files.Count
    MiB = [math]::Round($bytes / 1MB, 2)
    Runtime = "Requires installed .NET 8 ASP.NET Core runtime"
}
