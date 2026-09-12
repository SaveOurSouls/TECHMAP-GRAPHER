$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "test-m1-07.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "M1-08 verification failed with code $LASTEXITCODE."
}
