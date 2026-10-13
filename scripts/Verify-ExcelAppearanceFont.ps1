$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/excel-range-format.ps1')
$null=Assert-ExcelAppearanceFont ([pscustomobject]@{Bold=$false;Italic=$false;Color=0;Size=11})
foreach($key in @('Bold','Italic','Color','Size')){foreach($value in @($null,[DBNull]::Value)){
    $font=[pscustomobject]@{Bold=$false;Italic=$false;Color=0;Size=11};$font.$key=$value;$refused=$false
    try{$null=Assert-ExcelAppearanceFont $font}catch{if($_.Exception.Message -ne 'EXCEL_FORMAT_COMPLEX_CELL'){throw};$refused=$true}
    if(-not $refused){throw 'Mixed cell font was accepted.'}
}}
if((Convert-ExcelAppearanceRgb '#0E7490') -ne 9466894){throw 'RGB conversion mismatch.'}
'EXCEL_APPEARANCE_FONT=PASS'
