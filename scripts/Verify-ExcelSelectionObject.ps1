$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../packages/native-office/selection.ps1')
Add-Type -TypeDefinition @'
using System.Collections;
public class MockSelectionAreas { public int Count {get{return 1;}} }
public class MockSelectionSheet { public string Name {get{return "Sheet1";}} }
public class MockExcelSelection : IEnumerable {
 public MockSelectionAreas Areas {get{return new MockSelectionAreas();}}
 public MockSelectionSheet Worksheet {get{return new MockSelectionSheet();}}
 public string Address(bool a,bool b){return "A1:C3";}
 public IEnumerator GetEnumerator(){return new object[]{1,2,3,4,5,6,7,8,9}.GetEnumerator();}
}
'@
function Read-Range($entry,$data){return @{sheetName='Sheet1';address=$data.range;values=@(@(1,2,3));formulas=@(@(1,2,3));numberFormat=@(@('General','General','General'))}}
function Hash-Text($value){return ('a'*64)}
function Add-ExcelTableReference($entry,$selected){return $selected}
$doc=[pscustomobject]@{FullName='dedicated.xlsx'};$app=[pscustomobject]@{ActiveWorkbook=$doc;ActiveWindow=[pscustomobject]@{Hwnd=123};Selection=[MockExcelSelection]::new()}
$script:session='test'
$captured=Capture-OfficeSelection @{kind='excel';doc=$doc;app=$app}
if($captured.range -cne 'A1:C3' -or $captured.kind -cne 'excel' -or $captured.hostSessionId -cne 'test:123'){throw 'MULTICELL_RANGE_ENUMERATED'}
'EXCEL_MULTICELL_OBJECT=PASS'
