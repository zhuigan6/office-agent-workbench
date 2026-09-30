[CmdletBinding()]
param([switch]$Force)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Start-Service.ps1')
$root=Get-WorkbenchRoot
$config=Get-WorkbenchConfig $root
if ((Test-WorkbenchPort $config.port) -or (Test-WorkbenchPort $config.corePort)) {throw 'Stop Workbench with Stop-Service.ps1 before renewing the certificate.'}
$local=Join-Path $root '.local'
$old=[Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $local 'server.pfx'),$config.pfxPassword,[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
try { if (-not $Force -and $old.NotAfter -gt (Get-Date).AddDays(21)) {Write-Output 'Certificate is not near expiry; no changes made.';return} } finally {$old.Dispose()}
$backup=Join-Path $local ('certificate-before-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($name in @('config.json','server.pfx','server.cer')) {Copy-Item -LiteralPath (Join-Path $local $name) -Destination (Join-Path $backup $name)}
$cert=New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation 'Cert:\CurrentUser\My' -FriendlyName 'Office Agent Workbench localhost' -NotAfter (Get-Date).AddMonths(3) -KeyAlgorithm RSA -KeyLength 2048 -KeyExportPolicy Exportable
$pfx=Join-Path $backup 'replacement.pfx'
$cer=Join-Path $backup 'replacement.cer'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $config.pfxPassword -AsPlainText -Force) | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
Import-Certificate -FilePath $cer -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
try {
 Copy-Item -LiteralPath $pfx -Destination (Join-Path $local 'server.pfx') -Force
 Copy-Item -LiteralPath $cer -Destination (Join-Path $local 'server.cer') -Force
 $config.certificateThumbprint=$cert.Thumbprint
 [IO.File]::WriteAllText((Join-Path $local 'config.json'),($config | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
 Assert-WorkbenchPreflight $root $config
} catch {
 foreach ($name in @('config.json','server.pfx','server.cer')) {Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $local $name) -Force}
 throw 'Certificate renewal failed; original files restored. Inspect the private backup before retrying.'
}
Write-Output "Certificate renewed; UI/core credentials and chat data retained. Backup: $backup. Run Install-Service.ps1 to resume."
