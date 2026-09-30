# Create private development configuration and a user-scoped localhost certificate.
[CmdletBinding()]
param(
    [string]$AionCore,
    [string]$OfficeCli,
    [ValidateRange(1024,65534)][int]$Port = 18443,
    [ValidateRange(0,65535)][int]$CorePort = 0
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$local = Join-Path $root '.local'
$configPath = Join-Path $local 'config.json'
if (Test-Path -LiteralPath $configPath) { throw 'Configuration exists. Inspect it before changing configuration.' }
if (-not $AionCore) { $AionCore = Join-Path $root 'runtime\aioncore\aioncore.exe' }
if (-not $OfficeCli) { $OfficeCli = Join-Path $root 'runtime\officecli\officecli.exe' }
if ($CorePort -eq 0) { $CorePort = $Port + 1 }
if ($CorePort -eq $Port) { throw 'Host and core ports must differ.' }
$corePath = (Resolve-Path -LiteralPath $AionCore).Path
$cliPath = (Resolve-Path -LiteralPath $OfficeCli).Path
$lock = Get-Content -LiteralPath (Join-Path $root 'upstreams.lock.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $cliPath -Algorithm SHA256).Hash -ne $lock.officecli.binarySha256) { throw 'OfficeCLI hash differs from lock file.' }
if ($lock.aioncore.binarySha256 -and (Get-FileHash -LiteralPath $corePath -Algorithm SHA256).Hash -ne $lock.aioncore.binarySha256) { throw 'AionCore hash differs from lock file.' }
$listener = Get-NetTCPConnection -LocalPort $Port,$CorePort -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw 'Chosen port is occupied.' }
New-Item -ItemType Directory -Path $local -Force | Out-Null
& (Join-Path $PSScriptRoot 'Protect-Data.ps1')
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-RandomToken {
    $buffer = [byte[]]::new(32)
    $random.GetBytes($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$pfxPassword = New-RandomToken
$cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -FriendlyName 'Office Agent Workbench localhost development' -NotAfter (Get-Date).AddMonths(3) -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable
$pfxPath = Join-Path $local 'server.pfx'
$cerPath = Join-Path $local 'server.cer'
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
$config = [ordered]@{
    port=$Port; aioncore=$corePath; officecli=$cliPath;
    certificateThumbprint=$cert.Thumbprint; pfxPassword=$pfxPassword;
    uiToken=(New-RandomToken); coreSecret=(New-RandomToken);
    corePort=$CorePort; connectionSource='ccswitch'; gatewayUrl='http://127.0.0.1:8787';
    model='claude-ccswitch-default'
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$random.Dispose()
Write-Output "Private configuration created: $configPath"
Write-Output "Certificate thumbprint: $($cert.Thumbprint)"
Write-Output "Workbench URL: https://localhost:$Port"
