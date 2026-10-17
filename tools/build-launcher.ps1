$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) {
    $compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
$launcherPath = Join-Path $projectRoot 'WeldingSimulator.exe'
& $compilerPath /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$launcherPath" (Join-Path $PSScriptRoot 'WeldingLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }

$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutName = ([char]0xC6A9).ToString() + [char]0xC811 + ' ' + [char]0xC2DC + [char]0xBBAC + [char]0xB808 + [char]0xC774 + [char]0xD130 + '.lnk'
$shortcutPath = Join-Path $desktopPath $shortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$launcherPath,0"
$shortcut.Description = 'Welding XR Simulator'
$shortcut.Save()
Write-Output "Built: $launcherPath"
Write-Output "Shortcut: $shortcutPath"
