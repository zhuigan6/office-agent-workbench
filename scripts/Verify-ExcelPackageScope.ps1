$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/excel-table-package.ps1')
foreach($case in @(@{cell='Y1';range='Z1:AB3';inside=$false},@{cell='Z1';range='Z1:AB3';inside=$true},@{cell='AA2';range='Z1:AB3';inside=$true},@{cell='AB3';range='Z1:AB3';inside=$true},@{cell='AC3';range='Z1:AB3';inside=$false},@{cell='AA4';range='Z1:AB3';inside=$false})){
    if((Test-ExcelPackageCellInRange $case.cell $case.range) -ne $case.inside){throw 'Formula exclusion exceeded the intended tail range.'}
}
'EXCEL_PACKAGE_SCOPE=PASS'
