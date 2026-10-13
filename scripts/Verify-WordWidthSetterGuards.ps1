$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent;$assignments=0;$writer=$null
foreach($name in @('word-table-widths.ps1','word-table-layout.ps1')){
    $errors=$null;$tokens=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root ('packages/native-office/'+$name)),[ref]$tokens,[ref]$errors)
    if($errors.Count){throw 'WIDTH_MODULE_PARSE_FAILED'}
    foreach($setter in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$table.Rows.Alignment'},$true)){
        $parent=$setter.Parent
        while($parent -and $parent -isnot [System.Management.Automation.Language.IfStatementAst]){$parent=$parent.Parent}
        if(-not $parent -or -not @($parent.Clauses|Where-Object {$_.Item1.Extent.Text -match '\$table\.Rows\.Alignment\s+-ne'}).Count){throw 'UNCHANGED_ALIGNMENT_WRITE_NOT_GUARDED'}
        $assignments++
    }
    if($name -eq 'word-table-layout.ps1'){$writer=$ast.Find({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-WordTableLayout'},$true)}
}
$writes=@($writer.Body.FindAll({param($node)$node -is [System.Management.Automation.Language.ForEachStatementAst] -and $node.Body.Extent.Text.Contains('$table.$p=[double]$wanted[$field]')},$true))
$widthCall=@($writer.Body.FindAll({param($node)$node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Set-WordTableWidths'},$true))
if($assignments -ne 3 -or $writes.Count -ne 1 -or $widthCall.Count -ne 1 -or $widthCall[0].Extent.StartOffset -le $writes[0].Extent.EndOffset){throw 'WIDTH_RESTORE_MUST_FOLLOW_LAYOUT_SETTERS'}
@{unchangedAlignmentGuards=$assignments;widthPlanLast=$true}|ConvertTo-Json -Compress
