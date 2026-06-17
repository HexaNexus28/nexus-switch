param(
    [string]$InstallDir = "$HOME\.nexus-switch"
)

$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "install.ps1") -InstallDir $InstallDir -NoProfile
Write-Host "Nexus Switch updated in $InstallDir" -ForegroundColor Green
