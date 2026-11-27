@echo off
rem ------------------------------------------------------------------
rem  设置变量 PY = 一个可用的 Python 命令（含引号，可直接 %PY% xxx.py）
rem  要求：3.7+（serve.py 用了 from __future__ import annotations）
rem  坑一：Windows 商店那个假 python（...\WindowsApps\python.exe）点开跳商店
rem  坑二：Cygwin 自带的 python 是 3.6，且没有 Pillow，跑 serve.py / 图标脚本都会挂
rem  用法：call pypick.bat   然后 if not defined PY goto 没找到
rem ------------------------------------------------------------------
set "PY="
if defined PYTHON call :t "%PYTHON%"
call :t "py" -3
call :t "python"
call :t "%LOCALAPPDATA%\Python\bin\python.exe"
call :t "%USERPROFILE%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
call :t "%PROGRAMFILES%\Python311\python.exe"
call :t "python3"
exit /b 0

:t
if defined PY goto :eof
if "%~1"=="" goto :eof
echo %~1 | findstr /i "WindowsApps" >nul && goto :eof
if "%~2"=="" (
  "%~1" -c "import sys;raise SystemExit(0 if sys.version_info>=(3,7) else 1)" >nul 2>&1
) else (
  "%~1" %~2 -c "import sys;raise SystemExit(0 if sys.version_info>=(3,7) else 1)" >nul 2>&1
)
if errorlevel 1 goto :eof
set PY="%~1" %~2
goto :eof
