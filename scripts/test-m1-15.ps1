param(
    [string]$PreviousArchive,
    [string]$PreviousArchiveSha256,
    [string]$CurrentArchive,
    [switch]$SkipBuild,
    [switch]$SkipPortableTest,
    [switch]$SkipPackagedRestore
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$expectedArtifactsRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "artifacts\m1-15"))
$runName = "r-{0}" -f [Guid]::NewGuid().ToString("N").Substring(0, 8)
$artifactsRoot = Join-Path $expectedArtifactsRoot $runName
$defaultPreviousArchive = Join-Path $repositoryRoot "artifacts\checkpoints\TECHMAP-GRAPHER-M1-13-check.zip"
$defaultPreviousArchiveSha256 = "be5322cca6a0d16c624e787f529e098d7e8a1f781c7d36cce968b0b8077d8322"
$defaultCurrentArchive = Join-Path $repositoryRoot "artifacts\m2-03\TECHMAP-GRAPHER-win-x64.zip"
$verifyPackageScript = Join-Path $PSScriptRoot "verify-package.ps1"
$utf8NoBom = [Text.UTF8Encoding]::new($false)

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

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (!$Condition) { throw $Message }
}

function Assert-WithinM115Artifacts {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$AllowRoot
    )
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $allowedRoot = $expectedArtifactsRoot.TrimEnd('\')
    if ($AllowRoot -and $candidate.Equals($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return
    }
    $prefix = $allowedRoot + '\'
    if (!$candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside artifacts/m1-15: $candidate"
    }
}

function Initialize-M115Artifacts {
    Assert-WithinM115Artifacts -Path $artifactsRoot
    if (Test-Path -LiteralPath $expectedArtifactsRoot) {
        $baseItem = Get-Item -LiteralPath $expectedArtifactsRoot -Force
        if ($baseItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to use a reparse-point artifacts/m1-15 root: $expectedArtifactsRoot"
        }
    }
    New-Item -ItemType Directory -Force -Path $artifactsRoot | Out-Null
    $runItem = Get-Item -LiteralPath $artifactsRoot -Force
    if ($runItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing to use a reparse-point M1-15 run root: $artifactsRoot"
    }
    [IO.File]::WriteAllText(
        (Join-Path $artifactsRoot ".m1-15-run-owner"),
        $runName,
        $utf8NoBom)
}

function Resolve-RequiredFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Description
    )
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description is missing: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Expand-TechmapArchive {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    Assert-WithinM115Artifacts $Destination
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Destination
    $topLevel = @(Get-ChildItem -LiteralPath $Destination -Force)
    if ($topLevel.Count -ne 1 -or !$topLevel[0].PSIsContainer -or
        $topLevel[0].Name -ne "TECHMAP-GRAPHER") {
        throw "Package archive must contain exactly one TECHMAP-GRAPHER directory: $ArchivePath"
    }
    & $verifyPackageScript -PackageRoot $topLevel[0].FullName | Out-Null
    return $topLevel[0].FullName
}

function Get-PackageVersion {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][int]$ExpectedSchema,
        [Parameter(Mandatory = $true)][string]$Description
    )
    $versionPath = Join-Path $PackageRoot "VERSION.json"
    $version = Get-Content -Raw -LiteralPath $versionPath | ConvertFrom-Json
    Assert-Equal $version.productId "TECHMAP-GRAPHER" "$Description has another product ID."
    Assert-Equal ([int]$version.storage.schema) $ExpectedSchema `
        "$Description has an unexpected storage schema."
    Assert-True (![string]::IsNullOrWhiteSpace([string]$version.appVersion)) `
        "$Description has no application version."
    return $version
}

function Get-FreeTcpPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function ConvertTo-NativeCommandLineArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = [Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Start-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $ExecutablePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $startInfo.EnvironmentVariables["DOTNET_DISABLE_GUI_ERRORS"] = "1"
    $startInfo.EnvironmentVariables["DOTNET_MULTILEVEL_LOOKUP"] = "0"
    $startInfo.EnvironmentVariables["DOTNET_ROOT"] = Join-Path $artifactsRoot "несуществующий runtime"
    $startInfo.EnvironmentVariables["APPDATA"] = Join-Path $artifactsRoot "Изолированный AppData"
    $startInfo.Arguments = @($Arguments | ForEach-Object {
        ConvertTo-NativeCommandLineArgument $_
    }) -join ' '

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (!$process.Start()) {
        $process.Dispose()
        throw "Could not start process '$Name'."
    }
    return [pscustomobject]@{
        Name = $Name
        Process = $process
        StdoutTask = $process.StandardOutput.ReadToEndAsync()
        StderrTask = $process.StandardError.ReadToEndAsync()
    }
}

function Stop-CapturedProcess {
    param($Launch)
    if ($null -eq $Launch) { return }
    try {
        if (!$Launch.Process.HasExited) {
            $Launch.Process.Kill()
            if (!$Launch.Process.WaitForExit(10000)) {
                throw "Process '$($Launch.Name)' did not stop after PID $($Launch.Process.Id) was killed."
            }
        }
    } finally {
        $Launch.Process.Dispose()
    }
}

function Wait-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)]$Launch,
        [int]$TimeoutSeconds = 45,
        [int]$ExpectedExitCode = 0
    )
    try {
        if (!$Launch.Process.WaitForExit($TimeoutSeconds * 1000)) {
            $pidToKill = $Launch.Process.Id
            $Launch.Process.Kill()
            if (!$Launch.Process.WaitForExit(10000)) {
                throw "Process '$($Launch.Name)' did not exit within 10 seconds after PID $pidToKill was killed."
            }
            throw "Process '$($Launch.Name)' timed out; captured PID $pidToKill was killed."
        }
        $stdout = $Launch.StdoutTask.GetAwaiter().GetResult()
        $stderr = $Launch.StderrTask.GetAwaiter().GetResult()
        if ($Launch.Process.ExitCode -ne $ExpectedExitCode) {
            throw "Process '$($Launch.Name)' exited with $($Launch.Process.ExitCode), expected $ExpectedExitCode.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
        }
        return [pscustomobject]@{
            ExitCode = $Launch.Process.ExitCode
            Stdout = $stdout
            Stderr = $stderr
        }
    } finally {
        $Launch.Process.Dispose()
    }
}

