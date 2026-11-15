' Menjalankan Antigravity Assistant tanpa jendela terminal.
' Dipakai oleh perintah "aero" (Win+R) dan oleh shortcut.
Option Explicit
Dim sh, fso, dir, exe
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron belum terpasang. Jalankan npm install di folder Antigravity Assistant dulu.", 48, "Antigravity Assistant"
  WScript.Quit 1
End If
sh.CurrentDirectory = dir
sh.Run """" & exe & """ """ & dir & """", 0, False
