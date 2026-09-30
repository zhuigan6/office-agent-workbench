$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/selection.ps1')
$one=[pscustomobject]@{Name='one'};$two=[pscustomobject]@{Name='two'}
$first=Get-OfficeWindowIdentity 'powerpoint' $one
if($first -notlike 'ppt-*' -or (Get-OfficeWindowIdentity 'powerpoint' $one) -cne $first){throw 'PPT identity is not stable.'}
if((Get-OfficeWindowIdentity 'powerpoint' $two) -ceq $first){throw 'Distinct windows share an identity.'}
foreach($bad in @('',0,$null)){
    $blocked=$false
    try{$null=Get-OfficeWindowIdentity 'word' ([pscustomobject]@{Hwnd=$bad})}catch{$blocked=$true}
    if(-not $blocked){throw 'Missing HWND was accepted.'}
}
if((Get-OfficeWindowIdentity 'excel' ([pscustomobject]@{Hwnd=123})) -cne '123'){throw 'Excel HWND mismatch.'}
for($i=$script:pptWindowIdentities.Count;$i -lt 200;$i++){$script:pptWindowIdentities['reserved'+$i]=@{value='reserved';reference=$one}}
$bounded=$false
try{$null=Get-OfficeWindowIdentity 'powerpoint' ([pscustomobject]@{Name='new'})}catch{$bounded=$true}
if(-not $bounded){throw 'COM identity cache has no bound.'}
'NATIVE_WINDOW_IDENTITIES=PASS'
