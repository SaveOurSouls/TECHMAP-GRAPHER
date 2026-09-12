param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$solutionPath = Join-Path $repositoryRoot "Techmap-Grapher.slnx"
$artifactsRoot = Join-Path $repositoryRoot "artifacts\m1-01"
$dotnetHome = Join-Path $artifactsRoot ".test-dotnet-cli-home"
$appData = Join-Path $artifactsRoot ".test-appdata"
$clientDist = Join-Path $repositoryRoot "src\Techmap.Client\dist"
$webStaticRoot = Join-Path $repositoryRoot "src\Techmap.Web\wwwroot"
$buildPackageScript = Join-Path $PSScriptRoot "build-package.ps1"
$testPortablePackageScript = Join-Path $PSScriptRoot "test-portable-package.ps1"

New-Item -ItemType Directory -Force -Path $artifactsRoot, $dotnetHome, $appData | Out-Null
$env:DOTNET_CLI_HOME = $dotnetHome
$env:APPDATA = $appData
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = "false"

function Write-Stage([int]$Number, [string]$Name) {
    Write-Host "[M1-01 $Number/7] $Name"
}

function Invoke-Native([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

Push-Location $repositoryRoot
try {
    Write-Stage 1 "Locked offline frontend install"
    Invoke-Native -Command "pnpm" -Arguments @("install", "--frozen-lockfile", "--offline")

    Write-Stage 2 "Frontend typecheck, tests and production build"
    Invoke-Native -Command "pnpm" -Arguments @("--filter", "@techmap/client", "typecheck")
    Invoke-Native -Command "pnpm" -Arguments @("--filter", "@techmap/client", "test")
    Invoke-Native -Command "pnpm" -Arguments @("--filter", "@techmap/client", "build")
    New-Item -ItemType Directory -Force -Path $webStaticRoot | Out-Null
    Copy-Item -Path (Join-Path $clientDist "*") -Destination $webStaticRoot -Recurse -Force

    Write-Stage 3 "Locked .NET restore, build and tests"
    Invoke-Native -Command "dotnet" -Arguments @(
        "restore", $solutionPath,
        "--locked-mode",
        "--runtime", "win-x64",
        "-p:NuGetAudit=false"
    )
    Invoke-Native -Command "dotnet" -Arguments @(
        "build", $solutionPath,
        "--configuration", $Configuration,
        "--no-restore"
    )
    Invoke-Native -Command "dotnet" -Arguments @(
        "test", "--solution", $solutionPath,
        "--configuration", $Configuration,
        "--no-restore",
        "--no-build",
        "--minimum-expected-tests", "1"
    )

    Write-Stage 4 "M0 regression suite (20 tests)"
    Invoke-Native -Command "node" -Arguments @("--test", "experiments/m0-02/geometry.test.cjs")
    Invoke-Native -Command "node" -Arguments @("--test", "experiments/m0-03/catalog.test.cjs")
    Invoke-Native -Command "node" -Arguments @("--test", "experiments/m0-04/storage/storage.test.cjs")

    Write-Stage 5 "M0 browser script syntax"
    Invoke-Native -Command "node" -Arguments @("--check", "experiments/m0-02/app.js")
    Invoke-Native -Command "node" -Arguments @("--check", "experiments/m0-03/catalog.js")
    Invoke-Native -Command "node" -Arguments @("--check", "experiments/m0-03/app.js")

    Write-Stage 6 "Self-contained package build"
    if (-not (Test-Path -LiteralPath $buildPackageScript -PathType Leaf)) {
        throw "Package build script is missing: $buildPackageScript"
    }
    & $buildPackageScript -Configuration $Configuration

    Write-Stage 7 "Portable ZIP verification"
    if (-not (Test-Path -LiteralPath $testPortablePackageScript -PathType Leaf)) {
        throw "Portable package test script is missing: $testPortablePackageScript"
    }
    & $testPortablePackageScript

    Write-Host "[M1-01] All stages passed."
}
finally {
    Pop-Location
}
