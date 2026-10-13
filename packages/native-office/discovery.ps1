$script:ambiguousOfficePaths=@{}
function Add-OfficeCandidate($items,[string]$kind,$doc,$app,[string]$instanceId,[string]$source){
    $identity=$null
    if($kind -in @('word','excel')){
        $handles=[Collections.Generic.List[string]]::new()
        for($i=1;$i -le $doc.Windows.Count;$i++){$handle=[string]$doc.Windows.Item($i).Hwnd;if($handle -and $handle -ne '0'){$handles.Add($handle)}}
        if($handles.Count -gt 0){$ordered=$handles.ToArray();[Array]::Sort($ordered,[StringComparer]::Ordinal);$identity=$kind+':windows:'+($ordered -join ',')+'|'+([string]$doc.FullName).ToLowerInvariant()}
    }
    if($null -eq $identity){$pointer=[Runtime.InteropServices.Marshal]::GetIUnknownForObject($doc);try{$identity=$kind+':'+$pointer.ToInt64().ToString('X')}finally{[void][Runtime.InteropServices.Marshal]::Release($pointer)}}
    # Repeated window/ROT lookups can produce distinct COM proxies for the same
    # Word/Excel document. Real window sets identify it without merging processes.
    if($items.ContainsKey($identity)){if($source -eq 'native-window' -and $items[$identity].source -ne 'native-window'){$items[$identity]=@{kind=$kind;doc=$doc;app=$app;location=[string]$doc.FullName;name=[string]$doc.Name;identity=$identity;instanceId=$instanceId;source=$source}};return}
    $items[$identity]=@{kind=$kind;doc=$doc;app=$app;location=[string]$doc.FullName;name=[string]$doc.Name;identity=$identity;instanceId=$instanceId;source=$source}
}
function Get-OfficeDiscovery {
    $items=@{};$notes=[Collections.Generic.List[object]]::new();$partial=$false
    try{
        if(-not ('Workbench.OfficeWindows.Probe' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'office-windows.cs') -ErrorAction Stop}
        $scan=[Workbench.OfficeWindows.Probe]::Scan(64,2048,8192,10000)
        $partial=[bool]$scan.truncated
        foreach($note in $scan.diagnostics){$notes.Add(@{kind='discovery';message=$note.code;processId=$note.processId})}
        foreach($observed in $scan.windows){
            if($observed.status -ne 'document-accessible'){continue}
            try{
                $window=[Workbench.OfficeWindows.Probe]::OpenVerifiedWindow($observed)
                $doc=switch($observed.kind){'word'{,$window.Document};'excel'{,$window.Parent};'powerpoint'{,$window.Presentation}}
                if([string]$doc.FullName -cne $observed.fullName){throw 'DOCUMENT_CHANGED_DURING_DISCOVERY'}
                Add-OfficeCandidate $items $observed.kind $doc $window.Application $observed.instanceId 'native-window'
            }catch{$notes.Add(@{kind=$observed.kind;message='WINDOW_REACQUIRE_FAILED';processId=$observed.processId})}
        }
    }catch{$partial=$true;$notes.Add(@{kind='discovery';message='WINDOW_DISCOVERY_UNAVAILABLE'})}
    # Existing ROT attachment covers presentations whose UI has no native pane,
    # and documents without exposed panes in an already reachable application.
    foreach($kind in @('word','excel','powerpoint')){
        try{
            $prog=@{word='Word.Application';excel='Excel.Application';powerpoint='PowerPoint.Application'}[$kind]
            $app=[Runtime.InteropServices.Marshal]::GetActiveObject($prog)
            $pointer=[Runtime.InteropServices.Marshal]::GetIUnknownForObject($app)
            try{$instance='rot:'+ $pointer.ToInt64().ToString('X')}finally{[void][Runtime.InteropServices.Marshal]::Release($pointer)}
            $collection=switch($kind){'word'{,$app.Documents};'excel'{,$app.Workbooks};'powerpoint'{,$app.Presentations}}
            for($i=1;$i -le $collection.Count;$i++){Add-OfficeCandidate $items $kind $collection.Item($i) $app $instance 'active-application'}
        }catch{$notes.Add(@{kind=$kind;message='ACTIVE_APPLICATION_UNAVAILABLE'})}
    }
    return @{items=@($items.Values);diagnostics=$notes.ToArray();partial=$partial}
}
function Get-OfficeDocumentKey($candidate,[bool]$ambiguous){
    if($ambiguous){return Hash-Text ($candidate.kind+'|'+$candidate.location+'|'+$candidate.instanceId)}
    return Hash-Text ($candidate.kind+'|'+$candidate.location)
}