function Invoke-TechmapCommand {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$ExpectedExitCode = 0,
        [int]$TimeoutSeconds = 60
    )
    $effectiveArguments = @($Arguments)
    if (!("--no-error-dialog" -in $effectiveArguments)) {
        $effectiveArguments = @("--no-error-dialog") + $effectiveArguments
    }
    $launch = Start-CapturedProcess `
        -ExecutablePath $ExecutablePath `
        -Arguments $effectiveArguments `
        -WorkingDirectory $WorkingDirectory `
        -Name $Name
    return Wait-CapturedProcess `
        -Launch $launch `
        -TimeoutSeconds $TimeoutSeconds `
        -ExpectedExitCode $ExpectedExitCode
}

function Get-OutputValue {
    param(
        [Parameter(Mandatory = $true)][string]$Output,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $match = [regex]::Match(
        $Output,
        "(?m)^$([regex]::Escape($Name))=(.+?)\r?$",
        [Text.RegularExpressions.RegexOptions]::CultureInvariant)
    if (!$match.Success -or [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
        throw "Process output does not contain $Name. Output: $Output"
    }
    return $match.Groups[1].Value.TrimEnd("`r")
}

function Wait-ForHttpReady {
    param(
        [Parameter(Mandatory = $true)]$Launch,
        [Parameter(Mandatory = $true)][string]$Origin,
        [int]$TimeoutSeconds = 30
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Launch.Process.HasExited) {
            throw "Host '$($Launch.Name)' exited before readiness with code $($Launch.Process.ExitCode)."
        }
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$Origin/api/v1/health" -TimeoutSec 2
            if ($health.status -eq "ok") { return }
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    throw "Host '$($Launch.Name)' did not become ready at $Origin."
}

function Start-TechmapHost {
    param(
        [Parameter(Mandatory = $true)][string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $port = Get-FreeTcpPort
    $origin = "http://127.0.0.1:$port"
    $launch = Start-CapturedProcess `
        -ExecutablePath $ExecutablePath `
        -Arguments @(
            "--no-browser",
            "--no-error-dialog",
            "--port=$port",
            "--data-root=$DataRoot",
            "--backup-root=$BackupRoot") `
        -WorkingDirectory $PackageRoot `
        -Name $Name
    try {
        Wait-ForHttpReady -Launch $launch -Origin $origin
    } catch {
        Stop-CapturedProcess $launch
        throw
    }
    return [pscustomobject]@{ Launch = $launch; Origin = $origin }
}

function New-ProtectedApiSession {
    param([Parameter(Mandatory = $true)][string]$Origin)
    $webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $ui = Invoke-WebRequest -UseBasicParsing -WebSession $webSession -Uri "$Origin/" -TimeoutSec 10
    Assert-Equal ([int]$ui.StatusCode) 200 "UI bootstrap failed."
    $session = Invoke-RestMethod `
        -WebSession $webSession `
        -Method Get `
        -Uri "$Origin/api/v1/session" `
        -TimeoutSec 10
    return [pscustomobject]@{
        WebSession = $webSession
        Headers = @{ Origin = $Origin; "X-Techmap-CSRF" = $session.csrfNonce }
    }
}

function Invoke-ProtectedJson {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)]$ApiSession,
        [Parameter(Mandatory = $true)]$Body
    )
    return Invoke-RestMethod `
        -WebSession $ApiSession.WebSession `
        -Method $Method `
        -Headers $ApiSession.Headers `
        -ContentType "application/json" `
        -Body ($Body | ConvertTo-Json -Depth 8 -Compress) `
        -Uri $Uri `
        -TimeoutSec 15
}

function Get-Project {
    param(
        [Parameter(Mandatory = $true)][string]$Origin,
        [Parameter(Mandatory = $true)]$ApiSession,
        [Parameter(Mandatory = $true)][string]$ProjectId
    )
    return Invoke-RestMethod `
        -WebSession $ApiSession.WebSession `
        -Method Get `
        -Uri "$Origin/api/v1/projects/$ProjectId" `
        -TimeoutSec 10
}

function Assert-HarnessDocuments {
    param(
        [Parameter(Mandatory = $true)]$Project,
        [long[]]$ExpectedQuantities
    )
    Assert-Equal @($Project.harnesses).Count 2 "Project must contain two harnesses."
    if ($null -ne $ExpectedQuantities) {
        Assert-Equal ([long]$Project.harnesses[0].quantity) $ExpectedQuantities[0] `
            "First harness quantity is incorrect."
        Assert-Equal ([long]$Project.harnesses[1].quantity) $ExpectedQuantities[1] `
            "Second harness quantity is incorrect."
    }
    $documentIds = @()
    foreach ($harness in $Project.harnesses) {
        $documents = @($harness.documents)
        Assert-Equal $documents.Count 3 "Harness does not contain three documents."
        Assert-Equal (@($documents.kind | Sort-Object) -join ",") "drawing,e4,route" `
            "Harness document kinds are incorrect."
        Assert-Equal (@($documents.status | Select-Object -Unique) -join ",") "empty" `
            "Harness documents are not empty."
        $documentIds += @($documents.documentId)
    }
    Assert-Equal @($documentIds | Select-Object -Unique).Count 6 `
        "Document IDs are not unique across both harnesses."
    return $documentIds
}

