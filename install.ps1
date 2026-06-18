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
    # Cible les profils CurrentUserAllHosts (profile.ps1) des deux editions :
    # AllHosts -> charge dans tous les hotes (console, VS Code, ISE, Windows Terminal).
    # Les deux dossiers -> couvre Windows PowerShell 5.1 ET PowerShell 7.
    $docs = [Environment]::GetFolderPath("MyDocuments")
    $targets = @(
        (Join-Path $docs "WindowsPowerShell\profile.ps1")  # PS 5.1
        (Join-Path $docs "PowerShell\profile.ps1")         # PS 7+
    )
    foreach ($target in $targets) {
        $dir = Split-Path -Parent $target
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        if (-not (Test-Path $target)) { New-Item -ItemType File -Force -Path $target | Out-Null }
        $content = Get-Content $target -Raw
        if ($content -notmatch [regex]::Escape($CorePath)) {
            Add-Content -Path $target -Value "`n# Nexus Switch`n$ProfileLine"
            Write-Host "Profil mis a jour : $target" -ForegroundColor DarkGray
        }
    }
}

Write-Host "Nexus Switch installed in $InstallDir" -ForegroundColor Green
Write-Host "Reload your shell: . `$PROFILE" -ForegroundColor Cyan
Write-Host "Then run: nexus doctor" -ForegroundColor Cyan
