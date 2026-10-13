# Line-oriented STA worker. Attaches only to already-running Office applications.
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$script:documents=@{}
$script:session=[Guid]::NewGuid().ToString()
. (Join-Path $PSScriptRoot 'fingerprint.ps1')
. (Join-Path $PSScriptRoot 'selection.ps1')
. (Join-Path $PSScriptRoot 'word-readonly.ps1')
. (Join-Path $PSScriptRoot 'word-tables.ps1')
. (Join-Path $PSScriptRoot 'excel-tables.ps1')
. (Join-Path $PSScriptRoot 'excel-charts.ps1')
. (Join-Path $PSScriptRoot 'excel-chart-package.ps1')
. (Join-Path $PSScriptRoot 'excel-chart-format.ps1')
. (Join-Path $PSScriptRoot 'excel-chart-create.ps1')
. (Join-Path $PSScriptRoot 'excel-table-rows.ps1')
. (Join-Path $PSScriptRoot 'excel-table-package.ps1')
. (Join-Path $PSScriptRoot 'excel-profile-restore.ps1')
. (Join-Path $PSScriptRoot 'excel-table-create.ps1')
. (Join-Path $PSScriptRoot 'excel-table-columns.ps1')
. (Join-Path $PSScriptRoot 'excel-values.ps1')
. (Join-Path $PSScriptRoot 'excel-range-format.ps1')
. (Join-Path $PSScriptRoot 'word-table-layout.ps1')
. (Join-Path $PSScriptRoot 'word-table-widths.ps1')
. (Join-Path $PSScriptRoot 'word-table-borders.ps1')
. (Join-Path $PSScriptRoot 'word-table-rows.ps1')
. (Join-Path $PSScriptRoot 'word-format.ps1')
. (Join-Path $PSScriptRoot 'word-replace.ps1')
. (Join-Path $PSScriptRoot 'word-paragraph-batch.ps1')
. (Join-Path $PSScriptRoot 'ppt-format.ps1')
. (Join-Path $PSScriptRoot 'ppt-font-runs.ps1')
. (Join-Path $PSScriptRoot 'ppt-layout.ps1')
. (Join-Path $PSScriptRoot 'ppt-appearance.ps1')
. (Join-Path $PSScriptRoot 'ppt-replace.ps1')
. (Join-Path $PSScriptRoot 'ppt-rich-format.ps1')
. (Join-Path $PSScriptRoot 'ppt-paragraph.ps1')
. (Join-Path $PSScriptRoot 'ppt-lists.ps1')
. (Join-Path $PSScriptRoot 'ppt-text-frame.ps1')
. (Join-Path $PSScriptRoot 'ppt-frame-package.ps1')
. (Join-Path $PSScriptRoot 'discovery.ps1')
. (Join-Path $PSScriptRoot 'targets.ps1')
. (Join-Path $PSScriptRoot 'word-snapshot.ps1')
function Hash-Text([string]$value){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function Get-Documents {
    # Do not retain closed documents indefinitely in a long-lived COM worker.
    $script:documents=@{}
    $found=[Collections.Generic.List[object]]::new()
    $script:diagnostics=[Collections.Generic.List[object]]::new()
    $discovery=Get-OfficeDiscovery
    foreach($note in $discovery.diagnostics){$script:diagnostics.Add($note)}
    foreach($candidate in $discovery.items){
        try{
                $kind=$candidate.kind;$doc=$candidate.doc;$app=$candidate.app
                $location=$candidate.location;$name=$candidate.name
                $duplicates=@($discovery.items | Where-Object {$_.kind -eq $kind -and $_.location -ieq $location})
                $pathKey=$kind+'|'+$location
                if($duplicates.Count -gt 1 -or $discovery.partial){$script:ambiguousOfficePaths[$pathKey]=$true}
                $ambiguous=$script:ambiguousOfficePaths.ContainsKey($pathKey)
                $key=Get-OfficeDocumentKey $candidate $ambiguous
                if($ambiguous){$script:diagnostics.Add(@{kind=$kind;message='DOCUMENT_ID_REQUIRES_INSTANCE_BINDING';name=$name})}
                $script:documents[$key]=@{kind=$kind;doc=$doc;app=$app;location=$location}
                $caps=if($kind -eq 'excel'){@('read','write','snapshot')}else{@('readText','writeText','snapshot')}
                $writeRestriction=if($kind -eq 'word'){Get-WordWriteRestriction $doc}elseif([bool]$doc.ReadOnly){'native-readonly'}else{$null}
                if($writeRestriction){$caps=@($caps | Where-Object {$_ -notin @('write','writeText')})}
                $windowIds=@(for($w=1;$w -le $doc.Windows.Count;$w++){Get-OfficeWindowIdentity $kind $doc.Windows.Item($w)})
                $processId=if($candidate.instanceId -notlike 'rot:*'){[int]($candidate.instanceId.Split(':')[0])}else{$null}
                $found.Add(@{id=$key;name=$name;kind=$kind;location=$location;capabilities=$caps;saved=[bool]$doc.Saved;sessionId=$script:session;windowIds=$windowIds;instanceId=$candidate.instanceId;processId=$processId;discoverySource=$candidate.source;writeRestriction=$writeRestriction})
        } catch { $script:diagnostics.Add(@{kind=$kind;message=$_.Exception.Message}) }
    }
    return ,$found.ToArray()
}
function Resolve-Document([string]$id){
    $live=@(Get-Documents)
    if(-not($live|Where-Object {$_.id -eq $id})){throw 'DOCUMENT_OFFLINE: The selected document is no longer open.'}
    return $script:documents[$id]
}
function Matrix-Of($value,[int]$rows,[int]$cols){
    $result=[Collections.Generic.List[object]]::new()
    for($r=0;$r -lt $rows;$r++){$row=[Collections.Generic.List[object]]::new();for($c=0;$c -lt $cols;$c++){
        $cell=if($rows -eq 1 -and $cols -eq 1){$value}else{$value.GetValue($r+1,$c+1)}
        if($null -eq $cell){$cell=''};$row.Add($cell)
    };$result.Add($row.ToArray())};return ,$result.ToArray()
}
function Read-Range($entry,$data){
    if($entry.kind -ne 'excel'){throw 'HOST_KIND: Excel is required.'}
    $sheet=$entry.doc.Worksheets.Item([string]$data.sheet);$range=$sheet.Range([string]$data.range)
    $rows=[int]$range.Rows.Count;$cols=[int]$range.Columns.Count
    if($rows*$cols -gt 1000){throw 'RANGE_LIMIT: At most 1000 cells.'}
    $formats=[Collections.Generic.List[object]]::new()
    for($r=1;$r -le $rows;$r++){$row=[Collections.Generic.List[object]]::new();for($c=1;$c -le $cols;$c++){$row.Add([string]$range.Cells.Item($r,$c).NumberFormat)};$formats.Add($row.ToArray())}
    return @{sheetId=[string]$sheet.Name;sheetName=[string]$sheet.Name;address=([string]$data.range).Replace('$','').ToUpperInvariant();values=(Matrix-Of $range.Value2 $rows $cols);formulas=(Matrix-Of $range.Formula $rows $cols);numberFormat=$formats.ToArray()}
}
function Text-Item($entry,$target){
    if($entry.kind -eq 'word'){
        $index=0;if(-not[int]::TryParse([string]$target.paragraphId,[ref]$index) -or $index -lt 1 -or $index -gt $entry.doc.Paragraphs.Count){throw 'TARGET_NOT_FOUND'}
        $paragraph=$entry.doc.Paragraphs.Item($index);$range=$paragraph.Range.Duplicate
        if($range.End -gt $range.Start){$range.End=$range.End-1}
        $text=[string]$range.Text;$xml=[string]$range.WordOpenXML
        $bodyHash=Hash-Text ([string]$entry.doc.Content.Text)
        $semantic=Get-WordSemanticXml $xml
        $fingerprint=Hash-Text ([string]$entry.doc.Paragraphs.Count+'|'+$range.Start+'|'+$bodyHash+'|'+$semantic)
        return @{target=@{kind='word';paragraphId=[string]$index};sessionId=$script:session;text=$text;contentHash=$fingerprint;semanticHash=(Hash-Text $semantic)}
    }
    $slide=$entry.doc.Slides.FindBySlideID([int]$target.slideId);$shape=$null
    for($i=1;$i -le $slide.Shapes.Count;$i++){if([string]$slide.Shapes.Item($i).Id -eq [string]$target.shapeId){$shape=$slide.Shapes.Item($i);break}}
    if($null -eq $shape -or $shape.HasTextFrame -eq 0){throw 'TARGET_NOT_FOUND'}
    $text=[string]$shape.TextFrame.TextRange.Text
    return @{target=@{kind='powerpoint';slideId=[string]$slide.SlideID;shapeId=[string]$shape.Id};sessionId=$script:session;text=$text;contentHash=(Hash-Text ($text+'|'+$shape.Left+'|'+$shape.Top+'|'+$shape.Width+'|'+$shape.Height))}
}
function Read-Text($entry,$data){
    $start=[int]$data.start;$count=if($data.count){[int]$data.count}else{20}
    if($start -lt 0 -or $count -lt 1 -or $count -gt 50){throw 'PAGE_LIMIT'}
    $items=[Collections.Generic.List[object]]::new();$sections=[Collections.Generic.List[object]]::new()
    if($entry.kind -eq 'word'){
        $total=$entry.doc.Paragraphs.Count
        for($i=$start+1;$i -le [Math]::Min($total,$start+$count);$i++){$items.Add((Text-Item $entry @{paragraphId=[string]$i}))}
        return @{kind='word';scope='paragraphs';start=$start;nextStart=$(if($start+$count -lt $total){$start+$count}else{$null});items=$items.ToArray()}
    }
    if($entry.kind -ne 'powerpoint'){throw 'HOST_KIND'}
    if(-not $data.slideId){
        $total=$entry.doc.Slides.Count
        for($i=$start+1;$i -le [Math]::Min($total,$start+$count);$i++){$slide=$entry.doc.Slides.Item($i);$sections.Add(@{id=[string]$slide.SlideID;name="Slide $i"})}
        return @{kind='powerpoint';scope='slides';start=$start;items=@();sections=$sections.ToArray()}
    }
    $slide=$entry.doc.Slides.FindBySlideID([int]$data.slideId)
    for($i=$start+1;$i -le [Math]::Min($slide.Shapes.Count,$start+$count);$i++){
        $shape=$slide.Shapes.Item($i)
        if($shape.HasTextFrame -ne 0 -and (-not $data.shapeId -or [string]$data.shapeId -eq [string]$shape.Id)){$items.Add((Text-Item $entry @{slideId=[string]$slide.SlideID;shapeId=[string]$shape.Id}))}
    }
    return @{kind='powerpoint';scope='shapes';start=$start;items=$items.ToArray()}
}
function Invoke-Office($request){
    if($request.method -eq 'discover'){$documents=Get-Documents;return @{documents=$documents;sessionId=$script:session;diagnostics=$script:diagnostics.ToArray()}}
    $entry=Resolve-Document ([string]$request.documentId);$data=$request.payload
    if($entry.kind -eq 'word' -and ([string]$request.method -like 'writeWord*' -or $request.method -eq 'writeText')){
        $restriction=Get-WordWriteRestriction $entry.doc
        if($restriction){return @{code='READ_ONLY';verified=$false;notIssued=$true;writeRestriction=$restriction;message='Word document/window is readonly, protected or unavailable.'}}
    }
    switch($request.method){
        'selection' {return Capture-OfficeSelection $entry}
        'target' {return Resolve-OfficeTarget $entry $data}
        'selectionIdentity' {return Assert-SelectionIdentity $entry $data}
        'readWordFormat' {return Read-WordFormat $entry $data.selection $data.fields $data.paragraphFields}
        'writeWordFormat' {return Write-WordFormat $entry $data}
        'readWordReplacement' {return Read-WordReplacement $entry $data.selection}
        'readWordTables' {return Read-WordTables $entry $data}
        'readExcelTables' {return Read-ExcelTables $entry $data}
        'readExcelTableCreate' {return Read-ExcelTableCreate $entry $data}
        'readExcelTablePackage' {return Read-ExcelTablePackage $entry $data.reference}
        'writeExcelTableCreate' {return Write-ExcelTableCreate $entry $data}
        'removeExcelCreatedTable' {return Remove-ExcelCreatedTable $entry $data}
        'readExcelRangeFormat' {return Read-ExcelRangeFormat $entry $data}
        'writeExcelRangeFormat' {return Write-ExcelRangeFormat $entry $data}
        'readExcelSheets' {return Read-ExcelSheets $entry $data}
        'readExcelCharts' {return Read-ExcelCharts $entry $data}
        'readExcelChart' {if($data.reference.formatRevision){return Read-ExcelChartFormat $entry $data.reference};return Read-ExcelChart $entry $data.reference}
        'readExcelChartPackage' {return Read-ExcelChartPackageGuard $entry $data.reference}
        'readExcelChartFormat' {return Read-ExcelChartFormat $entry $data.reference}
        'readExcelChartCreate' {return Read-ExcelChartCreate $entry $data}
        'writeExcelChartCreate' {return Write-ExcelChartCreate $entry $data}
        'removeExcelCreatedChart' {return Remove-ExcelCreatedChart $entry $data}
        'writeExcelChartLayout' {return Write-ExcelChartLayout $entry $data}
        'readExcelTable' {return Read-ExcelTable $entry $data.reference}
        'writeExcelTableStyle' {return Write-ExcelTableStyle $entry $data}
        'readExcelTableAppend' {return Read-ExcelTableAppend $entry $data}
        'writeExcelTableRows' {return Write-ExcelTableRows $entry $data}
        'readExcelTableColumns' {return Read-ExcelTableColumns $entry $data}
        'writeExcelTableColumns' {return Write-ExcelTableColumns $entry $data}
        'readExcelTailProbe' {return Read-ExcelTail $entry $data.sheet $data.range}
        'readWordTableSelection' {return Read-WordTableSelection $entry $data.reference}
        'readWordBatchCell' {return Read-WordBatchCell $entry $data}
        'readWordTableLayout' {return Read-WordTableLayout $entry $data.reference ([bool]($data.includeWidths -eq $true -or $null -ne $data.properties.columnWidths -or $null -ne $data.restore.widths)) ([bool]($data.includeBorders -eq $true -or $null -ne $data.properties.borders -or $null -ne $data.restore.borders))}
        'readWordParagraphBatch' {return Read-WordParagraphBatch $entry $data.selection ([bool]$data.verifyReference)}
        'writeWordTableLayout' {return Write-WordTableLayout $entry $data}
        'writeWordTableRows' {return Write-WordTableRows $entry $data}
        'writeWordReplacement' {return Write-WordReplacement $entry $data}
        'readPptFormat' {return Read-PptFormat $entry $data.selection}
        'writePptFormat' {return Write-PptFormat $entry $data}
        'writePptRichFormat' {return Write-PptRichFormat $entry $data}
        'readPptReplacement' {return Read-PptReplacement $entry $data.selection}
        'writePptReplacement' {return Write-PptReplacement $entry $data}
        'readPptLayout' {return Read-PptLayout $entry $data.selection}
        'writePptLayout' {return Write-PptLayout $entry $data}
        'readPptShapes' {return Read-PptShapes $entry $data}
        'read' {return Read-Range $entry $data}
        'readText' {return Read-Text $entry $data}
        'readTarget' {return Text-Item $entry $data.target}
        'write' {
            if([bool]$entry.doc.ReadOnly){return @{code='READ_ONLY';verified=$false;notIssued=$true;message='Document is read-only.'}}
            $current=Read-Range $entry $data
            # Compare concrete matrices immediately before issuing the write; the Node broker also checks its revision.
            foreach($key in @('values','formulas','numberFormat')){if(($current[$key]|ConvertTo-Json -Compress -Depth 12) -ne ($data.before.$key|ConvertTo-Json -Compress -Depth 12)){return @{code='REVISION_CONFLICT';verified=$false;current=$current}}}
            $sheet=$entry.doc.Worksheets.Item([string]$data.sheet);$range=$sheet.Range([string]$data.range)
            if($sheet.ProtectContents -or $range.MergeCells -ne $false -or $range.HasArray -ne $false){return @{code='PROTECTED_RANGE';verified=$false;notIssued=$true;message='Protected, merged or array-formula ranges require a separate supported workflow.'}}
            foreach($field in @('values','formulas','numberFormat')){if($null -ne $data.$field){
                $matrix=$data.$field
                for($r=0;$r -lt $matrix.Count;$r++){for($c=0;$c -lt $matrix[$r].Count;$c++){
                    $cell=$range.Cells.Item($r+1,$c+1);$value=$matrix[$r][$c]
                    if($value -is [ValueType] -and $value -isnot [bool]){$value=[double]$value}
                    switch($field){'values'{Set-ExcelScalar $cell $value};'formulas'{Set-ExcelScalar $cell $value $true};'numberFormat'{$cell.NumberFormat=[string]$value}}
                }}
            }}
            $sheet.Calculate()
            $after=Read-Range $entry $data
            return @{before=$current;after=$after}
        }
        'writeText' {
            if([bool]$entry.doc.ReadOnly -or ($entry.kind -eq 'word' -and $entry.doc.ProtectionType -ne -1)){return @{code='READ_ONLY';verified=$false;notIssued=$true;message='Document is read-only or protected.'}}
            $before=Text-Item $entry $data.target
            if($before.contentHash -ne $data.expectedFingerprint){return @{code='REVISION_CONFLICT';verified=$false;current=$before}}
            if($entry.kind -eq 'word'){
                $paragraph=$entry.doc.Paragraphs.Item([int]$data.target.paragraphId);$range=$paragraph.Range.Duplicate
                if($entry.doc.TrackRevisions -or $range.Tables.Count -gt 0 -or $range.Fields.Count -gt 0 -or $range.InlineShapes.Count -gt 0 -or $range.Hyperlinks.Count -gt 0 -or $range.ContentControls.Count -gt 0){throw 'UNSUPPORTED_TARGET: Only plain paragraphs outside tables and tracked changes.'}
                if($range.End -gt $range.Start){$range.End=$range.End-1}
                $range.Text=[string]$data.text
            }else{
                $slide=$entry.doc.Slides.FindBySlideID([int]$data.target.slideId)
                for($i=1;$i -le $slide.Shapes.Count;$i++){if([string]$slide.Shapes.Item($i).Id -eq [string]$data.target.shapeId){$slide.Shapes.Item($i).TextFrame.TextRange.Text=[string]$data.text;break}}
            }
            return @{before=$before;after=(Text-Item $entry $data.target)}
        }
        'snapshot' {
            $destination=[IO.Path]::GetFullPath([string]$data.destination)
            $artifactRoot=[IO.Path]::GetFullPath($env:WORKBENCH_NATIVE_SNAPSHOTS).TrimEnd('\')+'\'
            if(-not $destination.StartsWith($artifactRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $destination)){throw 'SNAPSHOT_PATH'}
            $extension=[IO.Path]::GetExtension($destination)
            switch($entry.kind){
                'excel'{if($extension -ne '.xlsx' -or [int]$entry.doc.FileFormat -ne 51){throw 'FORMAT_UNSUPPORTED: Use a standard xlsx workbook.'};$entry.doc.SaveCopyAs($destination)}
                'powerpoint'{if($extension -ne '.pptx'){throw 'FORMAT_UNSUPPORTED'};$entry.doc.SaveCopyAs($destination,24)}
                'word'{if($extension -ne '.docx' -or [int]$entry.doc.SaveFormat -notin @(12,24)){throw 'FORMAT_UNSUPPORTED: Use a standard docx document for snapshots.'};$null=Export-WordFlatPackage ([string]$entry.doc.WordOpenXML) $destination}
            }
            return @{saved=$true}
        }
        default {throw 'UNSUPPORTED_METHOD'}
    }
}
while($null -ne ($line=[Console]::ReadLine())){
    $request=$null
    try{
        if($line.Length -gt 2000000){throw 'REQUEST_TOO_LARGE'}
        $request=$line|ConvertFrom-Json
        $result=Invoke-Office $request
        $response=@{id=$request.id;result=$result}|ConvertTo-Json -Compress -Depth 30
    }catch{$response=@{id=$request.id;error=$_.Exception.Message}|ConvertTo-Json -Compress -Depth 5}
    [Console]::WriteLine($response)
}
