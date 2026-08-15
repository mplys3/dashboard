[CmdletBinding()]
param(
    [string]$DashboardUrl = "http://192.168.0.120:8088/"
)

$ErrorActionPreference = "Stop"
$uri = $null
if (-not [Uri]::TryCreate($DashboardUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @("http", "https")) {
    throw "DashboardUrl skal være en gyldig http- eller https-adresse."
}

$settingsDirectory = Join-Path $env:LOCALAPPDATA "HaDashboardWidget"
New-Item -ItemType Directory -Force -Path $settingsDirectory | Out-Null
@{ dashboardUrl = $uri.AbsoluteUri } |
    ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $settingsDirectory "settings.json") -Encoding utf8

$package = Get-ChildItem -Path (Join-Path $PSScriptRoot "AppPackages") -Recurse -Filter "*.msix" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $package) {
    throw "Ingen MSIX-pakke fundet. Kør først .\build.ps1."
}

Add-AppxPackage -Path $package.FullName -ForceApplicationShutdown -AllowUnsigned
Write-Host "HA Dashboard Widget er installeret. Åbn Widget-området med Win+W og vælg 'Mit hjem'."
