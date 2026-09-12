$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "test-m1-08.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "M1-09 verification failed with code $LASTEXITCODE."
}
