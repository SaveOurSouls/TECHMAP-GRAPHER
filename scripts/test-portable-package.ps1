param(
    [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$ArchivePath = if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    Join-Path $repositoryRoot "artifacts\m1-01\TECHMAP-GRAPHER-win-x64.zip"
} else {
    $ArchivePath
}
$resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
$artifactsRoot = Join-Path $repositoryRoot "artifacts\portable-package-test"
$extractionParent = Join-Path $artifactsRoot "Проверка пакета с пробелом"
$dataRootsParent = Join-Path $artifactsRoot "Данные проверки"
$verifyScript = Join-Path $PSScriptRoot "verify-package.ps1"
$forbiddenDirectoryNames = @("node_modules", "bin", "obj")

function Assert-WithinTestArtifacts {
    param([Parameter(Mandatory = $true)][string]$Path)
    $candidate = [IO.Path]::GetFullPath($Path)
    $allowed = [IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
    if (!$candidate.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the portable-package test directory: $candidate"
    }
}

Assert-WithinTestArtifacts $extractionParent
Assert-WithinTestArtifacts $dataRootsParent

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function Assert-JsonContentType {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Message
    )
    $contentType = [string]$Response.Headers["Content-Type"]
    if (!$contentType.StartsWith("application/json", [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Message Expected JSON, got '$contentType'."
    }
}

function Get-HttpFailure {
    param([Parameter(Mandatory = $true)][string]$Uri)

    $client = New-Object System.Net.Http.HttpClient
    try {
        $response = $client.GetAsync($Uri).GetAwaiter().GetResult()
        $headers = @{}
        foreach ($header in $response.Headers) {
            $headers[$header.Key] = $header.Value -join ", "
        }
        foreach ($header in $response.Content.Headers) {
            $headers[$header.Key] = $header.Value -join ", "
        }
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            Headers = $headers
        }
    } finally {
        $client.Dispose()
    }
}

function Wait-ForHostUrl {
    param(
        [Parameter(Mandatory = $true)][string]$StandardOutputPath,
        [Parameter(Mandatory = $true)]$Process,
        [int]$TimeoutSeconds = 15
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "Techmap.Server.exe exited before publishing TECHMAP_HOST_URL (exit $($Process.ExitCode))."
        }
        if (Test-Path -LiteralPath $StandardOutputPath) {
            $match = Select-String -LiteralPath $StandardOutputPath `
                -Pattern '^TECHMAP_HOST_URL=(http://[^\s]+)$' |
                Select-Object -Last 1
            if ($null -ne $match) {
                return $match.Matches[0].Groups[1].Value
            }
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Timed out waiting for TECHMAP_HOST_URL."
}

function Test-HostMode {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$PathBase,
        [Parameter(Mandatory = $true)][string]$RunName
    )

    $stdout = Join-Path $artifactsRoot "$RunName.stdout.log"
    $stderr = Join-Path $artifactsRoot "$RunName.stderr.log"
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    $oldDotnetRoot = $env:DOTNET_ROOT
    $oldMultilevelLookup = $env:DOTNET_MULTILEVEL_LOOKUP
    $process = $null
    try {
        $env:DOTNET_MULTILEVEL_LOOKUP = "0"
        $env:DOTNET_ROOT = Join-Path $artifactsRoot "несуществующий runtime"
        $arguments = @(
            "--no-browser",
            "--data-root=`"$DataRoot`"",
            "--path-base=$PathBase"
        )
        $process = Start-Process `
            -FilePath $ExecutablePath `
            -ArgumentList $arguments `
            -WorkingDirectory $artifactsRoot `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr `
            -WindowStyle Hidden `
            -PassThru

        $pageUrl = Wait-ForHostUrl -StandardOutputPath $stdout -Process $process
        $pageUri = [Uri]$pageUrl
        Assert-Equal $pageUri.Host "127.0.0.1" "The host must listen on IPv4 loopback."
        if ($pageUri.Port -le 0) {
            throw "The host did not publish a valid random port."
        }

        $expectedPagePath = if ($PathBase -eq "/") { "/" } else { "$PathBase/" }
        Assert-Equal $pageUri.AbsolutePath $expectedPagePath "Published page path is incorrect."

        $origin = $pageUri.GetLeftPart([UriPartial]::Authority)
        $routePrefix = if ($PathBase -eq "/") { "" } else { $PathBase }
        $ui = Invoke-WebRequest -UseBasicParsing -Uri "$origin$routePrefix/"
        Assert-Equal ([int]$ui.StatusCode) 200 "UI request failed."
        if ($ui.Content.IndexOf("TECHMAP-GRAPHER", [StringComparison]::Ordinal) -lt 0) {
            throw "UI response does not identify TECHMAP-GRAPHER."
        }

        $runtimeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$origin$routePrefix/runtime-config.json"
        Assert-JsonContentType $runtimeResponse "Runtime config content type is incorrect."
        $runtime = $runtimeResponse.Content | ConvertFrom-Json
        $expectedBasePath = if ($PathBase -eq "/") { "/" } else { "$PathBase/" }
        $expectedApiBase = if ($PathBase -eq "/") { "/api/v1/" } else { "$PathBase/api/v1/" }
        Assert-Equal $runtime.basePath $expectedBasePath "Runtime basePath is incorrect."
        Assert-Equal $runtime.apiBasePath $expectedApiBase "Runtime apiBasePath is incorrect."

        $health = Invoke-WebRequest -UseBasicParsing -Uri "$origin$routePrefix/api/v1/health"
        Assert-Equal ([int]$health.StatusCode) 200 "Health request failed."
        Assert-JsonContentType $health "Health content type is incorrect."
        $healthJson = $health.Content | ConvertFrom-Json
        Assert-Equal $healthJson.status "ok" "Health status is incorrect."

        $deepLink = Invoke-WebRequest -UseBasicParsing -Uri "$origin$routePrefix/projects/demo/harnesses/one"
        Assert-Equal ([int]$deepLink.StatusCode) 200 "SPA deep-link failed."
        if ($deepLink.Content.IndexOf("TECHMAP-GRAPHER", [StringComparison]::Ordinal) -lt 0) {
            throw "SPA deep-link did not return the web client."
        }

        $missingApi = Get-HttpFailure "$origin$routePrefix/api/v1/not-present"
        Assert-Equal $missingApi.StatusCode 404 "Unknown API route status is incorrect."
        Assert-JsonContentType $missingApi "Unknown API route content type is incorrect."
        $apiError = $missingApi.Content | ConvertFrom-Json
        Assert-Equal $apiError.error "api_route_not_found" "Unknown API error is incorrect."

        if ($PathBase -ne "/") {
            $outside = Get-HttpFailure "$origin/api/v1/health"
            Assert-Equal $outside.StatusCode 404 "A prefixed host served content outside path base."
        }
    } finally {
        if ($null -ne $process -and !$process.HasExited) {
            Stop-Process -Id $process.Id -Force
            $process.WaitForExit()
        }
        $env:DOTNET_ROOT = $oldDotnetRoot
        $env:DOTNET_MULTILEVEL_LOOKUP = $oldMultilevelLookup
    }

    $markerPath = Join-Path $DataRoot ".techmap-data-root.json"
    if (!(Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "The data-root marker was not created: $markerPath"
    }
    $marker = Get-Content -Raw -LiteralPath $markerPath | ConvertFrom-Json
    Assert-Equal $marker.ProductId "TECHMAP-GRAPHER" "The data-root marker product is incorrect."
    Assert-Equal ([int]$marker.FormatVersion) 1 "The data-root marker format is incorrect."
}

if (!(Test-Path -LiteralPath $verifyScript -PathType Leaf)) {
    throw "verify-package.ps1 is missing: $verifyScript"
}
if ([IO.Path]::GetExtension($resolvedArchive) -ne ".zip") {
    throw "ArchivePath must point to a ZIP file."
}

if (Test-Path -LiteralPath $extractionParent) {
    Remove-Item -LiteralPath $extractionParent -Recurse -Force
}
if (Test-Path -LiteralPath $dataRootsParent) {
    Remove-Item -LiteralPath $dataRootsParent -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $extractionParent, $dataRootsParent | Out-Null
Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $extractionParent

$topLevel = @(Get-ChildItem -LiteralPath $extractionParent -Force)
if ($topLevel.Count -ne 1 -or
    !$topLevel[0].PSIsContainer -or
    $topLevel[0].Name -ne "TECHMAP-GRAPHER") {
    throw "Archive must contain exactly one top-level TECHMAP-GRAPHER directory."
}
$packageRoot = $topLevel[0].FullName

& $verifyScript -PackageRoot $packageRoot | Out-Null

$verifyProcess = Start-Process `
    -FilePath (Join-Path $packageRoot "Techmap.Server.exe") `
    -ArgumentList "--verify-package" `
    -WorkingDirectory $packageRoot `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
Assert-Equal $verifyProcess.ExitCode 0 "Packaged --verify-package failed."

$tamperTarget = Join-Path $packageRoot "README-START.html"
$tamperOriginal = [IO.File]::ReadAllBytes($tamperTarget)
$tamperDataRoot = Join-Path $dataRootsParent "Поврежденный пакет"
try {
    [IO.File]::AppendAllText($tamperTarget, "tampered")
    $tamperedProcess = Start-Process `
        -FilePath (Join-Path $packageRoot "Techmap.Server.exe") `
        -ArgumentList @("--no-browser", "--data-root=`"$tamperDataRoot`"") `
        -WorkingDirectory $packageRoot `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($tamperedProcess.ExitCode -eq 0) {
        throw "A package with a modified file was accepted."
    }
    if (Test-Path -LiteralPath $tamperDataRoot) {
        throw "A damaged package wrote to dataRoot before failing verification."
    }
} finally {
    [IO.File]::WriteAllBytes($tamperTarget, $tamperOriginal)
}

& $verifyScript -PackageRoot $packageRoot | Out-Null

$sourceMapOrSymbols = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
    Where-Object Extension -in @(".map", ".pdb"))
if ($sourceMapOrSymbols.Count -gt 0) {
    throw "Package contains source maps or symbols: $($sourceMapOrSymbols.FullName -join ', ')"
}
$forbiddenDirectories = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -Directory |
    Where-Object Name -in $forbiddenDirectoryNames)
if ($forbiddenDirectories.Count -gt 0) {
    throw "Package contains development directories: $($forbiddenDirectories.FullName -join ', ')"
}

$webAssets = @(Get-ChildItem -LiteralPath (Join-Path $packageRoot "wwwroot") -Recurse -File |
    Where-Object Extension -in @(".html", ".js", ".css", ".json", ".svg"))
$inertEmbeddedUrls = @(
    "http://www.w3.org/1998/Math/MathML",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/XML/1998/namespace",
    "https://react.dev/errors/"
)
foreach ($asset in $webAssets) {
    $content = Get-Content -Raw -LiteralPath $asset.FullName
    $externalUrls = @([regex]::Matches($content, '(?i)https?://[^\s"''`<>]+') |
        ForEach-Object Value |
        Where-Object {
            $url = $_
            -not ($inertEmbeddedUrls | Where-Object { $url.StartsWith($_, [StringComparison]::Ordinal) })
        })
    if ($externalUrls.Count -gt 0) {
        throw "Web asset contains an unexpected external HTTP(S) URL: $($asset.FullName): $($externalUrls[0])"
    }
}

$executables = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Filter "Techmap.Server.exe")
if ($executables.Count -ne 1) {
    throw "Package must contain exactly one Techmap.Server.exe; found $($executables.Count)."
}

Test-HostMode `
    -ExecutablePath $executables[0].FullName `
    -DataRoot (Join-Path $dataRootsParent "Корневой режим") `
    -PathBase "/" `
    -RunName "root"
Test-HostMode `
    -ExecutablePath $executables[0].FullName `
    -DataRoot (Join-Path $dataRootsParent "Режим с префиксом") `
    -PathBase "/techmap" `
    -RunName "prefix"

[pscustomobject]@{
    Status = "ok"
    Archive = $resolvedArchive
    Package = $packageRoot
    Executable = $executables[0].FullName
    Modes = 2
}