function Assert-ProjectIdentity {
    param(
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)]$Expected
    )
    foreach ($property in @(
        "projectId", "designation", "increment", "name", "batchQuantity", "status",
        "revision", "createdUtc", "updatedUtc")) {
        if ($property -in @($Expected.PSObject.Properties.Name)) {
            Assert-Equal $Actual.$property $Expected.$property `
                "Project property '$property' changed."
        }
    }
    Assert-Equal @($Actual.harnesses).Count @($Expected.harnesses).Count `
        "Harness count changed."
    foreach ($index in 0..(@($Expected.harnesses).Count - 1)) {
        $actualHarness = $Actual.harnesses[$index]
        $expectedHarness = $Expected.harnesses[$index]
        foreach ($property in @(
            "harnessId", "designation", "quantity", "sortOrder", "createdUtc", "updatedUtc")) {
            if ($property -in @($expectedHarness.PSObject.Properties.Name)) {
                Assert-Equal $actualHarness.$property $expectedHarness.$property `
                    "Harness property '$property' changed at index $index."
            }
        }
        if ("documents" -in @($expectedHarness.PSObject.Properties.Name)) {
            Assert-Equal @($actualHarness.documents).Count @($expectedHarness.documents).Count `
                "Harness document count changed at index $index."
            foreach ($expectedDocument in @($expectedHarness.documents)) {
                $matches = @($actualHarness.documents | Where-Object kind -eq $expectedDocument.kind)
                Assert-Equal $matches.Count 1 `
                    "Harness document kind '$($expectedDocument.kind)' changed at index $index."
                foreach ($property in @(
                    "documentId", "kind", "status", "createdUtc", "updatedUtc")) {
                    Assert-Equal $matches[0].$property $expectedDocument.$property `
                        "Harness document property '$property' changed at index $index."
                }
            }
        }
    }
}

function New-ProjectWithTwoHarnesses {
    param(
        [Parameter(Mandatory = $true)][string]$Origin,
        [Parameter(Mandatory = $true)]$ApiSession
    )
    $project = Invoke-ProtectedJson `
        -Uri "$Origin/api/v1/projects" `
        -Method Post `
        -ApiSession $ApiSession `
        -Body @{
            designation = "ПР-M1-15"
            name = "Сквозная приёмка — проект контейнер"
            status = "draft"
        }
    foreach ($input in @(
        [pscustomobject]@{ Designation = "ЖГУТ-ЛЕВЫЙ"; Quantity = 5 },
        [pscustomobject]@{ Designation = "ЖГУТ-ПРАВЫЙ"; Quantity = 12 }
    )) {
        $command = Invoke-ProtectedJson `
            -Uri "$Origin/api/v1/projects/$($project.projectId)/harnesses" `
            -Method Post `
            -ApiSession $ApiSession `
            -Body @{
                commandId = [Guid]::NewGuid().ToString("D")
                expectedRevision = [long]$project.revision
                designation = $input.Designation
                quantity = $input.Quantity
            }
        $project = $command.project
    }
    Assert-HarnessDocuments -Project $project -ExpectedQuantities @(5, 12) | Out-Null
    return $project
}

function Test-SameSizeCorruption {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$ExecutablePath
    )
    $archiveCopy = Join-Path $artifactsRoot "current-same-size-corrupt.zip"
    Copy-Item -LiteralPath $ArchivePath -Destination $archiveCopy
    $archiveBytes = [IO.File]::ReadAllBytes($archiveCopy)
    $archiveOffset = [Math]::Floor($archiveBytes.Length / 2)
    $archiveBytes[$archiveOffset] = $archiveBytes[$archiveOffset] -bxor 0x01
    [IO.File]::WriteAllBytes($archiveCopy, $archiveBytes)
    Assert-Equal (Get-Item -LiteralPath $archiveCopy).Length (Get-Item -LiteralPath $ArchivePath).Length `
        "Same-size archive corruption changed the ZIP length."
    $archiveRejected = $false
    try {
        $corruptExtraction = Join-Path $artifactsRoot "Поврежденный ZIP"
        New-Item -ItemType Directory -Force -Path $corruptExtraction | Out-Null
        Expand-Archive -LiteralPath $archiveCopy -DestinationPath $corruptExtraction
        $corruptRoot = Join-Path $corruptExtraction "TECHMAP-GRAPHER"
        & $verifyPackageScript -PackageRoot $corruptRoot | Out-Null
    } catch {
        $archiveRejected = $true
    }
    Assert-True $archiveRejected "A same-size XOR corruption of the ZIP was not detected."

    $target = Join-Path $PackageRoot "README-START.html"
    $original = [IO.File]::ReadAllBytes($target)
    Assert-True ($original.Length -gt 0) "Cannot corrupt an empty packaged file."
    try {
        $offset = [Math]::Floor($original.Length / 2)
        $corrupt = [byte[]]$original.Clone()
        $corrupt[$offset] = $corrupt[$offset] -bxor 0x01
        [IO.File]::WriteAllBytes($target, $corrupt)
        Assert-Equal (Get-Item -LiteralPath $target).Length $original.Length `
            "Same-size package corruption changed the file length."
        $result = Invoke-TechmapCommand `
            -ExecutablePath $ExecutablePath `
            -Arguments @("--verify-package") `
            -WorkingDirectory $PackageRoot `
            -Name "same-size package corruption" `
            -ExpectedExitCode 1
        Assert-True `
            (($result.Stderr + $result.Stdout).IndexOf("checksum", [StringComparison]::OrdinalIgnoreCase) -ge 0) `
            "Package verification failure did not identify a checksum problem."
    } finally {
        [IO.File]::WriteAllBytes($target, $original)
    }
    & $verifyPackageScript -PackageRoot $PackageRoot | Out-Null
}

function Invoke-PreviousPackageScenario {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][string]$ExportPath
    )
    $executable = Join-Path $PackageRoot "Techmap.Server.exe"
    $server = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "M1-13 source host"
    try {
        $apiSession = New-ProtectedApiSession $server.Origin
        $project = Invoke-ProtectedJson `
            -Uri "$($server.Origin)/api/v1/projects" `
            -Method Post `
            -ApiSession $apiSession `
            -Body @{
                designation = "ПР-M1-15"
                name = "Сквозная приёмка обновления"
                batchQuantity = 20
                status = "draft"
            }
        foreach ($designation in @("ЖГУТ-ЛЕВЫЙ", "ЖГУТ-ПРАВЫЙ")) {
            $response = Invoke-ProtectedJson `
                -Uri "$($server.Origin)/api/v1/projects/$($project.projectId)/harnesses" `
                -Method Post `
                -ApiSession $apiSession `
                -Body @{
                    commandId = [Guid]::NewGuid().ToString("D")
                    expectedRevision = [long]$project.revision
                    designation = $designation
                }
            $project = $response.project
        }
    } finally {
        Stop-CapturedProcess $server.Launch
    }

    $restart = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "M1-13 forced restart"
    try {
        $restartSession = New-ProtectedApiSession $restart.Origin
        $afterRestart = Get-Project $restart.Origin $restartSession $project.projectId
        Assert-ProjectIdentity -Actual $afterRestart -Expected $project

        $second = Invoke-TechmapCommand `
            -ExecutablePath $executable `
            -Arguments @("--no-browser", "--data-root=$DataRoot") `
            -WorkingDirectory $PackageRoot `
            -Name "M1-13 second process resolution" `
            -TimeoutSeconds 20
        Assert-True `
            ($second.Stdout.IndexOf("TECHMAP_INSTANCE_STATUS=existing", [StringComparison]::Ordinal) -ge 0) `
            "Second packaged process did not resolve the existing owner."
        Assert-True `
            ($second.Stdout.IndexOf("TECHMAP_HOST_URL=$($restart.Origin)/", [StringComparison]::Ordinal) -ge 0) `
            "Second packaged process did not report the original owner URL."
        $project = $afterRestart
    } finally {
        Stop-CapturedProcess $restart.Launch
    }

    $export = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--backup-root=$BackupRoot",
            "--export-project=$($project.projectId)",
            "--export-destination=$ExportPath") `
        -WorkingDirectory $PackageRoot `
        -Name "M1-13 project export"
    Assert-Equal (Get-OutputValue $export.Stdout "TECHMAP_PROJECT_EXPORT_STATUS") "ok" `
        "Previous package project export failed."
    Assert-True (Test-Path -LiteralPath $ExportPath -PathType Leaf) `
        "Previous package did not publish its project export."
    return $project
}

