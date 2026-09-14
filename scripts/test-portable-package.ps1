param(
    [string]$ArchivePath,
    [string]$ArtifactsRoot
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
if (-not ("TechmapPortableNativeMethods" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class TechmapPortableNativeMethods
{
    private const uint SuppressedDialogMode = 0x0001 | 0x0002 | 0x8000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathName(
        string longPath,
        StringBuilder shortPath,
        uint bufferLength);

    [DllImport("kernel32.dll")]
    private static extern uint GetErrorMode();

    [DllImport("kernel32.dll")]
    private static extern uint SetErrorMode(uint errorMode);

    public static void SuppressCrashDialogs()
    {
        SetErrorMode(GetErrorMode() | SuppressedDialogMode);
    }

    public static string GetShortPath(string path)
    {
        var required = GetShortPathName(path, null, 0);
        if (required == 0)
        {
            return null;
        }

        var buffer = new StringBuilder((int)required);
        return GetShortPathName(path, buffer, required) == 0 ? null : buffer.ToString();
    }
}
"@
}
[TechmapPortableNativeMethods]::SuppressCrashDialogs()
$env:DOTNET_DISABLE_GUI_ERRORS = "1"
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$ArchivePath = if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    Join-Path $repositoryRoot "artifacts\m2-08\TECHMAP-GRAPHER-win-x64.zip"
} else {
    $ArchivePath
}
$resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
$artifactsRoot = if ([string]::IsNullOrWhiteSpace($ArtifactsRoot)) {
    Join-Path $repositoryRoot "artifacts\portable-package-test"
} else {
    [IO.Path]::GetFullPath($ArtifactsRoot)
}
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
        [Parameter(Mandatory = $true)][string]$RunName,
        $ExpectedProject,
        [string]$ExampleXlsxPath
    )

    $stdout = Join-Path $artifactsRoot "$RunName.stdout.log"
    $stderr = Join-Path $artifactsRoot "$RunName.stderr.log"
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    $oldDotnetRoot = $env:DOTNET_ROOT
    $oldMultilevelLookup = $env:DOTNET_MULTILEVEL_LOOKUP
    $process = $null
    $projectSnapshot = $null
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
        $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $ui = Invoke-WebRequest -UseBasicParsing -WebSession $webSession -Uri "$origin$routePrefix/"
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
        Assert-Equal ([int]$runtime.schemaVersion) $expectedSchemaVersion "Runtime schema version is incorrect."

        $diagnosticsResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -WebSession $webSession `
            -Uri "$origin$routePrefix/api/v1/diagnostics"
        Assert-JsonContentType $diagnosticsResponse "Diagnostics content type is incorrect."
        $diagnostics = $diagnosticsResponse.Content | ConvertFrom-Json
        Assert-Equal $diagnostics.status "ready" "Storage diagnostics status is incorrect."
        Assert-Equal ([int]$diagnostics.schemaVersion) $expectedSchemaVersion "Live SQLite schema version is incorrect."
        Assert-Equal $diagnostics.foreignKeysEnabled $true "SQLite foreign keys are not enabled."
        Assert-Equal $diagnostics.journalMode "wal" "SQLite journal mode is incorrect."
        if ([string]::IsNullOrWhiteSpace($diagnostics.sqliteVersion)) {
            throw "Diagnostics response does not contain the SQLite runtime version."
        }
        if ($diagnosticsResponse.Content.IndexOf("dataRoot", [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $diagnosticsResponse.Content.IndexOf("databasePath", [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "Diagnostics response exposes a storage path."
        }

        $health = Invoke-WebRequest -UseBasicParsing -Uri "$origin$routePrefix/api/v1/health"
        Assert-Equal ([int]$health.StatusCode) 200 "Health request failed."
        Assert-JsonContentType $health "Health content type is incorrect."
        $healthJson = $health.Content | ConvertFrom-Json
        Assert-Equal $healthJson.status "ok" "Health status is incorrect."
        if ([string]::IsNullOrWhiteSpace($healthJson.instanceId)) {
            throw "Health response does not contain an instance ID."
        }

        $sessionResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -WebSession $webSession `
            -Uri "$origin$routePrefix/api/v1/session"
        Assert-JsonContentType $sessionResponse "Session content type is incorrect."
        $sessionJson = $sessionResponse.Content | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($sessionJson.csrfNonce)) {
            throw "Session response does not contain a CSRF nonce."
        }
        $mutationHeaders = @{
            Origin = $origin
            "X-Techmap-CSRF" = $sessionJson.csrfNonce
        }
        if (![string]::IsNullOrWhiteSpace($ExampleXlsxPath)) {
            if (!(Test-Path -LiteralPath $ExampleXlsxPath -PathType Leaf)) {
                throw "The packaged example XLSX is missing: $ExampleXlsxPath"
            }
            $xlsxPreviewBody = @{
                fileName = [IO.Path]::GetFileName($ExampleXlsxPath)
                contentBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ExampleXlsxPath))
                sheetName = "Catalog"
                headerRow = 1
                firstDataRow = 2
                entityType = "wire"
                keyColumn = "RecordKey"
                fields = $null
            } | ConvertTo-Json -Compress
            $xlsxPreviewResponse = Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -Method Post `
                -Headers $mutationHeaders `
                -ContentType "application/json" `
                -Body $xlsxPreviewBody `
                -Uri "$origin$routePrefix/api/v1/reference-sources/portable-example/xlsx-previews"
            Assert-Equal ([int]$xlsxPreviewResponse.StatusCode) 200 `
                "Packaged example XLSX preview request failed."
            Assert-JsonContentType $xlsxPreviewResponse `
                "Packaged example XLSX preview content type is incorrect."
            $xlsxPreview = $xlsxPreviewResponse.Content | ConvertFrom-Json
            Assert-Equal $xlsxPreview.canPublish $true `
                "Packaged example XLSX preview is not publishable."
            Assert-Equal ([int]$xlsxPreview.recordCount) 7 `
                "Packaged example XLSX preview record count is incorrect."
            Assert-Equal @($xlsxPreview.records).Count 7 `
                "Packaged example XLSX preview did not return all records."
            if (@($xlsxPreview.records.sourceKey) -notcontains "0007") {
                throw "Packaged example XLSX preview did not preserve the text key '0007'."
            }
        }
        $projectListResponse = Invoke-WebRequest `
            -UseBasicParsing `
            -WebSession $webSession `
            -Uri "$origin$routePrefix/api/v1/projects"
        Assert-JsonContentType $projectListResponse "Project list content type is incorrect."
        $projectList = $projectListResponse.Content | ConvertFrom-Json
        if ($null -eq $ExpectedProject) {
            Assert-Equal @($projectList.projects).Count 0 "A fresh portable data root contains projects."
            $createBody = @{
                designation = "ПР-ПЕРЕНОС"
                name = "Проверка переносимого проекта"
                status = "draft"
            } | ConvertTo-Json -Compress
            $createdResponse = Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -Method Post `
                -Headers $mutationHeaders `
                -ContentType "application/json" `
                -Body $createBody `
                -Uri "$origin$routePrefix/api/v1/projects"
            $projectSnapshot = $createdResponse.Content | ConvertFrom-Json
            foreach ($harnessInput in @(
                [pscustomobject]@{ Designation = "ЖГУТ-А"; Quantity = 5 },
                [pscustomobject]@{ Designation = "ЖГУТ-Б"; Quantity = 12 }
            )) {
                $harnessBody = @{
                    commandId = [Guid]::NewGuid().ToString("D")
                    expectedRevision = [long]$projectSnapshot.revision
                    designation = $harnessInput.Designation
                    quantity = $harnessInput.Quantity
                } | ConvertTo-Json -Compress
                $harnessResponse = Invoke-WebRequest `
                    -UseBasicParsing `
                    -WebSession $webSession `
                    -Method Post `
                    -Headers $mutationHeaders `
                    -ContentType "application/json" `
                    -Body $harnessBody `
                    -Uri "$origin$routePrefix/api/v1/projects/$($projectSnapshot.projectId)/harnesses"
                $projectSnapshot = ($harnessResponse.Content | ConvertFrom-Json).project
            }
            Assert-Equal @($projectSnapshot.harnesses).Count 2 "Portable project did not store two harnesses."
            Assert-Equal ([long]$projectSnapshot.harnesses[0].quantity) 5 `
                "Portable project did not store the first harness quantity."
            Assert-Equal ([long]$projectSnapshot.harnesses[1].quantity) 12 `
                "Portable project did not store the second harness quantity."
            $documentIds = @($projectSnapshot.harnesses | ForEach-Object {
                Assert-Equal @($_.documents).Count 3 `
                    "A new harness did not receive exactly three documents."
                Assert-Equal (@($_.documents.kind | Sort-Object) -join ",") "drawing,e4,route" `
                    "A new harness did not receive the required document kinds."
                Assert-Equal (@($_.documents.status | Select-Object -Unique) -join ",") "empty" `
                    "A new harness document was not empty."
                @($_.documents.documentId)
            })
            Assert-Equal @($documentIds | Select-Object -Unique).Count 6 `
                "Harness document UUIDs are not unique within the project."
            $attachmentText = "Вложение переносимого проекта"
            $attachmentBody = @{
                commandId = [Guid]::NewGuid().ToString("D")
                expectedRevision = [long]$projectSnapshot.revision
                fileName = "portable-check.txt"
                mediaType = "text/plain"
                purpose = "portable-test"
                contentBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($attachmentText))
            } | ConvertTo-Json -Compress
            $attachmentResponse = Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -Method Post `
                -Headers $mutationHeaders `
                -ContentType "application/json" `
                -Body $attachmentBody `
                -Uri "$origin$routePrefix/api/v1/projects/$($projectSnapshot.projectId)/attachments"
            $attachmentCommand = $attachmentResponse.Content | ConvertFrom-Json
            $attachmentSnapshot = $attachmentCommand.attachment
            $projectSnapshot.revision = [long]$attachmentCommand.resultingRevision
            $projectSnapshot | Add-Member `
                -NotePropertyName testAttachment `
                -NotePropertyValue $attachmentSnapshot
        } else {
            Assert-Equal @($projectList.projects).Count 1 "Restart did not list the persisted project."
            Assert-Equal $projectList.projects[0].projectId $ExpectedProject.projectId `
                "Restart changed the project UUID."
            $projectResponse = Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -Uri "$origin$routePrefix/api/v1/projects/$($ExpectedProject.projectId)"
            $projectSnapshot = $projectResponse.Content | ConvertFrom-Json
            Assert-Equal $projectSnapshot.increment $ExpectedProject.increment `
                "Restart changed the project increment."
            Assert-Equal $projectSnapshot.revision $ExpectedProject.revision `
                "Restart changed the acknowledged project revision."
            Assert-Equal @($projectSnapshot.harnesses).Count 2 `
                "Restart did not preserve both harnesses."
            Assert-Equal $projectSnapshot.harnesses[0].harnessId $ExpectedProject.harnesses[0].harnessId `
                "Restart changed the first harness UUID."
            Assert-Equal $projectSnapshot.harnesses[1].harnessId $ExpectedProject.harnesses[1].harnessId `
                "Restart changed the second harness UUID."
            Assert-Equal $projectSnapshot.harnesses[0].sortOrder 0 `
                "Restart changed the first harness order."
            Assert-Equal $projectSnapshot.harnesses[1].sortOrder 1 `
                "Restart changed the second harness order."
            Assert-Equal ([long]$projectSnapshot.harnesses[0].quantity) 5 `
                "Restart changed the first harness quantity."
            Assert-Equal ([long]$projectSnapshot.harnesses[1].quantity) 12 `
                "Restart changed the second harness quantity."
            $restartedDocumentIds = @()
            foreach ($index in 0..1) {
                $actualDocuments = @($projectSnapshot.harnesses[$index].documents)
                $expectedDocuments = @($ExpectedProject.harnesses[$index].documents)
                Assert-Equal $actualDocuments.Count 3 `
                    "Restart did not preserve all harness documents."
                Assert-Equal (@($actualDocuments.kind | Sort-Object) -join ",") "drawing,e4,route" `
                    "Restart changed the harness document kinds."
                foreach ($document in $actualDocuments) {
                    $expectedDocument = @($expectedDocuments | Where-Object kind -eq $document.kind)
                    Assert-Equal $expectedDocument.Count 1 `
                        "Restart returned a duplicate or unknown harness document kind."
                    Assert-Equal $document.documentId $expectedDocument[0].documentId `
                        "Restart changed a harness document UUID."
                    Assert-Equal $document.status "empty" `
                        "Restart changed an empty harness document status."
                    $restartedDocumentIds += $document.documentId
                }
            }
            Assert-Equal @($restartedDocumentIds | Select-Object -Unique).Count 6 `
                "Restart returned duplicate harness document UUIDs."
            $attachmentsResponse = Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -Uri "$origin$routePrefix/api/v1/projects/$($ExpectedProject.projectId)/attachments"
            $attachments = $attachmentsResponse.Content | ConvertFrom-Json
            $attachmentSnapshot = @($attachments.attachments)[0]
            Assert-Equal @($attachments.attachments).Count 1 `
                "Restart did not preserve the project attachment."
            Assert-Equal $attachmentSnapshot.attachmentId $ExpectedProject.testAttachment.attachmentId `
                "Restart changed the attachment UUID."
            Assert-Equal $attachmentSnapshot.sha256 $ExpectedProject.testAttachment.sha256 `
                "Restart changed the attachment SHA-256."
            $validation = Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -Method Post `
                -Headers $mutationHeaders `
                -ContentType "application/json" `
                -Body "{}" `
                -Uri "$origin$routePrefix/api/v1/projects/$($ExpectedProject.projectId)/attachments/$($attachmentSnapshot.attachmentId)/validations"
            Assert-Equal (($validation.Content | ConvertFrom-Json).status) "valid" `
                "Restarted package did not validate the attachment."
            $attachmentDownload = Join-Path $artifactsRoot "$RunName.attachment.bin"
            Remove-Item -LiteralPath $attachmentDownload -Force -ErrorAction SilentlyContinue
            Invoke-WebRequest `
                -UseBasicParsing `
                -WebSession $webSession `
                -OutFile $attachmentDownload `
                -Uri "$origin$routePrefix/api/v1/projects/$($ExpectedProject.projectId)/attachments/$($attachmentSnapshot.attachmentId)/content" | Out-Null
            Assert-Equal `
                (Get-FileHash -LiteralPath $attachmentDownload -Algorithm SHA256).Hash.ToLowerInvariant() `
                $ExpectedProject.testAttachment.sha256 `
                "Restarted package returned different attachment bytes."
        }

        $secondaryStdout = Join-Path $artifactsRoot "$RunName.secondary.stdout.log"
        $secondaryStderr = Join-Path $artifactsRoot "$RunName.secondary.stderr.log"
        Remove-Item -LiteralPath $secondaryStdout, $secondaryStderr -Force -ErrorAction SilentlyContinue
        $secondary = Start-Process `
            -FilePath $ExecutablePath `
            -ArgumentList @(
                "--no-browser",
                "--data-root=`"$DataRoot`"",
                "--path-base=/secondary-request-is-ignored"
            ) `
            -WorkingDirectory $artifactsRoot `
            -RedirectStandardOutput $secondaryStdout `
            -RedirectStandardError $secondaryStderr `
            -WindowStyle Hidden `
            -PassThru
        $null = $secondary.Handle
        if (!$secondary.WaitForExit(10000)) {
            Stop-Process -Id $secondary.Id -Force
            throw "The second launch did not resolve the existing instance."
        }
        $secondary.WaitForExit()
        $secondary.Refresh()
        Assert-Equal ([int]$secondary.ExitCode) 0 "The second launch failed."
        $secondaryOutput = Get-Content -Raw -LiteralPath $secondaryStdout
        if ($secondaryOutput.IndexOf("TECHMAP_INSTANCE_STATUS=existing", [StringComparison]::Ordinal) -lt 0) {
            throw "The second launch did not report the existing instance."
        }
        if ($secondaryOutput.IndexOf("TECHMAP_HOST_URL=$pageUrl", [StringComparison]::Ordinal) -lt 0) {
            throw "The second launch did not report the original owner URL."
        }

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

    $currentPath = Join-Path $DataRoot "CURRENT"
    if (!(Test-Path -LiteralPath $currentPath -PathType Leaf)) {
        throw "The active SQLite generation pointer was not created: $currentPath"
    }
    $generationName = (Get-Content -Raw -LiteralPath $currentPath).TrimEnd("`r", "`n")
    if ($generationName -notmatch '^generation-[0-9]{8}$') {
        throw "The active SQLite generation name is invalid: $generationName"
    }
    $generationPath = Join-Path (Join-Path $DataRoot "generations") $generationName
    if (!(Test-Path -LiteralPath (Join-Path $generationPath "READY") -PathType Leaf) -or
        !(Test-Path -LiteralPath (Join-Path $generationPath "app.db") -PathType Leaf)) {
        throw "The active SQLite generation is incomplete: $generationPath"
    }
    return $projectSnapshot
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
$exampleXlsxPath = Join-Path $packageRoot "Examples\reference-catalog.xlsx"
$exampleReadmePath = Join-Path $packageRoot "Examples\README.txt"
foreach ($examplePath in @($exampleXlsxPath, $exampleReadmePath)) {
    if (!(Test-Path -LiteralPath $examplePath -PathType Leaf)) {
        throw "Package does not contain the required example file: $examplePath"
    }
}
$packageVersion = Get-Content -Raw -LiteralPath (Join-Path $packageRoot "VERSION.json") |
    ConvertFrom-Json
$expectedSchemaVersion = [int]$packageVersion.storage.schema
if ($expectedSchemaVersion -le 0) {
    throw "The packaged storage schema version is invalid."
}

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
$tamperLogRoot = $tamperDataRoot
$safeTamperLogRoot = "$tamperDataRoot-startup-errors"
try {
    [IO.File]::AppendAllText($tamperTarget, "tampered")
    $tamperedProcess = Start-Process `
        -FilePath (Join-Path $packageRoot "Techmap.Server.exe") `
        -ArgumentList @(
            "--no-browser",
            "--no-error-dialog",
            "--data-root=`"$tamperDataRoot`"",
            "--error-log-root=`"$tamperLogRoot`"") `
        -WorkingDirectory $packageRoot `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    Assert-Equal $tamperedProcess.ExitCode 1 "A package with a modified file did not fail cleanly."
    if (Test-Path -LiteralPath $tamperDataRoot) {
        throw "A damaged package wrote to dataRoot before failing verification."
    }
    $startupLog = @(Get-ChildItem -LiteralPath $safeTamperLogRoot -Filter "startup-error-*.log" -File)
    Assert-Equal $startupLog.Count 1 "Damaged package did not write exactly one startup log."
    if ([IO.File]::ReadAllText($startupLog[0].FullName).IndexOf(
            "Package file size mismatch",
            [StringComparison]::Ordinal) -lt 0) {
        throw "Damaged package startup log does not explain the integrity failure."
    }
} finally {
    [IO.File]::WriteAllBytes($tamperTarget, $tamperOriginal)
}

& $verifyScript -PackageRoot $packageRoot | Out-Null

function Wait-ForFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Process,
        [int]$TimeoutSeconds = 15
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            return
        }
        if ($Process.HasExited) {
            throw "Techmap.Server.exe exited before creating the test signal '$Path' (exit $($Process.ExitCode))."
        }
        Start-Sleep -Milliseconds 50
    }
    throw "Timed out waiting for the test signal '$Path'."
}

function Start-TechmapProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$RunName,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string]$PathBase = "/"
    )

    $stdout = Join-Path $artifactsRoot "$RunName.stdout.log"
    $stderr = Join-Path $artifactsRoot "$RunName.stderr.log"
    Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    $process = Start-Process `
        -FilePath $ExecutablePath `
        -ArgumentList @(
            "--no-browser",
            "--data-root=`"$DataRoot`"",
            "--path-base=$PathBase"
        ) `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru
    $null = $process.Handle
    return [pscustomobject]@{
        Process = $process
        Stdout = $stdout
        Stderr = $stderr
        RunName = $RunName
    }
}

function Stop-TechmapProcess {
    param($Launch)

    if ($null -ne $Launch -and !$Launch.Process.HasExited) {
        Stop-Process -Id $Launch.Process.Id -Force
        $Launch.Process.WaitForExit()
    }
}

function Wait-TechmapProcessExit {
    param(
        [Parameter(Mandatory = $true)]$Launch,
        [int]$TimeoutMilliseconds = 10000
    )

    if (!$Launch.Process.WaitForExit($TimeoutMilliseconds)) {
        Stop-TechmapProcess $Launch
        throw "The process '$($Launch.RunName)' did not exit within $TimeoutMilliseconds ms."
    }
    $Launch.Process.WaitForExit()
    $Launch.Process.Refresh()
}

function Read-TechmapOutput {
    param([Parameter(Mandatory = $true)]$Launch)

    if (!(Test-Path -LiteralPath $Launch.Stdout -PathType Leaf)) {
        return " "
    }
    $content = [string](Get-Content -Raw -LiteralPath $Launch.Stdout)
    if ([string]::IsNullOrEmpty($content)) {
        return " "
    }
    return $content
}

function Get-PublishedHostUrl {
    param([Parameter(Mandatory = $true)][string]$Output)

    $match = [regex]::Match($Output, '(?m)^TECHMAP_HOST_URL=(http://[^\s]+)\r?$')
    if ($match.Success) {
        return $match.Groups[1].Value
    }
    return $null
}

function Assert-ExistingLaunch {
    param(
        [Parameter(Mandatory = $true)]$Launch,
        [Parameter(Mandatory = $true)][string]$ExpectedUrl
    )

    Wait-TechmapProcessExit $Launch
    $output = Read-TechmapOutput $Launch
    $errorOutput = if (Test-Path -LiteralPath $Launch.Stderr) {
        Get-Content -Raw -LiteralPath $Launch.Stderr
    } else {
        ""
    }
    if ([int]$Launch.Process.ExitCode -ne 0) {
        throw "Alias launch '$($Launch.RunName)' failed with exit $($Launch.Process.ExitCode): $errorOutput"
    }
    if ($output.IndexOf("TECHMAP_INSTANCE_STATUS=existing", [StringComparison]::Ordinal) -lt 0) {
        throw "Alias launch '$($Launch.RunName)' did not resolve the existing owner. Output: $output"
    }
    if ((Get-PublishedHostUrl $output) -ne $ExpectedUrl) {
        throw "Alias launch '$($Launch.RunName)' did not publish the owner's URL '$ExpectedUrl'. Output: $output"
    }
}

function Try-CreateJunction {
    param(
        [Parameter(Mandatory = $true)][string]$JunctionPath,
        [Parameter(Mandatory = $true)][string]$TargetPath
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = Join-Path $env:SystemRoot "System32\cmd.exe"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $escapedJunction = $JunctionPath.Replace('"', '""')
    $escapedTarget = $TargetPath.Replace('"', '""')
    $startInfo.Arguments = "/d /c mklink /J `"$escapedJunction`" `"$escapedTarget`""
    $process = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) {
        return $false
    }
    try {
        $process.WaitForExit()
        return $process.ExitCode -eq 0 -and (Test-Path -LiteralPath $JunctionPath -PathType Container)
    } finally {
        $process.Dispose()
    }
}

