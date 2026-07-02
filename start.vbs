' OrChem 启动器（无窗口版）
' 双击此文件 -> 隐藏后台启动 Python 后端并打开浏览器

Dim shell, ws
Set shell = CreateObject("WScript.Shell")

' 检查 Python
On Error Resume Next
Dim ver
ver = shell.Run("python --version", 0, True)
If Err.Number <> 0 Then
    shell.Run "powershell -Command ""Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('未检测到 Python 运行环境！' + [char]10 + '请先安装 Python 3.8+：https://www.python.org/downloads/', 'OrChem - 缺少依赖', 'OK', 'Error')""", 1, False
    WScript.Quit 1
End If
On Error GoTo 0

' 安装依赖（静默）
shell.Run "pip install -r requirements.txt -q", 0, True

' 启动后端（隐藏窗口）
shell.Run "python synthesis_api.py", 0, False

' 等 3 秒后打开浏览器
WScript.Sleep 3000
shell.Run "http://localhost:18002"