function Assert-MigrationAndRestart {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)]$PreviousProject,
        [Parameter(Mandatory = $true)][string]$PreviousAppVersion,
        [Parameter(Mandatory = $true)][string]$CurrentAppVersion
    )
    $executable = Join-Path $PackageRoot "Techmap.Server.exe"
    $sourceGeneration = (Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()
    $sourceDatabase = Join-Path `
        (Join-Path (Join-Path $DataRoot "generations") $sourceGeneration) `
        "app.db"
    $sourceDatabaseSha256 = (Get-FileHash -LiteralPath $sourceDatabase -Algorithm SHA256).Hash.ToLowerInvariant()
    $server = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "current package migration"
    try {
        $apiSession = New-ProtectedApiSession $server.Origin
        $migrated = Get-Project $server.Origin $apiSession $PreviousProject.projectId
        Assert-ProjectIdentity -Actual $migrated -Expected $PreviousProject
        Assert-HarnessDocuments -Project $migrated -ExpectedQuantities @(20, 20) | Out-Null
    } finally {
        Stop-CapturedProcess $server.Launch
    }

    $version = Get-Content -Raw -LiteralPath (Join-Path $PackageRoot "VERSION.json") | ConvertFrom-Json
    $preUpdateBackups = @(Get-ChildItem -LiteralPath $BackupRoot -Directory -Filter "backup-*" | Where-Object {
        $manifestPath = Join-Path $_.FullName "manifest.json"
        if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $false }
        (Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).kind -eq "pre-update"
    })
    Assert-True ($preUpdateBackups.Count -ge 1) "Schema migration did not publish a pre-update backup."
    $preUpdateManifest = Get-Content -Raw `
        -LiteralPath (Join-Path $preUpdateBackups[-1].FullName "manifest.json") | ConvertFrom-Json
    Assert-Equal ([int]$preUpdateManifest.schemaVersion) 4 `
        "Pre-update backup did not preserve source schema 4."
    Assert-Equal ([string]$preUpdateManifest.appVersion) $CurrentAppVersion `
        "Pre-update backup has the wrong target application version."
    Assert-Equal ([string]$preUpdateManifest.previousAppVersion) $PreviousAppVersion `
        "Pre-update backup has the wrong previous application version."
    $preUpdateDatabase = @($preUpdateManifest.files | Where-Object path -eq "app.db")
    Assert-Equal $preUpdateDatabase.Count 1 "Pre-update manifest has no unique app.db entry."
    Assert-True ([string]$preUpdateDatabase[0].sha256 -match '^[0-9a-f]{64}$') `
        "Pre-update backup has no valid database SHA-256."
    $preUpdateRevision = @($preUpdateManifest.projectRevisions | Where-Object {
        $_.projectId -eq $PreviousProject.projectId
    })
    Assert-Equal $preUpdateRevision.Count 1 `
        "Pre-update backup does not contain the source project revision."
    Assert-Equal ([long]$preUpdateRevision[0].revision) ([long]$PreviousProject.revision) `
        "Pre-update backup captured another source project revision."
    $currentPointer = (Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()
    Assert-True ($currentPointer -ne $sourceGeneration) `
        "Schema migration did not switch CURRENT to a new generation."
    Assert-True (Test-Path -LiteralPath $sourceDatabase -PathType Leaf) `
        "Schema migration removed the source generation."
    Assert-Equal `
        (Get-FileHash -LiteralPath $sourceDatabase -Algorithm SHA256).Hash.ToLowerInvariant() `
        $sourceDatabaseSha256 "Schema migration changed the source database."
    Assert-True (!(Test-Path -LiteralPath (Join-Path $DataRoot "MIGRATION.json"))) `
        "Successful migration left MIGRATION.json behind."
    Assert-Equal @(Get-ChildItem -LiteralPath $DataRoot -Recurse -Force | Where-Object {
        $_.Name -like "*.staging"
    }).Count 0 "Successful migration left staging entries behind."
    $databasePath = Join-Path (Join-Path (Join-Path $DataRoot "generations") $currentPointer) "app.db"
    Assert-True (Test-Path -LiteralPath $databasePath -PathType Leaf) `
        "Migrated active SQLite generation is missing."
    $restart = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "current package post-migration restart"
    try {
        $restartSession = New-ProtectedApiSession $restart.Origin
        $afterRestart = Get-Project $restart.Origin $restartSession $migrated.projectId
        Assert-ProjectIdentity -Actual $afterRestart -Expected $migrated
        $diagnostics = Invoke-RestMethod `
            -WebSession $restartSession.WebSession `
            -Method Get `
            -Uri "$($restart.Origin)/api/v1/diagnostics" `
            -TimeoutSec 10
        Assert-Equal ([int]$diagnostics.schemaVersion) ([int]$version.storage.schema) `
            "Restart opened another storage schema."
    } finally {
        Stop-CapturedProcess $restart.Launch
    }

    return [pscustomobject]@{
        Project = $afterRestart
        SchemaVersion = [int]$version.storage.schema
        DatabasePath = $databasePath
        DatabaseSha256 = (Get-FileHash -LiteralPath $databasePath -Algorithm SHA256).Hash.ToLowerInvariant()
        PreUpdateBackups = $preUpdateBackups.Count
    }
}