function Test-DataRootAliases {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$PackageRoot
    )

    $dataRoot = Join-Path $dataRootsParent "Alias Root With Spaces"
    $junctionPath = Join-Path $dataRootsParent "Alias Junction"
    New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
    $owner = $null
    $junctionCreated = $false
    try {
        $owner = Start-TechmapProcess `
            -ExecutablePath $ExecutablePath `
            -DataRoot $dataRoot `
            -RunName "alias-owner" `
            -WorkingDirectory $PackageRoot
        $ownerUrl = Wait-ForHostUrl -StandardOutputPath $owner.Stdout -Process $owner.Process
        $ownerOutput = Read-TechmapOutput $owner
        if ($ownerOutput.IndexOf("TECHMAP_INSTANCE_STATUS=owner", [StringComparison]::Ordinal) -lt 0) {
            throw "The alias-test owner did not report owner status."
        }

        # ServerOptions resolves a relative --data-root from the executable directory.
        Push-Location $PackageRoot
        try {
            $relativePath = Resolve-Path -LiteralPath $dataRoot -Relative
        } finally {
            Pop-Location
        }
        $caseChangedPath = $dataRoot.ToUpperInvariant()
        $aliases = @(
            [pscustomobject]@{ Name = "absolute"; Path = $dataRoot },
            [pscustomobject]@{ Name = "relative"; Path = $relativePath },
            [pscustomobject]@{ Name = "case"; Path = $caseChangedPath }
        )

        $junctionCreated = Try-CreateJunction -JunctionPath $junctionPath -TargetPath $dataRoot
        if ($junctionCreated) {
            $aliases += [pscustomobject]@{ Name = "junction"; Path = $junctionPath }
        } else {
            Write-Host "TECHMAP_TEST_SKIP=junction_alias: Windows did not allow a junction to be created."
        }

        $shortPath = [TechmapPortableNativeMethods]::GetShortPath($dataRoot)
        if (![string]::IsNullOrWhiteSpace($shortPath) -and
            ![string]::Equals($shortPath, $dataRoot, [StringComparison]::OrdinalIgnoreCase)) {
            $aliases += [pscustomobject]@{ Name = "8dot3"; Path = $shortPath }
        } else {
            Write-Host "TECHMAP_TEST_SKIP=8dot3_alias: 8.3 names are unavailable on the test volume."
        }

        foreach ($alias in $aliases) {
            $launch = Start-TechmapProcess `
                -ExecutablePath $ExecutablePath `
                -DataRoot $alias.Path `
                -RunName "alias-$($alias.Name)" `
                -WorkingDirectory $PackageRoot `
                -PathBase "/alias-request-is-ignored"
            Assert-ExistingLaunch -Launch $launch -ExpectedUrl $ownerUrl
        }
    } finally {
        Stop-TechmapProcess $owner
        if ($junctionCreated -and (Test-Path -LiteralPath $junctionPath)) {
            [IO.Directory]::Delete($junctionPath)
        }
    }
}

function Test-DifferentDataRootsConcurrently {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$PackageRoot
    )

    $first = $null
    $second = $null
    try {
        $first = Start-TechmapProcess `
            -ExecutablePath $ExecutablePath `
            -DataRoot (Join-Path $dataRootsParent "Concurrent Root A") `
            -RunName "different-root-a" `
            -WorkingDirectory $PackageRoot
        $second = Start-TechmapProcess `
            -ExecutablePath $ExecutablePath `
            -DataRoot (Join-Path $dataRootsParent "Concurrent Root B") `
            -RunName "different-root-b" `
            -WorkingDirectory $PackageRoot

        $firstUrl = Wait-ForHostUrl -StandardOutputPath $first.Stdout -Process $first.Process
        $secondUrl = Wait-ForHostUrl -StandardOutputPath $second.Stdout -Process $second.Process
        if ($first.Process.HasExited -or $second.Process.HasExited) {
            throw "Different data roots did not remain owned concurrently."
        }
        if ($firstUrl -eq $secondUrl) {
            throw "Different data roots unexpectedly published one URL."
        }
        foreach ($launch in @($first, $second)) {
            if ((Read-TechmapOutput $launch).IndexOf(
                "TECHMAP_INSTANCE_STATUS=owner",
                [StringComparison]::Ordinal) -lt 0) {
                throw "Process '$($launch.RunName)' did not independently own its data root."
            }
        }
    } finally {
        Stop-TechmapProcess $second
        Stop-TechmapProcess $first
    }
}

function Test-SimultaneousLaunchBurst {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$PackageRoot
    )

    $dataRoot = Join-Path $dataRootsParent "Burst Root"
    $launches = @()
    try {
        foreach ($index in 1..6) {
            $launches += Start-TechmapProcess `
                -ExecutablePath $ExecutablePath `
                -DataRoot $dataRoot `
                -RunName "burst-$index" `
                -WorkingDirectory $PackageRoot
        }

        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        do {
            $outputs = @($launches | ForEach-Object { Read-TechmapOutput $_ })
            $owners = @($outputs | Where-Object {
                $_.IndexOf("TECHMAP_INSTANCE_STATUS=owner", [StringComparison]::Ordinal) -ge 0
            })
            $existing = @($outputs | Where-Object {
                $_.IndexOf("TECHMAP_INSTANCE_STATUS=existing", [StringComparison]::Ordinal) -ge 0
            })
            if ($owners.Count -eq 1 -and $existing.Count -eq ($launches.Count - 1)) {
                break
            }
            if (@($launches | Where-Object { $_.Process.HasExited -and $_.Process.ExitCode -ne 0 }).Count -gt 0) {
                throw "A simultaneous launcher failed before the burst converged."
            }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $deadline)

        if ($owners.Count -ne 1 -or $existing.Count -ne ($launches.Count - 1)) {
            throw "The simultaneous burst did not converge to one owner and $($launches.Count - 1) existing-instance launches."
        }

        $ownerLaunch = @($launches | Where-Object {
            (Read-TechmapOutput $_).IndexOf("TECHMAP_INSTANCE_STATUS=owner", [StringComparison]::Ordinal) -ge 0
        })
        if ($ownerLaunch.Count -ne 1 -or $ownerLaunch[0].Process.HasExited) {
            throw "The simultaneous burst did not leave exactly one live owner."
        }
        $ownerUrl = Get-PublishedHostUrl (Read-TechmapOutput $ownerLaunch[0])
        if ([string]::IsNullOrWhiteSpace($ownerUrl)) {
            throw "The simultaneous burst owner did not publish its URL."
        }

        foreach ($launch in $launches) {
            if ($launch.Process.Id -eq $ownerLaunch[0].Process.Id) {
                continue
            }
            Assert-ExistingLaunch -Launch $launch -ExpectedUrl $ownerUrl
        }
    } finally {
        foreach ($launch in $launches) {
            Stop-TechmapProcess $launch
        }
    }
}

function Test-OwnerDeathBeforeSessionPublication {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$PackageRoot
    )

    $dataRoot = Join-Path $dataRootsParent "Takeover Before Publication"
    $readyFile = Join-Path $artifactsRoot "takeover-owner-lease-ready"
    $releaseFile = Join-Path $artifactsRoot "takeover-owner-lease-release"
    $contendedFile = Join-Path $artifactsRoot "takeover-contender-lease-contended"
    Remove-Item -LiteralPath $readyFile, $releaseFile, $contendedFile -Force -ErrorAction SilentlyContinue
    $previousReady = $env:TECHMAP_TEST_LEASE_READY_FILE
    $previousRelease = $env:TECHMAP_TEST_LEASE_RELEASE_FILE
    $previousContended = $env:TECHMAP_TEST_LEASE_CONTENDED_FILE
    $owner = $null
    $contender = $null
    try {
        $env:TECHMAP_TEST_LEASE_READY_FILE = $readyFile
        $env:TECHMAP_TEST_LEASE_RELEASE_FILE = $releaseFile
        $owner = Start-TechmapProcess `
            -ExecutablePath $ExecutablePath `
            -DataRoot $dataRoot `
            -RunName "takeover-unpublished-owner" `
            -WorkingDirectory $PackageRoot
        $env:TECHMAP_TEST_LEASE_READY_FILE = $previousReady
        $env:TECHMAP_TEST_LEASE_RELEASE_FILE = $previousRelease

        Wait-ForFile -Path $readyFile -Process $owner.Process
        if (![string]::IsNullOrWhiteSpace((Get-PublishedHostUrl (Read-TechmapOutput $owner)))) {
            throw "The blocked startup published its host URL before release."
        }

        $env:TECHMAP_TEST_LEASE_CONTENDED_FILE = $contendedFile
        $contender = Start-TechmapProcess `
            -ExecutablePath $ExecutablePath `
            -DataRoot $dataRoot `
            -RunName "takeover-contender" `
            -WorkingDirectory $PackageRoot
        $env:TECHMAP_TEST_LEASE_CONTENDED_FILE = $previousContended

        Wait-ForFile -Path $contendedFile -Process $contender.Process
        if ($contender.Process.HasExited) {
            throw "The contender exited while the unpublished owner still held the lease."
        }
        if ((Read-TechmapOutput $contender).IndexOf("TECHMAP_INSTANCE_STATUS=owner", [StringComparison]::Ordinal) -ge 0) {
            throw "The contender became owner before the first process released its lease."
        }

        Stop-TechmapProcess $owner
        $owner = $null
        $contenderUrl = Wait-ForHostUrl `
            -StandardOutputPath $contender.Stdout `
            -Process $contender.Process `
            -TimeoutSeconds 15
        if ((Read-TechmapOutput $contender).IndexOf(
            "TECHMAP_INSTANCE_STATUS=owner",
            [StringComparison]::Ordinal) -lt 0) {
            throw "The contender did not take ownership after the unpublished owner died."
        }

        $health = Invoke-WebRequest -UseBasicParsing -Uri "${contenderUrl}api/v1/health"
        Assert-Equal ([int]$health.StatusCode) 200 "The takeover owner health request failed."
    } finally {
        $env:TECHMAP_TEST_LEASE_READY_FILE = $previousReady
        $env:TECHMAP_TEST_LEASE_RELEASE_FILE = $previousRelease
        $env:TECHMAP_TEST_LEASE_CONTENDED_FILE = $previousContended
        Stop-TechmapProcess $contender
        Stop-TechmapProcess $owner
        Remove-Item -LiteralPath $readyFile, $releaseFile, $contendedFile -Force -ErrorAction SilentlyContinue
    }
}

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

