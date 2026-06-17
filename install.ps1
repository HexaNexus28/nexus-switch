param(
    [string]$InstallDir = "$HOME\.nexus-switch",
    [switch]$NoProfile
)

$ErrorActionPreference = "Stop"
$SourceDir = $PSScriptRoot
$CorePath = Join-Path $InstallDir "src\NexusSwitch.ps1"
$ProfileLine = ". `"$CorePath`""

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $SourceDir "src") -Destination $InstallDir -Recurse -Force
Copy-Item -Path (Join-Path $SourceDir "providers") -Destination $InstallDir -Recurse -Force
Copy-Item -Path (Join-Path $SourceDir "litellm") -Destination $InstallDir -Recurse -Force

if (-not $NoProfile) {
    $profileDir = Split-Path -Parent $PROFILE
    if ($profileDir) { New-Item -ItemType Directory -Force -Path $profileDir | Out-Null }
    if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Force -Path $PROFILE | Out-Null }
    $content = Get-Content $PROFILE -Raw
    if ($content -notmatch [regex]::Escape($CorePath)) {
        Add-Content -Path $PROFILE -Value ""
        Add-Content -Path $PROFILE -Value "# Nexus Switch"
        Add-Content -Path $PROFILE -Value $ProfileLine
    }
}

Write-Host "Nexus Switch installed in $InstallDir" -ForegroundColor Green
Write-Host "Reload your shell: . `$PROFILE" -ForegroundColor Cyan
Write-Host "Then run: nexus doctor" -ForegroundColor Cyan
