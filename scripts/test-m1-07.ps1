$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "test-m1-06.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "M1-07 verification failed with code $LASTEXITCODE."
}