function Assert-ImportedCopy {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][string]$ExportPath,
        [Parameter(Mandatory = $true)]$OriginalProject
    )
    $executable = Join-Path $PackageRoot "Techmap.Server.exe"
    $import = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--backup-root=$BackupRoot",
            "--import-project=$ExportPath") `
        -WorkingDirectory $PackageRoot `
        -Name "current package project import"
    Assert-Equal (Get-OutputValue $import.Stdout "TECHMAP_PROJECT_IMPORT_STATUS") "ok" `
        "Current package project import failed."
    $importedId = Get-OutputValue $import.Stdout "TECHMAP_PROJECT_IMPORT_PROJECT_ID"
    Assert-True (!$importedId.Equals($OriginalProject.projectId, [StringComparison]::OrdinalIgnoreCase)) `
        "Imported project reused the source project UUID."

    $server = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "post-import host"
    try {
        $apiSession = New-ProtectedApiSession $server.Origin
        $projects = Invoke-RestMethod `
            -WebSession $apiSession.WebSession `
            -Method Get `
            -Uri "$($server.Origin)/api/v1/projects" `
            -TimeoutSec 10
        Assert-Equal @($projects.projects).Count 2 "Import did not preserve source plus one copy."
        $sourceAfter = Get-Project $server.Origin $apiSession $OriginalProject.projectId
        Assert-ProjectIdentity -Actual $sourceAfter -Expected $OriginalProject
        $imported = Get-Project $server.Origin $apiSession $importedId
        Assert-Equal ([long]$imported.revision) 0 "Imported project revision is not zero."
        Assert-HarnessDocuments -Project $imported -ExpectedQuantities @(20, 20) | Out-Null
        Assert-True (@($imported.harnesses.harnessId | Where-Object {
            $_ -in @($OriginalProject.harnesses.harnessId)
        }).Count -eq 0) "Imported harness UUIDs overlap the source project."
        return [pscustomobject]@{
            ImportedProjectId = $imported.projectId
            ImportedRevision = [long]$imported.revision
            ProjectCount = @($projects.projects).Count
            SourceProject = $sourceAfter
            ImportedProject = $imported
        }
    } finally {
        Stop-CapturedProcess $server.Launch
    }
}

