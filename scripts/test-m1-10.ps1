$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "test-m1-09.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "M1-10 verification failed with code $LASTEXITCODE."
}
