param(
    [string]$InstallDir = "$HOME\.nexus-switch",
    [switch]$KeepConfig
)

$CorePath = Join-Path $InstallDir "src\NexusSwitch.ps1"
if (Test-Path $PROFILE) {
    $lines = Get-Content $PROFILE
    $filtered = $lines | Where-Object { $_ -notmatch [regex]::Escape($CorePath) -and $_ -ne "# Nexus Switch" }
    Set-Content -Path $PROFILE -Value $filtered -Encoding UTF8
}

if (-not $KeepConfig -and (Test-Path $InstallDir)) {
    Remove-Item $InstallDir -Recurse -Force
}

Write-Host "Nexus Switch uninstalled" -ForegroundColor Yellow