function Invoke-PackagedRestoreAcceptance {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$DataRoot,
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][object[]]$ExpectedProjects
    )
    $executable = Join-Path $PackageRoot "Techmap.Server.exe"
    $currentGenerationBeforeBackup = (Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()
    $liveDatabase = Join-Path `
        (Join-Path (Join-Path $DataRoot "generations") $currentGenerationBeforeBackup) `
        "app.db"
    $liveDatabaseSha256 = (Get-FileHash -LiteralPath $liveDatabase -Algorithm SHA256).Hash.ToLowerInvariant()
    $create = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--create-backup",
            "--backup-root=$BackupRoot") `
        -WorkingDirectory $PackageRoot `
        -Name "packaged regular backup"
    Assert-Equal (Get-OutputValue $create.Stdout "TECHMAP_STORAGE_BACKUP_STATUS") "ok" `
        "Packaged backup command failed."
    $backupId = (Get-OutputValue $create.Stdout "TECHMAP_STORAGE_BACKUP_ID").Replace("-", "")
    $publishedBackups = @(Get-ChildItem -LiteralPath $BackupRoot -Directory -Filter "backup-*$backupId")
    Assert-Equal $publishedBackups.Count 1 `
        "Packaged backup command did not publish exactly one directory for its backup ID."
    $backupPath = $publishedBackups[0].FullName
    $backupManifestSha256 = Get-OutputValue $create.Stdout "TECHMAP_STORAGE_BACKUP_MANIFEST_SHA256"
    $backupDatabaseSha256 = Get-OutputValue $create.Stdout "TECHMAP_STORAGE_BACKUP_DATABASE_SHA256"
    Assert-True (Test-Path -LiteralPath $backupPath -PathType Container) `
        "Packaged backup path is not a published directory: '$backupPath'."
    Assert-True ($backupManifestSha256 -match '^[0-9a-f]{64}$') `
        "Packaged backup did not report a lowercase SHA-256."
    Assert-True ($backupDatabaseSha256 -match '^[0-9a-f]{64}$') `
        "Packaged backup did not report its database SHA-256."
    $currentGenerationAfterBackup = (Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()
    $liveDatabaseAfterBackup = Join-Path `
        (Join-Path (Join-Path $DataRoot "generations") $currentGenerationAfterBackup) `
        "app.db"
    $liveDatabaseSha256AfterBackup = (Get-FileHash `
        -LiteralPath $liveDatabaseAfterBackup `
        -Algorithm SHA256).Hash.ToLowerInvariant()

    $recoveryRoot = Join-Path $artifactsRoot "Пробное восстановление с пробелом"
    $dryRun = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--dry-run-restore=$backupPath",
            "--recovery-root=$recoveryRoot") `
        -WorkingDirectory $PackageRoot `
        -Name "packaged dry-run restore"
    Assert-Equal (Get-OutputValue $dryRun.Stdout "TECHMAP_STORAGE_DRY_RUN_RESTORE_STATUS") "ok" `
        "Packaged dry-run restore failed."
    Assert-True (Test-Path -LiteralPath $recoveryRoot -PathType Container) `
        "Dry-run restore did not publish the requested recovery root."
    Assert-Equal `
        (Get-OutputValue $dryRun.Stdout "TECHMAP_STORAGE_DRY_RUN_RESTORE_DATABASE_SHA256") `
        $backupDatabaseSha256 `
        "Dry-run database differs from the backed-up database."
    Assert-Equal ((Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()) `
        $currentGenerationBeforeBackup `
        "Dry-run restore changed the live CURRENT generation."
    Assert-Equal (Get-FileHash -LiteralPath $liveDatabaseAfterBackup -Algorithm SHA256).Hash.ToLowerInvariant() `
        $liveDatabaseSha256AfterBackup `
        "Dry-run restore changed the live database."

    $recoveryHost = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $recoveryRoot `
        -BackupRoot (Join-Path $artifactsRoot "Recovery backups") `
        -Name "dry-run recovered host"
    try {
        $recoverySession = New-ProtectedApiSession $recoveryHost.Origin
        $recoveredList = Invoke-RestMethod `
            -WebSession $recoverySession.WebSession `
            -Method Get `
            -Uri "$($recoveryHost.Origin)/api/v1/projects" `
            -TimeoutSec 10
        Assert-Equal @($recoveredList.projects).Count $ExpectedProjects.Count `
            "Dry-run recovery does not contain every backed-up project."
        foreach ($expected in $ExpectedProjects) {
            $recovered = Get-Project $recoveryHost.Origin $recoverySession $expected.projectId
            Assert-ProjectIdentity -Actual $recovered -Expected $expected
            Assert-HarnessDocuments -Project $recovered -ExpectedQuantities @(
                [long]$expected.harnesses[0].quantity,
                [long]$expected.harnesses[1].quantity) | Out-Null
        }
    } finally {
        Stop-CapturedProcess $recoveryHost.Launch
    }

    $mutatingHost = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "pre-full-restore mutation"
    try {
        $mutationSession = New-ProtectedApiSession $mutatingHost.Origin
        $busyResult = Invoke-TechmapCommand `
            -ExecutablePath $executable `
            -Arguments @(
                "--no-error-dialog",
                "--data-root=$DataRoot",
                "--create-backup",
                "--backup-root=$BackupRoot") `
            -WorkingDirectory $PackageRoot `
            -Name "busy data-root backup rejection" `
            -ExpectedExitCode 1 `
            -TimeoutSeconds 20
        Assert-True `
            (($busyResult.Stderr + $busyResult.Stdout).IndexOf("exclusive", [StringComparison]::OrdinalIgnoreCase) -ge 0) `
            "Maintenance command did not explain the busy data-root rejection."
        $projectToMutate = $ExpectedProjects[0]
        $mutated = Invoke-ProtectedJson `
            -Uri "$($mutatingHost.Origin)/api/v1/projects/$($projectToMutate.projectId)" `
            -Method Patch `
            -ApiSession $mutationSession `
            -Body @{
                commandId = [Guid]::NewGuid().ToString("D")
                expectedRevision = [long]$projectToMutate.revision
                name = "Изменено перед полным восстановлением"
            }
        Assert-True ($mutated.project.revision -gt $projectToMutate.revision) `
            "Pre-restore mutation did not advance the live project revision."
    } finally {
        Stop-CapturedProcess $mutatingHost.Launch
    }

    $restorePlan = Join-Path $artifactsRoot "План полного восстановления.json"
    $prepare = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--prepare-full-restore=$backupPath",
            "--restore-plan=$restorePlan") `
        -WorkingDirectory $PackageRoot `
        -Name "prepare packaged full restore"
    Assert-Equal `
        (Get-OutputValue $prepare.Stdout "TECHMAP_STORAGE_FULL_RESTORE_PREPARE_STATUS") `
        "confirmation_required" `
        "Packaged full restore preparation failed."
    Assert-True (Test-Path -LiteralPath $restorePlan -PathType Leaf) `
        "Prepare command did not publish the requested restore plan."
    $plan = Get-Content -Raw -LiteralPath $restorePlan | ConvertFrom-Json
    $requiredConfirmation = [string]$plan.RequiredConfirmation
    if ([string]::IsNullOrWhiteSpace($requiredConfirmation)) {
        $requiredConfirmation = [string]$plan.requiredConfirmation
    }
    Assert-True (![string]::IsNullOrWhiteSpace($requiredConfirmation)) `
        "Restore plan does not contain RequiredConfirmation."
    $confirmationFile = Join-Path $artifactsRoot "Подтверждение восстановления.txt"
    $preRestoreBackupRoot = Join-Path $artifactsRoot "Резерв до восстановления"
    New-Item -ItemType Directory -Force -Path $preRestoreBackupRoot | Out-Null

    $generationBeforeRejectedRestore = (Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()
    $databaseBeforeRejectedRestore = Join-Path `
        (Join-Path (Join-Path $DataRoot "generations") $generationBeforeRejectedRestore) `
        "app.db"
    $hashBeforeRejectedRestore = (Get-FileHash `
        -LiteralPath $databaseBeforeRejectedRestore -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($confirmationFile, "incorrect confirmation", $utf8NoBom)
    $rejected = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--execute-full-restore=$restorePlan",
            "--confirmation-file=$confirmationFile",
            "--pre-restore-backup-root=$preRestoreBackupRoot") `
        -WorkingDirectory $PackageRoot `
        -Name "reject incorrect full restore confirmation" `
        -ExpectedExitCode 1
    Assert-True `
        (($rejected.Stdout + $rejected.Stderr).IndexOf(
            "TECHMAP_STORAGE_FULL_RESTORE_STATUS=ok", [StringComparison]::Ordinal) -lt 0) `
        "Rejected full restore printed a false success marker."
    Assert-Equal ((Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()) `
        $generationBeforeRejectedRestore "Rejected full restore changed CURRENT."
    Assert-Equal `
        (Get-FileHash -LiteralPath $databaseBeforeRejectedRestore -Algorithm SHA256).Hash.ToLowerInvariant() `
        $hashBeforeRejectedRestore "Rejected full restore changed the live database."

    [IO.File]::WriteAllText($confirmationFile, $requiredConfirmation, $utf8NoBom)

    $execute = Invoke-TechmapCommand `
        -ExecutablePath $executable `
        -Arguments @(
            "--data-root=$DataRoot",
            "--execute-full-restore=$restorePlan",
            "--confirmation-file=$confirmationFile",
            "--pre-restore-backup-root=$preRestoreBackupRoot") `
        -WorkingDirectory $PackageRoot `
        -Name "execute packaged full restore"
    Assert-Equal (Get-OutputValue $execute.Stdout "TECHMAP_STORAGE_FULL_RESTORE_STATUS") "ok" `
        "Packaged full restore failed."
    $restoredGeneration = Get-OutputValue $execute.Stdout `
        "TECHMAP_STORAGE_FULL_RESTORE_RESTORED_GENERATION"
    Assert-Equal ((Get-Content -Raw -LiteralPath (Join-Path $DataRoot "CURRENT")).Trim()) `
        $restoredGeneration `
        "Full restore output does not match CURRENT."
    $preRestoreBackups = @(Get-ChildItem -LiteralPath $preRestoreBackupRoot -Directory -Filter "backup-*")
    Assert-Equal $preRestoreBackups.Count 1 `
        "Full restore did not publish exactly one mandatory pre-restore backup."
    $preRestoreBackup = $preRestoreBackups[0].FullName
    Assert-True (Test-Path -LiteralPath $preRestoreBackup -PathType Container) `
        "Full restore did not publish its mandatory pre-restore backup."
    Assert-Equal `
        ((Get-Content -Raw -LiteralPath (Join-Path $preRestoreBackup "manifest.json") | ConvertFrom-Json).kind) `
        "pre-restore" `
        "Mandatory backup has the wrong kind."
    $preRestoreManifestSha256 = (Get-FileHash `
        -LiteralPath (Join-Path $preRestoreBackup "manifest.json") `
        -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Equal `
        ((Get-Content -Raw -LiteralPath (Join-Path $preRestoreBackup "manifest.sha256")).Trim()) `
        $preRestoreManifestSha256 `
        "Mandatory pre-restore backup has an invalid detached manifest checksum."

    $restoredHost = Start-TechmapHost `
        -ExecutablePath $executable `
        -PackageRoot $PackageRoot `
        -DataRoot $DataRoot `
        -BackupRoot $BackupRoot `
        -Name "post-full-restore host"
    try {
        $restoredSession = New-ProtectedApiSession $restoredHost.Origin
        $restoredList = Invoke-RestMethod `
            -WebSession $restoredSession.WebSession `
            -Method Get `
            -Uri "$($restoredHost.Origin)/api/v1/projects" `
            -TimeoutSec 10
        Assert-Equal @($restoredList.projects).Count $ExpectedProjects.Count `
            "Full restore does not contain every backed-up project."
        foreach ($expected in $ExpectedProjects) {
            $restored = Get-Project $restoredHost.Origin $restoredSession $expected.projectId
            Assert-ProjectIdentity -Actual $restored -Expected $expected
            $actualDocumentIds = Assert-HarnessDocuments -Project $restored -ExpectedQuantities @(
                [long]$expected.harnesses[0].quantity,
                [long]$expected.harnesses[1].quantity)
            Assert-Equal (@($actualDocumentIds | Sort-Object) -join ",") `
                (@($expected.harnesses.documents.documentId | Sort-Object) -join ",") `
                "Full restore changed harness document UUIDs."
        }
    } finally {
        Stop-CapturedProcess $restoredHost.Launch
    }

    return [pscustomobject]@{
        BackupPath = $backupPath
        DryRunRecoveryRoot = $recoveryRoot
        RestoreGeneration = $restoredGeneration
        PreRestoreBackup = $preRestoreBackup
    }
}

