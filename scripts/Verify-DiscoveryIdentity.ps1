$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'packages/native-office/discovery.ps1')
function Fake-Doc([string]$path,[long[]]$handles){$windows=[pscustomobject]@{Count=$handles.Count;handles=$handles};$windows|Add-Member ScriptMethod Item {param($i)return [pscustomobject]@{Hwnd=$this.handles[$i-1]}};return [pscustomobject]@{FullName=$path;Name='same.xlsx';Windows=$windows}}
$items=@{};$first=Fake-Doc 'E:\fixtures\same.xlsx' @(100,200);$proxy=Fake-Doc 'E:\fixtures\same.xlsx' @(200,100)
Add-OfficeCandidate $items 'excel' $first $null '10:1' 'native-window'
Add-OfficeCandidate $items 'excel' $proxy $null 'rot:DIFFERENT-PROXY' 'active-application'
if($items.Count -ne 1 -or @($items.Values)[0].instanceId -ne '10:1'){throw 'SAME_DOCUMENT_PROXY_DUPLICATED'}
Add-OfficeCandidate $items 'excel' (Fake-Doc 'E:\fixtures\same.xlsx' @(300)) $null '20:1' 'native-window'
if($items.Count -ne 2){throw 'INDEPENDENT_INSTANCES_MERGED'}
Add-OfficeCandidate $items 'excel' (Fake-Doc 'E:\fixtures\different.xlsx' @(100,200)) $null '10:1' 'active-application'
if($items.Count -ne 3){throw 'DIFFERENT_DOCUMENT_PATH_MERGED'}
$reverse=@{};Add-OfficeCandidate $reverse 'word' $first $null 'rot:first' 'active-application';Add-OfficeCandidate $reverse 'word' $proxy $null '30:1' 'native-window'
if($reverse.Count -ne 1 -or @($reverse.Values)[0].instanceId -ne '30:1'){throw 'NATIVE_IDENTITY_NOT_PREFERRED'}
'DISCOVERY_WINDOW_IDENTITY=PASS'
