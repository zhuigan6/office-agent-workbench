function Get-WordWriteRestriction($doc){
    try{
        if([bool]$doc.ReadOnly){return 'native-readonly'}
        if($doc.ProtectionType -ne -1){return 'document-protection'}
        if($doc.Windows.Count -lt 1){return 'window-status-unavailable'}
        $name=[string]$doc.Name
        for($i=1;$i -le $doc.Windows.Count;$i++){
            $caption=[string]$doc.Windows.Item($i).Caption
            if($caption.StartsWith($name,[StringComparison]::OrdinalIgnoreCase)){
                $suffix=$caption.Substring($name.Length)
                # Additional denial only: this machine can display a readonly
                # Word window while the COM ReadOnly getter is false.
                if($suffix -match '(?i)^\s*(?::\d+)?\s*(?:-\s*|\[|\(|\uFF08)(?:read[- ]?only|\u53ea\u8bfb|\u552f\u8b80|\u53ea\u8b80)\s*(?:\]|\)|\uFF09)?\s*$'){return 'window-readonly-marker'}
            }
        }
    }catch{return 'window-status-unavailable'}
    return $null
}
