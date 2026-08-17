import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const desktopDir = path.join(os.homedir(), 'Desktop');
const projectDir = process.cwd();
const exePath = path.join(projectDir, 'dist', 'pdf-smart-assistant.exe');

console.log('Masaüstü kısayolu oluşturuluyor...');
console.log('Masaüstü dizini:', desktopDir);

// 1. Create Web URL shortcut: PDF Smart Assistant.url
const urlShortcutPath = path.join(desktopDir, 'PDF Smart Assistant.url');
const urlContent = `[InternetShortcut]\r\nURL=http://localhost:3000\r\nIconIndex=0\r\nIconFile=${path.join(projectDir, 'public', 'favicon.ico')}\r\n`;

try {
  fs.writeFileSync(urlShortcutPath, urlContent, 'utf-8');
  console.log('✅ Web Kısayolu oluşturuldu:', urlShortcutPath);
} catch (e) {
  console.error('URL kısayolu oluşturulurken hata:', e);
}

// 2. Create Windows .lnk Shortcut (points to standalone exe or web launcher)
try {
  const targetExecutable = fs.existsSync(exePath) 
    ? exePath 
    : path.join(projectDir, 'node_modules', '.bin', 'tsx.cmd');
  
  const lnkPath = path.join(desktopDir, 'PDF Smart Assistant.lnk');
  const psScript = `
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("${lnkPath.replace(/\\/g, '\\\\')}")
$Shortcut.TargetPath = "${targetExecutable.replace(/\\/g, '\\\\')}"
$Shortcut.WorkingDirectory = "${projectDir.replace(/\\/g, '\\\\')}"
$Shortcut.Description = "AI-Powered PDF & Document Assistant"
$Shortcut.Save()
  `.trim();

  execSync(`powershell -Command "${psScript.replace(/\n/g, '; ')}"`, { stdio: 'ignore' });
  console.log('✅ Uygulama Kısayolu (.lnk) oluşturuldu:', lnkPath);
} catch (e) {
  console.warn('LNK kısayol oluşturma uyarısı:', e);
}

console.log('\n🎉 Masaüstü kısayolları başarıyla hazırlandı!');