Initialize-M115Artifacts

Push-Location $repositoryRoot
try {
    dotnet test tests/Techmap.Domain.Tests/Techmap.Domain.Tests.csproj `
        --configuration Release --no-restore -- `
        --filter-method "*Ex01_*" --filter-method "*Ex02_*" --filter-method "*Ex03_*" `
        --minimum-expected-tests 4
    if ($LASTEXITCODE -ne 0) {
        throw "M1-15 exact EX-01-03 tests failed with code $LASTEXITCODE."
    }

    if (!$SkipBuild) {
        & (Join-Path $PSScriptRoot "build-package.ps1") -Configuration Release | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "M1-15 package build failed with code $LASTEXITCODE."
        }
    }
} finally {
    Pop-Location
}

$PreviousArchive = if ([string]::IsNullOrWhiteSpace($PreviousArchive)) {
    if ([string]::IsNullOrWhiteSpace($PreviousArchiveSha256)) {
        $PreviousArchiveSha256 = $defaultPreviousArchiveSha256
    }
    $defaultPreviousArchive
} else {
    if ([string]::IsNullOrWhiteSpace($PreviousArchiveSha256)) {
        throw "-PreviousArchiveSha256 is required with an explicit -PreviousArchive."
    }
    $PreviousArchive
}
$CurrentArchive = if ([string]::IsNullOrWhiteSpace($CurrentArchive)) {
    $defaultCurrentArchive
} else { $CurrentArchive }
$previousArchivePath = Resolve-RequiredFile $PreviousArchive "M1-13 checkpoint archive"
$currentArchivePath = Resolve-RequiredFile $CurrentArchive "Current package archive"
$actualPreviousArchiveSha256 = (Get-FileHash `
    -LiteralPath $previousArchivePath `
    -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Equal $actualPreviousArchiveSha256 $PreviousArchiveSha256.ToLowerInvariant() `
    "M1-13 checkpoint archive SHA-256 mismatch."

$archiveBytes = (Get-Item -LiteralPath $currentArchivePath).Length
Assert-True ($archiveBytes -le 75MB) "M1 ZIP budget exceeded: $archiveBytes bytes."
$previousPackage = Expand-TechmapArchive `
    -ArchivePath $previousArchivePath `
    -Destination (Join-Path $artifactsRoot "Предыдущая программа M1-13")
$currentPackage = Expand-TechmapArchive `
    -ArchivePath $currentArchivePath `
    -Destination (Join-Path $artifactsRoot "Текущая программа с пробелом")
$previousVersion = Get-PackageVersion `
    -PackageRoot $previousPackage -ExpectedSchema 4 -Description "Previous package"
$currentVersion = Get-PackageVersion `
    -PackageRoot $currentPackage -ExpectedSchema 6 -Description "Current package"
Assert-Equal ([string]$previousVersion.appVersion) "0.1.0-m1.13" `
    "The update fixture is not the accepted M1-13 package."
Assert-Equal ([string]$currentVersion.appVersion) "0.1.0-m1.15" `
    "The current package does not identify the M1-15 acceptance build."
$packageBytes = (Get-ChildItem -LiteralPath $currentPackage -Recurse -File |
    Measure-Object -Property Length -Sum).Sum
Assert-True ($packageBytes -le 200MB) "M1 unpacked budget exceeded: $packageBytes bytes."
$currentExecutable = Join-Path $currentPackage "Techmap.Server.exe"
Test-SameSizeCorruption `
    -ArchivePath $currentArchivePath `
    -PackageRoot $currentPackage `
    -ExecutablePath $currentExecutable

if (!$SkipPortableTest) {
    & (Join-Path $PSScriptRoot "test-portable-package.ps1") `
        -ArchivePath $currentArchivePath `
        -ArtifactsRoot (Join-Path $artifactsRoot "p") | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "M1-15 portable package test failed with code $LASTEXITCODE."
    }
}

$dataRoot = Join-Path $artifactsRoot "Внешние данные проекта"
$backupRoot = Join-Path $artifactsRoot "Резервные копии обновления"
$exportPath = Join-Path $artifactsRoot "Экспорт предыдущей программы.techmap-project.zip"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$previousProject = Invoke-PreviousPackageScenario `
    -PackageRoot $previousPackage `
    -DataRoot $dataRoot `
    -BackupRoot $backupRoot `
    -ExportPath $exportPath
$previousExecutableHash = (Get-FileHash `
    -LiteralPath (Join-Path $previousPackage "Techmap.Server.exe") `
    -Algorithm SHA256).Hash
$currentExecutableHash = (Get-FileHash -LiteralPath $currentExecutable -Algorithm SHA256).Hash
Assert-True ($previousExecutableHash -ne $currentExecutableHash) `
    "Previous and current packages contain the same executable; update was not exercised."

$migration = Assert-MigrationAndRestart `
    -PackageRoot $currentPackage `
    -DataRoot $dataRoot `
    -BackupRoot $backupRoot `
    -PreviousProject $previousProject `
    -PreviousAppVersion $previousVersion.appVersion `
    -CurrentAppVersion $currentVersion.appVersion
Assert-True ($migration.SchemaVersion -gt 4) `
    "Current package did not migrate the M1-13 schema 4 data root."
$import = Assert-ImportedCopy `
    -PackageRoot $currentPackage `
    -DataRoot $dataRoot `
    -BackupRoot $backupRoot `
    -ExportPath $exportPath `
    -OriginalProject $migration.Project

$restore = $null
if (!$SkipPackagedRestore) {
    $restore = Invoke-PackagedRestoreAcceptance `
        -PackageRoot $currentPackage `
        -DataRoot $dataRoot `
        -BackupRoot $backupRoot `
        -ExpectedProjects @($import.SourceProject, $import.ImportedProject)
}

[pscustomobject]@{
    Status = if ($SkipPackagedRestore) { "partial" } else { "ok" }
    PreviousArchive = $previousArchivePath
    CurrentArchive = $currentArchivePath
    ArchiveMiB = [math]::Round($archiveBytes / 1MB, 2)
    PackageMiB = [math]::Round($packageBytes / 1MB, 2)
    MigratedSchema = $migration.SchemaVersion
    PreUpdateBackups = $migration.PreUpdateBackups
    ImportedProjectId = $import.ImportedProjectId
    RestoreGeneration = if ($null -eq $restore) { $null } else { $restore.RestoreGeneration }
    PackagedRestore = !$SkipPackagedRestore
}

