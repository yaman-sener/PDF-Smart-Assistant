$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectDir = (Get-Location).Path
$ExePath = Join-Path $ProjectDir "dist\pdf-smart-assistant.exe"
$IcoPath = Join-Path $ProjectDir "assets\icon.ico"

if (-not (Test-Path $IcoPath)) {
    $IcoPath = Join-Path $ProjectDir "public\favicon.ico"
}

# 1. Create Web URL shortcut: PDF Smart Assistant.url
$UrlShortcutPath = Join-Path $DesktopPath "PDF Smart Assistant.url"
$UrlContent = @"
[InternetShortcut]
URL=http://localhost:3000
IconFile=$IcoPath
IconIndex=0
"@
[System.IO.File]::WriteAllText($UrlShortcutPath, $UrlContent, [System.Text.Encoding]::UTF8)
Write-Host "Web URL Kisayolu olusturuldu: $UrlShortcutPath"

# 2. Create Application .lnk shortcut
$LnkPath = Join-Path $DesktopPath "PDF Smart Assistant.lnk"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($LnkPath)

if (Test-Path $ExePath) {
    $Shortcut.TargetPath = $ExePath
} else {
    $Shortcut.TargetPath = "http://localhost:3000"
}

$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description = "PDF Smart Assistant - Yapay Zeka Destekli PDF Asistani"

if (Test-Path $IcoPath) {
    $Shortcut.IconLocation = "$IcoPath,0"
}

$Shortcut.Save()
Write-Host "Masaustu Uygulama Kisayolu (.lnk) olusturuldu: $LnkPath"

# Refresh Windows Icon Cache
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($WshShell) | Out-Null
