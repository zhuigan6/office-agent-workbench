function Read-ExcelChartFormat($entry,$ref,[bool]$checkRevision=$true){
    $snapshot=Read-ExcelChart $entry $ref $checkRevision
    $chart=$entry.doc.Worksheets.Item([string]$ref.sheet).ChartObjects().Item([string]$ref.name).Chart
    $style=$chart.ChartStyle
    $snapshot.format=[ordered]@{type=$snapshot.content.type;style=$(if($null -eq $style){$null}else{[int]$style});hasTitle=$snapshot.content.hasTitle;title=$snapshot.content.title;hasLegend=$snapshot.content.hasLegend}
    $guard=Read-ExcelChartPackageGuard $entry $snapshot.reference
    if($checkRevision -and $ref.formatRevision -and [string]$ref.formatRevision -cne $guard.hash){throw 'EXCEL_CHART_FORMAT_REVISION_CONFLICT'}
    $snapshot.reference.formatRevision=$guard.hash
    $snapshot.packageGuard=$guard
    if([int]$chart.ChartType -in @(51,57,4)){
        try{$snapshot.valueAxis=Read-ExcelChartValueAxis $chart}catch{$snapshot.valueAxisUnavailable=$_.Exception.Message}
    }
    return $snapshot
}
function Read-ExcelChartValueAxis($chart){
    if(-not [bool]$chart.HasAxis(2,1)){throw 'EXCEL_CHART_PRIMARY_VALUE_AXIS_REQUIRED'}
    $axis=$chart.Axes(2,1);$labels=$axis.TickLabels
    return [ordered]@{scaleType=[int]$axis.ScaleType;minimum=[double]$axis.MinimumScale;maximum=[double]$axis.MaximumScale;minimumAuto=[bool]$axis.MinimumScaleIsAuto;maximumAuto=[bool]$axis.MaximumScaleIsAuto;majorUnit=[double]$axis.MajorUnit;minorUnit=[double]$axis.MinorUnit;majorUnitAuto=[bool]$axis.MajorUnitIsAuto;minorUnitAuto=[bool]$axis.MinorUnitIsAuto;numberFormat=[string]$labels.NumberFormat;numberFormatLinked=[bool]$labels.NumberFormatLinked}
}
function Get-ExcelChartValueAxisPlan($before,$properties){
    if(-not $before -or $before.scaleType -ne -4132){throw 'EXCEL_CHART_LINEAR_VALUE_AXIS_REQUIRED'}
    $names=@($properties.PSObject.Properties.Name)
    if($names.Count -lt 1 -or $names.Count -gt 6){throw 'EXCEL_CHART_VALUE_AXIS_PROPERTIES'}
    foreach($name in $names){
        if($name -notin @('minimum','maximum','majorUnit','minorUnit','numberFormat','numberFormatLinked')){throw 'EXCEL_CHART_VALUE_AXIS_PROPERTIES'}
        $value=$properties.$name
        if($name -in @('minimum','maximum','majorUnit','minorUnit') -and $null -ne $value){
            if($value -isnot [ValueType] -or $value -is [bool] -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or [Math]::Abs([double]$value) -gt 1e12 -or ($name -in @('majorUnit','minorUnit') -and [double]$value -le 0)){throw 'EXCEL_CHART_VALUE_AXIS_VALUE'}
        }
        if($name -eq 'numberFormat' -and ($value -isnot [string] -or $value.Length -lt 1 -or $value.Length -gt 100 -or $value -match '[\x00-\x1f]')){throw 'EXCEL_CHART_VALUE_AXIS_FORMAT'}
        if($name -eq 'numberFormatLinked' -and $value -isnot [bool]){throw 'EXCEL_CHART_VALUE_AXIS_FORMAT'}
    }
    if($names -contains 'numberFormat' -and $properties.numberFormatLinked -eq $true){throw 'EXCEL_CHART_VALUE_AXIS_FORMAT'}
    $wanted=[ordered]@{};foreach($key in $before.Keys){$wanted[$key]=$before[$key]}
    foreach($name in @('minimum','maximum','majorUnit','minorUnit')){
        if($names -contains $name){
            $auto=$name+'Auto'
            $wanted[$auto]=($null -eq $properties.$name);if($null -ne $properties.$name){$wanted[$name]=[double]$properties.$name}
        }
    }
    if(-not $wanted.minimumAuto -and -not $wanted.maximumAuto -and $wanted.minimum -ge $wanted.maximum){throw 'EXCEL_CHART_VALUE_AXIS_BOUNDS'}
    if($names -contains 'numberFormat'){$wanted.numberFormat=[string]$properties.numberFormat;$wanted.numberFormatLinked=$false}
    elseif($names -contains 'numberFormatLinked'){$wanted.numberFormatLinked=[bool]$properties.numberFormatLinked}
    return $wanted
}
function Set-ExcelChartValueAxis($chart,$wanted){
    $axis=$chart.Axes(2,1)
    # Release both bounds before relocating the interval, including disjoint ones.
    $axis.MinimumScaleIsAuto=$true;$axis.MaximumScaleIsAuto=$true
    if(-not $wanted.maximumAuto){$axis.MaximumScale=[double]$wanted.maximum}
    if(-not $wanted.minimumAuto){$axis.MinimumScale=[double]$wanted.minimum}
    foreach($pair in @(@('MajorUnit','majorUnit'),@('MinorUnit','minorUnit'))){
        $property=[string]$pair[0];$key=[string]$pair[1];$auto=$property+'IsAuto'
        if($wanted.($key+'Auto')){$axis.$auto=$true}else{$axis.$property=[double]$wanted.$key}
    }
    if(-not $wanted.numberFormatLinked){$axis.TickLabels.NumberFormatLinked=$false;$axis.TickLabels.NumberFormat=[string]$wanted.numberFormat}
    else{$axis.TickLabels.NumberFormatLinked=$true}
}
function Test-ExcelChartValueAxis($wanted,$actual){
    if(-not $wanted -or -not $actual -or $actual.scaleType -ne $wanted.scaleType){return $false}
    foreach($key in @('minimum','maximum','majorUnit','minorUnit')){
        if($actual.($key+'Auto') -ne $wanted.($key+'Auto')){return $false}
        if(-not $wanted.($key+'Auto') -and [Math]::Abs([double]$actual.$key-[double]$wanted.$key) -gt [Math]::Max(1e-9,[Math]::Abs([double]$wanted.$key)*1e-10)){return $false}
    }
    if($actual.numberFormatLinked -ne $wanted.numberFormatLinked -or (-not $wanted.numberFormatLinked -and [string]$actual.numberFormat -cne [string]$wanted.numberFormat)){return $false}
    return $true
}
$script:chartTitleFontFields=@('Name','NameAscii','NameFarEast','NameComplexScript','Size','Bold','Italic','UnderlineStyle','BaselineOffset','Kerning','Spacing')
function Read-ExcelChartTitleState($chart){
    if(-not $chart.HasTitle){return @{hasTitle=$false;text='';profiles=@()}}
    $title=$chart.ChartTitle;$text=[string]$title.Text
    if($text.Length -lt 1 -or $text.Length -gt 2000 -or $text -match '[\x00-\x1f]'){throw 'EXCEL_CHART_TITLE_SCOPE'}
    $formula='';try{$formula=[string]$title.Formula}catch{}
    if($formula.StartsWith('=') -and $formula -notmatch '^="(?:[^"]|"")*"$'){throw 'EXCEL_CHART_LINKED_TITLE_UNSUPPORTED'}
    $frame=$title.Format.TextFrame2;$frameState=[ordered]@{}
    foreach($key in @('Orientation','WordWrap','VerticalAnchor','HorizontalAnchor','MarginLeft','MarginRight','MarginTop','MarginBottom')){$frameState[$key]=$frame.$key}
    $profiles=@(for($i=1;$i -le $text.Length;$i++){
        $range=$frame.TextRange.Characters($i,1);$font=$range.Font;$color=$font.Fill.ForeColor
        if($font.Fill.Type -ne 1 -or $font.Fill.Transparency -ne 0 -or $color.Type -notin @(1,2) -or $font.Line.Visible -ne 0 -or $font.Glow.Radius -ne 0 -or $font.Reflection.Type -ne 0 -or $font.Shadow.Visible -ne 0){throw 'EXCEL_CHART_TITLE_EFFECT_UNSUPPORTED'}
        $p=[ordered]@{};foreach($key in $script:chartTitleFontFields){$p[$key]=$font.$key}
        $p.LanguageID=[int]$range.LanguageID;$p.Color=[ordered]@{type=[int]$color.Type;rgb=[int]$color.RGB;theme=[int]$color.ObjectThemeColor;tint=[double]$color.TintAndShade};$p
    })
    return @{hasTitle=$true;text=$text;frame=$frameState;profiles=$profiles}
}
function Set-ExcelChartTitleProfiles($chart,$profiles){
    if($profiles.Count -ne ([string]$chart.ChartTitle.Text).Length){throw 'EXCEL_CHART_TITLE_PROFILE_SHAPE'}
    for($i=0;$i -lt $profiles.Count;$i++){
        $range=$chart.ChartTitle.Format.TextFrame2.TextRange.Characters($i+1,1);$font=$range.Font;$p=$profiles[$i]
        foreach($key in $script:chartTitleFontFields){if($font.$key -cne $p.$key){$value=if($key.StartsWith('Name')){[string]$p.$key}elseif($key -in @('Size','BaselineOffset','Kerning','Spacing')){[double]$p.$key}else{[int]$p.$key};$font.$key=$value}}
        if($range.LanguageID -ne $p.LanguageID){$range.LanguageID=[int]$p.LanguageID}
        $color=$font.Fill.ForeColor
        if($color.Type -ne $p.Color.type -or $color.RGB -ne $p.Color.rgb -or $color.ObjectThemeColor -ne $p.Color.theme -or $color.TintAndShade -ne $p.Color.tint){
            if($p.Color.type -eq 1){$color.RGB=[int]$p.Color.rgb}else{$color.ObjectThemeColor=[int]$p.Color.theme};$color.TintAndShade=[double]$p.Color.tint
        }
    }
}
function Read-ExcelChartSeriesState($chart){
    $series=$chart.SeriesCollection();if($series.Count -lt 1 -or $series.Count -gt 50){throw 'EXCEL_CHART_SERIES_LIMIT'}
    $state=@(for($i=1;$i -le $series.Count;$i++){$s=$series.Item($i);$v=@($s.Values);$x=@($s.XValues);if($v.Count -gt 200 -or $x.Count -gt 200){throw 'EXCEL_CHART_DATA_LIMIT'};@{formula=[string]$s.Formula;values=$v;categories=$x}})
    if((ConvertTo-Json -InputObject $state -Depth 12 -Compress).Length -gt 512000){throw 'EXCEL_CHART_DATA_LIMIT'};return ,$state
}
function Read-ExcelChartDisplayPolicy($chart){
    $na=$chart.DisplayValueNotAvailableAsBlank
    if($na -isnot [bool]){throw 'EXCEL_CHART_DISPLAY_POLICY_UNSUPPORTED'}
    return [ordered]@{PlotVisibleOnly=[bool]$chart.PlotVisibleOnly;DisplayBlanksAs=[int]$chart.DisplayBlanksAs;DisplayValueNotAvailableAsBlank=$na}
}
function Get-ExcelChartTemplateHash([string]$file){
    $stream=[IO.File]::OpenRead($file);$sha=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();$stream.Dispose()}
}
function Resolve-ExcelChartTemplateAsset($asset){
    $root=[IO.Path]::GetFullPath($env:WORKBENCH_NATIVE_SNAPSHOTS).TrimEnd('\')+'\'
    if(-not (Test-Path -LiteralPath $root -PathType Container) -or [string]$asset.file -notmatch '^[a-f0-9-]{36}\.crtx$' -or [string]$asset.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'EXCEL_CHART_TEMPLATE_ASSET'}
    $file=Join-Path $root ([string]$asset.file);$item=Get-Item -LiteralPath $file -ErrorAction Stop
    if($item.PSIsContainer -or $item.Length -gt 4194304 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-ExcelChartTemplateHash $file) -cne [string]$asset.sha256){throw 'EXCEL_CHART_TEMPLATE_ASSET'}
    return $file
}
function Remove-ExcelChartTemplateThemeOverride([string]$file){
    $archive=[IO.Compression.ZipFile]::Open($file,[IO.Compression.ZipArchiveMode]::Update)
    try{
        $part='chart/chart.xml';$relsPart=Get-ChartRelationshipsPath $part
        if($null -eq $archive.GetEntry($relsPart)){
            $chartXml=Read-ChartPartXml $archive $part
            if($chartXml.SelectNodes('//@*[namespace-uri()="http://schemas.openxmlformats.org/officeDocument/2006/relationships"]').Count){throw 'EXCEL_CHART_TEMPLATE_RELATIONSHIP'}
            return
        }
        $rels=Read-ChartPartXml $archive $relsPart;$types=Read-ChartPartXml $archive '[Content_Types].xml'
        foreach($rel in @($rels.DocumentElement.ChildNodes|Where-Object {$_.LocalName -eq 'Relationship' -and $_.GetAttribute('Type').EndsWith('/themeOverride')})){
            if($rel.GetAttribute('TargetMode') -eq 'External'){throw 'EXCEL_CHART_TEMPLATE_RELATIONSHIP'}
            $target=Resolve-ChartPart $part ($rel.GetAttribute('Target'));if($target -notmatch '^chart/theme/[^/]+\.xml$'){throw 'EXCEL_CHART_TEMPLATE_RELATIONSHIP'}
            $item=$archive.GetEntry($target);if(-not $item){throw 'EXCEL_CHART_TEMPLATE_RELATIONSHIP'};$item.Delete();$null=$rel.ParentNode.RemoveChild($rel)
            foreach($declaration in @($types.DocumentElement.ChildNodes|Where-Object {$_.LocalName -eq 'Override' -and $_.GetAttribute('PartName') -ceq '/'+$target})){$null=$declaration.ParentNode.RemoveChild($declaration)}
        }
        foreach($update in @(@{part=$relsPart;xml=$rels},@{part='[Content_Types].xml';xml=$types})){
            $archive.GetEntry($update.part).Delete();$stream=$archive.CreateEntry($update.part).Open();$writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false))
            try{$writer.Write($update.xml.OuterXml)}finally{$writer.Dispose()}
        }
    }finally{$archive.Dispose()}
}
function Write-ExcelChartFormat($entry,$data){
    try{
        if(-not $data.reference.formatRevision){throw 'EXCEL_CHART_FORMAT_CAPTURE_REQUIRED'}
        $before=Read-ExcelChartFormat $entry $data.reference;$sheet=$entry.doc.Worksheets.Item([string]$data.reference.sheet);$object=$sheet.ChartObjects().Item([string]$data.reference.name);$chart=$object.Chart
        if($entry.doc.ReadOnly -or $sheet.ProtectContents -or $sheet.ProtectDrawingObjects -or $object.ShapeRange.Item(1).Type -eq 6){throw 'EXCEL_CHART_READ_ONLY_OR_GROUPED'}
        if([int]$chart.ChartType -notin @(51,57,4,5) -or @($before.content.series|Where-Object {$_.type -ne [int]$chart.ChartType}).Count){throw 'EXCEL_CHART_STANDARD_TYPE_REQUIRED'}
        $pivot=$null;try{$pivot=$chart.PivotLayout}catch{};if($null -ne $pivot){throw 'EXCEL_CHART_PIVOT_UNSUPPORTED'}
        $before.titleState=Read-ExcelChartTitleState $chart;$before.sourceState=Read-ExcelChartSeriesState $chart
        $before.displayPolicy=Read-ExcelChartDisplayPolicy $chart
        $wanted=[ordered]@{};foreach($key in $before.geometry.Keys){$wanted[$key]=$(if($data.restoreFormat){$data.restoreFormat.geometry.$key}elseif($null -ne $data.geometry.$key){[double]$data.geometry.$key}else{$before.geometry[$key]})}
        if($data.geometry){foreach($key in @($data.geometry.PSObject.Properties.Name)){if(-not $wanted.Contains($key)){throw 'EXCEL_CHART_PROPERTY_UNKNOWN'}}}
        foreach($key in $wanted.Keys){$value=[double]$wanted[$key];if([double]::IsNaN($value) -or [double]::IsInfinity($value) -or $value -lt 0 -or (-not $data.restoreFormat -and (($key -in @('width','height') -and ($value -lt 10 -or $value -gt 4000)) -or ($key -in @('left','top') -and $value -gt 10000)))){throw 'EXCEL_CHART_GEOMETRY_VALUE'}}
        if($data.restoreFormat){$template=Resolve-ExcelChartTemplateAsset $data.restoreFormat.template}
        else{
            foreach($key in @($data.properties.PSObject.Properties.Name)){if($key -notin @('type','title','legend','style','valueAxis')){throw 'EXCEL_CHART_PROPERTY_UNKNOWN'}}
            if($data.properties.valueAxis){
                if($before.content.type -eq 5 -or $data.properties.type -eq 'pie'){throw 'EXCEL_CHART_PRIMARY_VALUE_AXIS_REQUIRED'}
                $wantedAxis=Get-ExcelChartValueAxisPlan $before.valueAxis $data.properties.valueAxis
            }
            if($data.properties.type -and -not $script:excelChartTypes.ContainsKey([string]$data.properties.type)){throw 'EXCEL_CHART_TYPE'}
            if($data.properties.type -eq 'pie' -and $chart.SeriesCollection().Count -ne 1){throw 'EXCEL_CHART_PIE_SINGLE_SERIES'}
            if($null -ne $data.properties.style -and ([int]$data.properties.style -lt 1 -or [int]$data.properties.style -gt 48)){throw 'EXCEL_CHART_STYLE'}
            if($null -ne $data.properties.legend -and $data.properties.legend -isnot [bool]){throw 'EXCEL_CHART_LEGEND'}
            if($null -ne $data.properties.title -and (([string]$data.properties.title).Length -gt 2000 -or [string]$data.properties.title -match '[\x00-\x1f]')){throw 'EXCEL_CHART_TITLE_SCOPE'}
            if($data.properties.title -and $before.titleState.hasTitle){if($data.titleProfileOrigins.Count -ne ([string]$data.properties.title).Length -or @($data.titleProfileOrigins|Where-Object {$_ -isnot [ValueType] -or $_ -is [bool] -or [double]$_ -ne [int]$_ -or [int]$_ -lt 0 -or [int]$_ -ge $before.titleState.profiles.Count}).Count){throw 'EXCEL_CHART_TITLE_ORIGINS'}}
            $leaf=[Guid]::NewGuid().ToString()+'.crtx';$root=[IO.Path]::GetFullPath($env:WORKBENCH_NATIVE_SNAPSHOTS);$template=Join-Path $root $leaf;if(Test-Path -LiteralPath $template){throw 'EXCEL_CHART_TEMPLATE_EXISTS'}
            $chart.SaveChartTemplate($template)
            if(-not $before.packageGuard.hasThemeOverride){Remove-ExcelChartTemplateThemeOverride $template}
            $before.template=@{file=$leaf;sha256=(Get-ExcelChartTemplateHash $template)};$null=Resolve-ExcelChartTemplateAsset $before.template
        }
    }catch{return @{notIssued=$true;verified=$false;code=$(if($_.Exception.Message -match 'REVISION_CONFLICT'){'REVISION_CONFLICT'}else{'EXCEL_CHART_FORMAT_PREFLIGHT'});message=$_.Exception.Message}}
    if($data.restoreFormat){
        $original=$data.restoreFormat;$chart.ApplyChartTemplate($template);$chart.HasTitle=[bool]$original.titleState.hasTitle
        if($original.titleState.hasTitle){if([string]$chart.ChartTitle.Text -cne [string]$original.titleState.text){$chart.ChartTitle.Text=[string]$original.titleState.text};Set-ExcelChartTitleProfiles $chart $original.titleState.profiles}
        $chart.HasLegend=[bool]$original.format.hasLegend
        if($original.valueAxis -and -not (Test-ExcelChartValueAxis $original.valueAxis (Read-ExcelChartValueAxis $chart))){Set-ExcelChartValueAxis $chart $original.valueAxis}
    }else{
        if($data.properties.type){$chart.ChartType=[int]$script:excelChartTypes[[string]$data.properties.type]}
        if($null -ne $data.properties.style){$chart.ChartStyle=[int]$data.properties.style}
        if($null -ne $data.properties.legend){$chart.HasLegend=[bool]$data.properties.legend}
        if($null -ne $data.properties.title){
            $profiles=if($chart.HasTitle){(Read-ExcelChartTitleState $chart).profiles}else{@()};$chart.HasTitle=([string]$data.properties.title -ne '')
            if($chart.HasTitle){
                if([string]$chart.ChartTitle.Text -cne [string]$data.properties.title){$chart.ChartTitle.Text=[string]$data.properties.title}
                if($profiles.Count){
                    # New text has its own detected proofing language, not the language
                    # of the old glyph whose visible formatting it inherits.
                    $detected=Read-ExcelChartTitleState $chart;$titleLanguageDetected=$false
                    $mapped=@(for($i=0;$i -lt $data.titleProfileOrigins.Count;$i++){
                        $p=[ordered]@{};$old=$profiles[[int]$data.titleProfileOrigins[$i]];foreach($key in $old.Keys){$p[$key]=$old[$key]}
                        $p.LanguageID=$detected.profiles[$i].LanguageID;if($p.LanguageID -ne $old.LanguageID){$titleLanguageDetected=$true};$p
                    });Set-ExcelChartTitleProfiles $chart $mapped
                }
            }
        }
    }
    if($wantedAxis){Set-ExcelChartValueAxis $chart $wantedAxis}
    $wantedPolicy=if($data.restoreFormat){$data.restoreFormat.displayPolicy}else{$before.displayPolicy}
    foreach($key in @('PlotVisibleOnly','DisplayBlanksAs','DisplayValueNotAvailableAsBlank')){if($chart.$key -ne $wantedPolicy.$key){$chart.$key=$(if($key -eq 'DisplayBlanksAs'){[int]$wantedPolicy.$key}else{[bool]$wantedPolicy.$key})}}
    foreach($key in $wanted.Keys){if([Math]::Abs([double]$object.$key-[double]$wanted[$key]) -gt 0.001){$object.$key=[double]$wanted[$key]}}
    $after=Read-ExcelChartFormat $entry $data.reference $false;$after.titleState=Read-ExcelChartTitleState $chart;$after.sourceState=Read-ExcelChartSeriesState $chart
    $after.displayPolicy=Read-ExcelChartDisplayPolicy $chart
    $verified=(ConvertTo-Json -InputObject $before.sourceState -Depth 12 -Compress) -ceq (ConvertTo-Json -InputObject $after.sourceState -Depth 12 -Compress)
    if((ConvertTo-Json -InputObject $wantedPolicy -Compress) -cne (ConvertTo-Json -InputObject $after.displayPolicy -Compress)){$verified=$false}
    foreach($key in $wanted.Keys){if([Math]::Abs([double]$after.geometry[$key]-[double]$wanted[$key]) -gt 0.02){$verified=$false}}
    if($data.restoreFormat){
        if($original.valueAxis -and -not (Test-ExcelChartValueAxis $original.valueAxis $after.valueAxis)){$verified=$false}
        if((ConvertTo-Json -InputObject $original.displayPolicy -Compress) -cne (ConvertTo-Json -InputObject $after.displayPolicy -Compress)){$verified=$false}
        if((ConvertTo-Json -InputObject $original.format -Depth 8 -Compress) -cne (ConvertTo-Json -InputObject $after.format -Depth 8 -Compress) -or (ConvertTo-Json -InputObject $original.titleState -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $after.titleState -Depth 12 -Compress) -or $after.packageGuard.withoutTitleTextHash -cne $original.packageGuard.withoutTitleTextHash){$verified=$false}
    }else{
        if($wantedAxis -and -not (Test-ExcelChartValueAxis $wantedAxis $after.valueAxis)){$verified=$false}
        $expectedType=if($data.properties.type){$script:excelChartTypes[[string]$data.properties.type]}else{$before.format.type}
        $expectedStyle=if($null -ne $data.properties.style){$data.properties.style}else{$before.format.style}
        if($after.format.type -ne $expectedType -or @($after.content.series|Where-Object {$_.type -ne $expectedType}).Count -or $after.format.title -cne $(if($null -ne $data.properties.title){[string]$data.properties.title}else{$before.format.title}) -or $after.format.hasLegend -ne $(if($null -ne $data.properties.legend){$data.properties.legend}else{$before.format.hasLegend}) -or $after.format.style -ne $expectedStyle){$verified=$false}
        if($mapped -and (ConvertTo-Json -InputObject $mapped -Depth 12 -Compress) -cne (ConvertTo-Json -InputObject $after.titleState.profiles -Depth 12 -Compress)){$verified=$false}
    }
    return @{before=$before;after=$after;verified=$verified;revision=$after.reference.revision;titleLanguageDetected=([bool]$titleLanguageDetected);titleDeclarationsNormalized=([bool]$data.restoreFormat -and $after.packageGuard.hash -cne $original.packageGuard.hash);code=$(if($verified){'VERIFIED'}else{'READBACK_MISMATCH'})}
}
