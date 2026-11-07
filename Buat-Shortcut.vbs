' nationcloudPOS - klik dua kali file ini SEKALI untuk membuat shortcut "nationcloudPOS" (dengan logo) di Desktop.
' Setelah itu program cukup dibuka lewat shortcut tersebut.
' Kalau folder program dipindah, jalankan file ini lagi.
Option Explicit
Dim sh, fso, dir, desktop, lnk, hapus
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = sh.SpecialFolders("Desktop")

If Not fso.FileExists(dir & "\Mulai.vbs") Or Not fso.FileExists(dir & "\public\logo.ico") Then
  MsgBox "File Mulai.vbs atau logo tidak ditemukan di folder ini." & vbCrLf & "Pastikan Anda sudah mengekstrak (Extract All) zip-nya dan menjalankan file ini dari dalam folder nationcloudPOS.", 48, "nationcloudPOS"
  WScript.Quit 1
End If

Set lnk = sh.CreateShortcut(desktop & "\nationcloudPOS.lnk")
lnk.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
lnk.Arguments = """" & dir & "\Mulai.vbs"""
lnk.WorkingDirectory = dir
lnk.IconLocation = dir & "\public\logo.ico,0"
lnk.Description = "Buka nationcloudPOS"
lnk.WindowStyle = 1
lnk.Save

MsgBox "Selesai! Shortcut nationcloudPOS (dengan logo) sudah ada di Desktop." & vbCrLf & vbCrLf & "Klik dua kali shortcut itu untuk membuka program." & vbCrLf & "Kalau logonya belum berubah, tunggu sebentar atau tekan F5 di Desktop.", 64, "nationcloudPOS"
