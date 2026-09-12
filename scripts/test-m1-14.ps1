$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    dotnet build Techmap-Grapher.slnx --configuration Release --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "M1-14 Release build failed with code $LASTEXITCODE."
    }

    dotnet test tests/Techmap.Web.Tests/Techmap.Web.Tests.csproj `
        --configuration Release --no-restore --no-build `
        --filter "FullyQualifiedName~ProjectImportIntegrationTests|FullyQualifiedName~ServerOptionsTests|FullyQualifiedName~StorageMigrationIntegrationTests|FullyQualifiedName~ProjectExportIntegrationTests|FullyQualifiedName~StorageBackupIntegrationTests|FullyQualifiedName~StorageRestoreIntegrationTests"
    if ($LASTEXITCODE -ne 0) {
        throw "M1-14 focused tests failed with code $LASTEXITCODE."
    }

    dotnet test Techmap-Grapher.slnx --configuration Release --no-restore --no-build
    if ($LASTEXITCODE -ne 0) {
        throw "M1-14 full .NET tests failed with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
