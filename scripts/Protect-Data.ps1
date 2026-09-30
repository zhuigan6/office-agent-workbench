[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).ProviderPath
$local=Join-Path $root '.local'
$item=Get-Item -LiteralPath $local -Force
if (-not $item.PSIsContainer -or $item.LinkType) { throw 'Expected a real private data directory, not a link.' }
$old=Get-Acl -LiteralPath $local
$backup=Join-Path $local ('permissions-before-'+[guid]::NewGuid().ToString('N')+'.sddl')
[IO.File]::WriteAllText($backup,$old.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All),[Text.UTF8Encoding]::new($false))
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
foreach ($identity in @($sid.Value,'S-1-5-18','S-1-5-32-544')) {
 $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($identity),[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
 $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $local -AclObject $acl
$actual=Get-Acl -LiteralPath $local
if (-not $actual.AreAccessRulesProtected) {throw 'Private data inheritance was not disabled.'}
Write-Output "Private data restricted to current user, SYSTEM and Administrators. Prior ACL: $backup"