$rootProject = Test-HostMode `
    -ExecutablePath $executables[0].FullName `
    -DataRoot (Join-Path $dataRootsParent "Корневой режим") `
    -PathBase "/" `
    -RunName "root" `
    -ExampleXlsxPath $exampleXlsxPath
Test-HostMode `
    -ExecutablePath $executables[0].FullName `
    -DataRoot (Join-Path $dataRootsParent "Корневой режим") `
    -PathBase "/" `
    -RunName "root-restart-after-forced-stop" `
    -ExpectedProject $rootProject | Out-Null
Test-HostMode `
    -ExecutablePath $executables[0].FullName `
    -DataRoot (Join-Path $dataRootsParent "Режим с префиксом") `
    -PathBase "/techmap" `
    -RunName "prefix" | Out-Null

Test-DataRootAliases `
    -ExecutablePath $executables[0].FullName `
    -PackageRoot $packageRoot
Test-DifferentDataRootsConcurrently `
    -ExecutablePath $executables[0].FullName `
    -PackageRoot $packageRoot
Test-SimultaneousLaunchBurst `
    -ExecutablePath $executables[0].FullName `
    -PackageRoot $packageRoot
Test-OwnerDeathBeforeSessionPublication `
    -ExecutablePath $executables[0].FullName `
    -PackageRoot $packageRoot

[pscustomobject]@{
    Status = "ok"
    Archive = $resolvedArchive
    Package = $packageRoot
    Executable = $executables[0].FullName
    Modes = 7
}
