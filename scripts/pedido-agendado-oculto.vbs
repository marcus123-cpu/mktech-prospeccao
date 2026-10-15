' Aciona o pedido de pesquisa agendado sem abrir janela (a tarefa roda a cada 2 minutos).
Option Explicit
Dim sh, here
Set sh = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WScript.Quit sh.Run("""C:\Program Files\PowerShell\7\pwsh.exe"" -NoProfile -WindowStyle Hidden -File """ & here & "pedido-agendado.ps1""", 0, True)
