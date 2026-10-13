$ErrorActionPreference='Stop'
$count=0
foreach($name in @('Trace-WordWidthRestore.ps1','Set-WordWidthOriginFixture.ps1','Export-WordTableWidthFixture.ps1')){
    $errors=$null;$tokens=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'FIXTURE_PARSE_FAILED'}
    $loops=$ast.FindAll({param($node)$node -is [System.Management.Automation.Language.ForStatementAst]},$true)
    foreach($loop in $loops){if($loop.Condition -and -not $loop.Iterator){throw ('CONDITIONAL_FIXTURE_LOOP_MISSING_ITERATOR: '+$name+':'+$loop.Extent.StartLineNumber)};$count++}
}
@{scripts=3;boundedLoops=$count}|ConvertTo-Json -Compress
