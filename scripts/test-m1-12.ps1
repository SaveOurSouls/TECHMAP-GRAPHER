$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "test-m1-11.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "M1-12 prerequisite verification failed with code $LASTEXITCODE."
}

$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    dotnet build Techmap-Grapher.slnx --configuration Release --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "M1-12 Release build failed with code $LASTEXITCODE."
    }

    dotnet test tests/Techmap.Web.Tests/Techmap.Web.Tests.csproj `
        --configuration Release --no-restore --no-build `
        --filter "FullyQualifiedName~StorageMigrationIntegrationTests|FullyQualifiedName~StorageBackupPolicyTests|FullyQualifiedName~SqliteStorageIntegrationTests|FullyQualifiedName~ServerOptionsTests"
    if ($LASTEXITCODE -ne 0) {
        throw "M1-12 focused tests failed with code $LASTEXITCODE."
    }

    dotnet test Techmap-Grapher.slnx --configuration Release --no-restore --no-build
    if ($LASTEXITCODE -ne 0) {
        throw "M1-12 full .NET tests failed with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
