$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectDir = (Get-Location).Path
$ExePath = Join-Path $ProjectDir "dist\pdf-smart-assistant.exe"

# 1. Create Web URL shortcut: PDF Smart Assistant (Web).url
$UrlShortcutPath = Join-Path $DesktopPath "PDF Smart Assistant.url"
$UrlContent = @"
[InternetShortcut]
URL=http://localhost:3000
IconIndex=0
"@
Set-Content -Path $UrlShortcutPath -Value $UrlContent -Encoding utf8
Write-Host "✅ Web Kısayolu oluşturuldu: $UrlShortcutPath"

# 2. Create Application .lnk shortcut if exe exists
if (Test-Path $ExePath) {
    $LnkPath = Join-Path $DesktopPath "PDF Smart Assistant.lnk"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($LnkPath)
    $Shortcut.TargetPath = $ExePath
    $Shortcut.WorkingDirectory = $ProjectDir
    $Shortcut.Description = "PDF Smart Assistant - Yapay Zeka Destekli PDF Asistanı"
    $Shortcut.Save()
    Write-Host "✅ Masaüstü Uygulama Kısayolu (.lnk) oluşturuldu: $LnkPath"
}
