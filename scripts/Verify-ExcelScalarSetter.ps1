$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/excel-values.ps1')
Add-Type -TypeDefinition @'
public class MockExcelScalar {
 public object Value2 {get;set;}
 public object Formula {get;set;}
 public bool ClearContents(){Value2=null;Formula=null;return true;}
}
'@
$cell=[MockExcelScalar]::new()
foreach($value in @('text',[double]12.5,$true,[long]-2,'second',$false,$null)){
    $output=@(Set-ExcelScalar $cell $value);if($output.Count){throw 'SETTER_EMITTED_OUTPUT'}
    if($null -eq $value){if($null -ne $cell.Value2){throw 'NULL_NOT_CLEARED'}}
    elseif($value -is [bool]){if($cell.Value2 -isnot [bool] -or $cell.Value2 -ne $value){throw 'BOOL_CHANGED'}}
    elseif($value -is [ValueType]){if($cell.Value2 -isnot [double] -or $cell.Value2 -ne $value){throw 'NUMBER_CHANGED'}}
    elseif($cell.Value2 -isnot [string] -or $cell.Value2 -cne $value){throw 'TEXT_CHANGED'}
}
Set-ExcelScalar $cell '=1+1' $true;if($cell.Formula -cne '=1+1'){throw 'FORMULA_CHANGED'}
Set-ExcelScalar $cell ([long]12) $true;if($cell.Formula -isnot [double]){throw 'FORMULA_CONSTANT_CHANGED'}
'EXCEL_TYPED_SCALAR_SETTER=PASS'
