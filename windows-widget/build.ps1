[CmdletBinding()]
param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$dotnetRoot = Join-Path $env:LOCALAPPDATA "HaDashboardWidget\dotnet"
$dotnetExe = Join-Path $dotnetRoot "dotnet.exe"
$certificateDirectory = Join-Path $env:LOCALAPPDATA "HaDashboardWidget\certificate"
$certificatePath = Join-Path $certificateDirectory "HaDashboardWidget.pfx"
$publicCertificatePath = Join-Path $certificateDirectory "HaDashboardWidget.cer"
$certificatePassword = "HaDashboardWidget-LocalBuild"

if (-not (Test-Path -LiteralPath $dotnetExe)) {
    New-Item -ItemType Directory -Force -Path $dotnetRoot | Out-Null
    $installScript = Join-Path ([System.IO.Path]::GetTempPath()) "ha-dashboard-dotnet-install.ps1"
    Invoke-WebRequest "https://dot.net/v1/dotnet-install.ps1" -OutFile $installScript
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installScript -Channel 8.0 -InstallDir $dotnetRoot
}

$certificate = Get-ChildItem "Cert:\CurrentUser\My" |
    Where-Object { $_.Subject -eq "CN=HA Dashboard Widget" -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

if (-not $certificate) {
    New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null
    $securePassword = ConvertTo-SecureString $certificatePassword -AsPlainText -Force
    if (Test-Path -LiteralPath $certificatePath) {
        $certificate = (PKI\Import-PfxCertificate `
            -FilePath $certificatePath `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -Password $securePassword)[0]
    } else {
        $certificate = PKI\New-SelfSignedCertificate `
            -Type Custom `
            -Subject "CN=HA Dashboard Widget" `
            -FriendlyName "HA Dashboard Widget local package" `
            -KeyUsage DigitalSignature `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
        PKI\Export-PfxCertificate -Cert $certificate -FilePath $certificatePath -Password $securePassword | Out-Null
        PKI\Export-Certificate -Cert $certificate -FilePath $publicCertificatePath | Out-Null
    }
}

& $dotnetExe restore (Join-Path $projectRoot "HaDashboardWidget.csproj") `
    --source "https://api.nuget.org/v3/index.json"
& $dotnetExe publish (Join-Path $projectRoot "HaDashboardWidget.csproj") `
    --configuration $Configuration `
    --runtime win-x64 `
    --no-restore `
    -p:GenerateAppxPackageOnBuild=true `
    -p:AppxPackageSigningEnabled=true `
    -p:PackageCertificateThumbprint="$($certificate.Thumbprint)"

if ($LASTEXITCODE -ne 0) {
    throw "Widgetpakken kunne ikke bygges."
}
