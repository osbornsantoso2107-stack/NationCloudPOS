' nationcloudPOS - klik dua kali file ini untuk membuka program.
' Program berjalan tersembunyi (tidak ada jendela hitam) dan terbuka sebagai jendela aplikasi
' tanpa kolom alamat / tab / bookmark. Untuk menutup: Pengaturan > Tutup program.
Option Explicit
Dim sh, fso, dir, url, ok, ch, chrome, edge, p, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
url = "http://localhost:8780"

' Node.js terpasang?
ok = sh.Run("cmd /c where node >nul 2>nul", 0, True)
If ok <> 0 Then
  MsgBox "Node.js belum terpasang." & vbCrLf & "Unduh versi LTS dari https://nodejs.org, pasang, lalu klik Mulai.vbs lagi.", 48, "nationcloudPOS"
  WScript.Quit 1
End If

' Jalankan server tersembunyi; pesan error disimpan di data\server.log
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder dir & "\data"
sh.Run "cmd /c node --disable-warning=ExperimentalWarning server.js >> ""data\server.log"" 2>&1", 0, False

' Tunggu server siap (maks 15 detik). Kalau sudah berjalan sebelumnya, langsung siap.
Dim i, http, siap
siap = False
For i = 1 To 30
  WScript.Sleep 500
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.Open "GET", url & "/api/info", False
  http.setTimeouts 500, 500, 500, 500
  http.Send
  If Err.Number = 0 Then If http.Status = 200 Then siap = True
  Err.Clear
  On Error GoTo 0
  If siap Then Exit For
Next
If Not siap Then
  MsgBox "Program belum bisa dibuka. Buka file data\server.log lalu tunjukkan isinya ke Claude." & vbCrLf & "Atau coba klik Mulai-lihat-pesan-error.cmd.", 48, "nationcloudPOS"
  WScript.Quit 1
End If

' Buka sebagai jendela aplikasi (Chrome, lalu Edge); kalau tidak ada, pakai browser biasa
Dim cands, c, opened
cands = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"))
opened = False
For Each c In cands
  If fso.FileExists(c) Then
    sh.Run """" & c & """ --app=" & url & " --start-maximized", 1, False
    opened = True
    Exit For
  End If
Next
If Not opened Then sh.Run url, 1, False
