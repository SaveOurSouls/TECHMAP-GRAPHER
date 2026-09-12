$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "test-m1-01.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "M1-03 verification failed with code $LASTEXITCODE."
}
