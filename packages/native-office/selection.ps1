# Read-only selection capture. Never activate a window or move its selection.
$script:pptWindowIdentities=@{}
function Get-OfficeWindowIdentity([string]$kind,$window){
    if($kind -ne 'powerpoint'){
        $handle=[string]$window.Hwnd
        if([string]::IsNullOrWhiteSpace($handle) -or $handle -eq '0'){throw 'OFFICE_WINDOW_ID_UNAVAILABLE'}
        return $handle
    }
    # DocumentWindow has no HWND property. Retain COM identity for this worker
    # so a closed window's address cannot be recycled into a valid old ticket.
    $pointer=[Runtime.InteropServices.Marshal]::GetIUnknownForObject($window)
    try{
        $key=$pointer.ToInt64().ToString('X')
        if(-not $script:pptWindowIdentities.ContainsKey($key)){
            if($script:pptWindowIdentities.Count -ge 200){throw 'OFFICE_WINDOW_ID_LIMIT: Restart the idle connector before opening more windows.'}
            $script:pptWindowIdentities[$key]=@{value=('ppt-'+[Guid]::NewGuid().ToString());reference=$window}
        }
        return $script:pptWindowIdentities[$key].value
    }finally{[void][Runtime.InteropServices.Marshal]::Release($pointer)}
}
function Assert-SelectionIdentity($entry,$selection){
    $matched=$false
    for($i=1;$i -le $entry.doc.Windows.Count;$i++){
        $identity=$script:session+':'+(Get-OfficeWindowIdentity $entry.kind $entry.doc.Windows.Item($i))
        if($identity -ceq [string]$selection.hostSessionId){$matched=$true;break}
    }
    if(-not $matched){throw 'SELECTION_SESSION_CHANGED: The captured Office window or connector is no longer available.'}
    return @{valid=$true}
}
function Capture-OfficeSelection($entry) {
    $active=$null
    switch($entry.kind){
        'word' {$active=$entry.app.ActiveDocument;$window=$entry.app.ActiveWindow}
        'excel' {$active=$entry.app.ActiveWorkbook;$window=$entry.app.ActiveWindow}
        'powerpoint' {$window=$entry.app.ActiveWindow;$active=$window.Presentation}
    }
    if($null -eq $active -or [string]$active.FullName -cne [string]$entry.doc.FullName){throw 'SELECTION_OTHER_DOCUMENT: Activate the bound document before capturing a selection.'}
    # An if-expression writes COM Range to the pipeline, which enumerates its
    # cells. Direct assignment preserves one multi-cell selection object.
    $selection=$null
    if($entry.kind -eq 'powerpoint'){$selection=$window.Selection}else{$selection=$entry.app.Selection}
    $session=$script:session+':'+(Get-OfficeWindowIdentity $entry.kind $window)
    if($entry.kind -eq 'excel'){
        $chart=$entry.app.ActiveChart
        if($null -ne $chart){
            $object=$chart.Parent
            $null=Assert-ExcelChartSelectionScope $selection $chart $object
            if([string]$object.Parent.Parent.FullName -cne [string]$entry.doc.FullName){throw 'SELECTION_OTHER_DOCUMENT'}
            return Get-ExcelChartSelection $entry ([string]$object.Parent.Name) ([string]$object.Name) $session
        }
        if($selection.Areas.Count -ne 1){throw 'SELECTION_UNSUPPORTED: Choose one contiguous cell range.'}
        $address=[string]$selection.Address($false,$false)
        $state=Read-Range $entry @{sheet=[string]$selection.Worksheet.Name;range=$address}
        $serialized=ConvertTo-Json -InputObject $state -Depth 8 -Compress
        if($serialized.Length -gt 512000){throw 'SELECTION_TOO_LARGE: Narrow the selected range.'}
        return Add-ExcelTableReference $entry @{kind='excel';hostSessionId=$session;sheet=$state.sheetName;range=$address;state=$state;preview=$serialized.Substring(0,[Math]::Min(4000,$serialized.Length));contentHash=(Hash-Text $serialized)}
    }
    if($entry.kind -eq 'word'){
        $range=$selection.Range.Duplicate
        if([int]$range.StoryType -ne 1){throw 'SELECTION_UNSUPPORTED: Non-body stories require a dedicated story anchor.'}
        if($range.Tables.Count -eq 1){
            $table=$range.Tables.Item(1)
            if($range.Start -eq $table.Range.Start -and $range.End -eq $table.Range.End){
                for($i=1;$i -le $entry.doc.Tables.Count;$i++){if($entry.doc.Tables.Item($i).Range.Start -eq $table.Range.Start){
                    $snapshot=Read-WordTableSnapshot $entry (Get-WordCellContentRange $table.Cell(1,1))
                    $ref=@{tableIndex=$i;tableStart=$snapshot.start;rows=$snapshot.rows;columns=$snapshot.columns;hostSessionId=$session;revision=$snapshot.revision}
                    return Read-WordTableSelection $entry $ref
                }}
                throw 'WORD_TABLE_ID_UNAVAILABLE'
            }
        }
        if($range.Tables.Count -eq 1 -and $range.Cells.Count -eq 1){
            $cell=$range.Cells.Item(1)
            if($range.Start -eq $cell.Range.Start -and $range.End -eq $cell.Range.End){$range=Get-WordCellContentRange $cell}
        }
        $xml=[string]$range.WordOpenXML
        if($xml.Length -gt 1048576){throw 'SELECTION_TOO_LARGE: Narrow the selected range.'}
        $text=[string]$range.Text
        $fingerprint=Hash-Text ([string]$range.Start+'|'+$range.End+'|'+[string]$entry.doc.Content.Text+'|'+(Get-WordSemanticXml $xml))
        $result=@{kind='word';hostSessionId=$session;storyType=[int]$range.StoryType;start=[int]$range.Start;end=[int]$range.End;preview=$text.Substring(0,[Math]::Min(4000,$text.Length));contentHash=$fingerprint}
        if($range.Tables.Count -eq 1 -and $range.Cells.Count -eq 1){
            $cell=$range.Cells.Item(1);$table=$range.Tables.Item(1)
            for($i=1;$i -le $entry.doc.Tables.Count;$i++){if($entry.doc.Tables.Item($i).Range.Start -eq $table.Range.Start){
                if($i -le 1000 -and $cell.RowIndex -le 20 -and $cell.ColumnIndex -le 20){$result.cell=@{tableIndex=$i;row=[int]$cell.RowIndex;column=[int]$cell.ColumnIndex}};break
            }}
        }
        return $result
    }
    if([int]$selection.Type -eq 1){
        $slides=$selection.SlideRange
        if($slides.Count -lt 1 -or $slides.Count -gt 50){throw 'SELECTION_TOO_LARGE: Select between 1 and 50 slides.'}
        $ids=[Collections.Generic.List[string]]::new();$states=[Collections.Generic.List[object]]::new();$texts=[Collections.Generic.List[string]]::new()
        $shapeCount=0;$textLength=0
        for($i=1;$i -le $slides.Count;$i++){
            $slide=$slides.Item($i);$ids.Add([string]$slide.SlideID)
            $items=[Collections.Generic.List[object]]::new()
            for($j=1;$j -le $slide.Shapes.Count;$j++){
                $shapeCount++
                if($shapeCount -gt 1000){throw 'SELECTION_TOO_LARGE: Narrow the selected slides.'}
                $shape=$slide.Shapes.Item($j);$text=''
                if($shape.HasTextFrame -ne 0){$text=[string]$shape.TextFrame.TextRange.Text}
                $textLength+=$text.Length
                if($textLength -gt 512000){throw 'SELECTION_TOO_LARGE: Narrow the selected slides.'}
                $items.Add(@{id=[string]$shape.Id;type=[int]$shape.Type;left=$shape.Left;top=$shape.Top;width=$shape.Width;height=$shape.Height;text=$text})
                if(($texts.ToArray() -join "`n").Length -lt 4000){$texts.Add($text.Substring(0,[Math]::Min(4000,$text.Length)))}
            }
            $states.Add(@{id=[string]$slide.SlideID;index=[int]$slide.SlideIndex;shapes=$items.ToArray()})
        }
        # This read-only context fingerprint is not a rich-edit conflict validator.
        $serialized=ConvertTo-Json -InputObject $states.ToArray() -Depth 8 -Compress
        $preview=$texts.ToArray() -join "`n"
        return @{kind='powerpoint-slides';hostSessionId=$session;slideIds=$ids.ToArray();preview=$preview.Substring(0,[Math]::Min(4000,$preview.Length));contentHash=(Hash-Text $serialized)}
    }
    if([int]$selection.Type -notin @(2,3)){throw 'SELECTION_UNSUPPORTED: Select slides, a shape or text.'}
    if($selection.HasChildShapeRange){throw 'SELECTION_UNSUPPORTED: Group-child selections require a dedicated group path.'}
    $shapes=$selection.ShapeRange
    if($shapes.Count -gt 50){throw 'SELECTION_TOO_LARGE'}
    $ids=[Collections.Generic.List[string]]::new();$fingerprints=[Collections.Generic.List[string]]::new();$texts=[Collections.Generic.List[string]]::new()
    $slide=$window.View.Slide
    for($i=1;$i -le $shapes.Count;$i++){
        $shape=$shapes.Item($i);$ids.Add([string]$shape.Id)
        if($shape.HasTextFrame -ne 0){$item=Text-Item $entry @{slideId=[string]$slide.SlideID;shapeId=[string]$shape.Id};$fingerprints.Add($item.contentHash);$texts.Add($item.text)}
        else{$fingerprints.Add((Hash-Text ([string]$shape.Id+'|'+$shape.Left+'|'+$shape.Top+'|'+$shape.Width+'|'+$shape.Height)))}
    }
    $preview=$texts.ToArray() -join "`n"
    $result=@{kind='powerpoint';hostSessionId=$session;slideId=[string]$slide.SlideID;shapeIds=$ids.ToArray();preview=$preview.Substring(0,[Math]::Min(4000,$preview.Length));contentHash=(Hash-Text ($fingerprints.ToArray() -join '|'))}
    if([int]$selection.Type -eq 3){$result.textStart=[int]$selection.TextRange.Start;$result.textLength=[int]$selection.TextRange.Length;$result.preview=[string]$selection.TextRange.Text;if($result.preview.Length -gt 4000){$result.preview=$result.preview.Substring(0,4000)}}
    if($ids.Count -eq 1 -and $shapes.Item(1).HasTextFrame -ne 0 -and $shapes.Item(1).TextFrame.TextRange.Length -gt 0 -and $shapes.Item(1).TextFrame.TextRange.Length -le 2000){$result.contentHash=(Read-PptFormat $entry $result).contentHash}
    if($ids.Count -eq 1 -and $shapes.Item(1).Type -ne 6){
        if([int]$selection.Type -eq 2){try{$null=Read-PptAppearance $shapes.Item(1);$result.appearanceProfileVersion=1}catch{}}
        if($shapes.Item(1).HasTextFrame -ne 0 -and $shapes.Item(1).Type -in @(1,14,17)){try{$null=Read-PptTextFrame $shapes.Item(1);$result.frameProfileVersion=1}catch{}}
        try{$result.layoutRevision=(Read-PptLayout $entry $result).contentHash}catch{if(-not $result.appearanceProfileVersion){throw};$result.Remove('appearanceProfileVersion');$result.layoutRevision=(Read-PptLayout $entry $result).contentHash}
    }
    if($ids.Count -eq 1){try{$result.paragraphProfileVersion=1;$result.replacementRevision=(Read-PptReplacement $entry $result).contentHash}catch{
        $result.Remove('paragraphProfileVersion')
        # Unsupported rich effects do not remove the existing read/format capability.
    }}
    if($ids.Count -gt 1 -and $ids.Count -le 20){
        $layouts=[Collections.Generic.List[object]]::new()
        for($i=1;$i -le $shapes.Count;$i++){
            $shape=$shapes.Item($i)
            if($shape.Type -eq 6){$layouts.Clear();break}
            $single=@{kind='powerpoint';hostSessionId=$session;slideId=$result.slideId;shapeIds=@([string]$shape.Id)}
            try{$null=Read-PptAppearance $shape;$single.appearanceProfileVersion=1}catch{}
            if($shape.HasTextFrame -ne 0 -and $shape.Type -in @(1,14,17)){try{$null=Read-PptTextFrame $shape;$single.frameProfileVersion=1}catch{}}
            try{$layout=(Read-PptLayout $entry $single).contentHash}catch{if(-not $single.appearanceProfileVersion){throw};$single.Remove('appearanceProfileVersion');$layout=(Read-PptLayout $entry $single).contentHash}
            $textHash=$layout
            if($shape.HasTextFrame -ne 0 -and $shape.TextFrame.TextRange.Length -gt 0 -and $shape.TextFrame.TextRange.Length -le 2000){$textHash=(Read-PptFormat $entry $single).contentHash}
            $snapshot=@{shapeId=[string]$shape.Id;layoutRevision=$layout;contentHash=$textHash}
            foreach($flag in @('frameProfileVersion','appearanceProfileVersion')){if($single[$flag]){$snapshot[$flag]=$single[$flag]}}
            if($single.frameProfileVersion -eq 1 -and $shape.TextFrame.TextRange.Length -gt 0 -and $shape.TextFrame.TextRange.Length -le 2000){
                try{$single.paragraphProfileVersion=1;$snapshot.replacementRevision=(Read-PptReplacement $entry $single).contentHash;$snapshot.paragraphProfileVersion=1}catch{}
            }
            $layouts.Add($snapshot)
        }
        if($layouts.Count -eq $ids.Count){$result.shapeLayouts=$layouts.ToArray()}
    }
    return $result
}
