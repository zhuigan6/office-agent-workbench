$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/discovery.ps1')
function Hash-Text([string]$value){return $value}
$one=@{kind='excel';location='C:\same.xlsx';instanceId='1:100';identity='object1'}
$two=@{kind='excel';location='C:\same.xlsx';instanceId='2:200';identity='object2'}
if((Get-OfficeDocumentKey $one $false) -cne 'excel|C:\same.xlsx'){throw 'Unambiguous legacy ID was changed.'}
if((Get-OfficeDocumentKey $one $true) -ceq (Get-OfficeDocumentKey $two $true)){throw 'Independent instances collapsed.'}
$first=Get-OfficeDocumentKey $one $true;$one.identity='new-wrapper'
if((Get-OfficeDocumentKey $one $true) -cne $first){throw 'COM wrapper identity changed the instance key.'}
'NATIVE_DISCOVERY_KEYS=PASS'
