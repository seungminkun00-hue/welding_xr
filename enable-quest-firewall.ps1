$ErrorActionPreference = 'Stop'
$ruleName = 'Welding XR (8443)'
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    $existingRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any
    $existingRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 8443
    $existingRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet
} else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Any -RemoteAddress LocalSubnet | Out-Null
}
Write-Host 'Quest HTTPS access enabled on port 8443 for the local subnet.'
