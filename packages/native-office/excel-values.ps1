function Set-ExcelScalar($cell,$value,[bool]$formula=$false){
    # Separate typed COM call sites prevent a string setter binding from being
    # reused for the next numeric/bool cell in a heterogeneous matrix.
    if($null -eq $value){$null=$cell.ClearContents();return}
    if($formula){
        if($value -is [bool]){$cell.Formula=[bool]$value}
        elseif($value -is [ValueType]){$cell.Formula=[double]$value}
        else{$cell.Formula=[string]$value}
    }else{
        if($value -is [bool]){$cell.Value2=[bool]$value}
        elseif($value -is [ValueType]){$cell.Value2=[double]$value}
        else{$cell.Value2=[string]$value}
    }
}
