@echo off
cd /d "%~dp0"
title tagsearch 本地服务
setlocal EnableExtensions

echo ============================================================
echo  tagsearch 本地服务 - 静态托管 + 一键更新数据
echo  页面弹出来后，点右上角「更新本地数据」抓 partner 最新数据
echo  抓取需：bsk daemon 运行中 + 浏览器已连 browser-skill 扩展
echo  停止服务：在本窗口按 Ctrl+C
echo ============================================================
echo.

call pypick.bat
if not defined PY goto nopy

echo 使用 Python：%PY%
echo.

%PY% serve.py --open
echo.
echo 服务已退出。
pause
exit /b 0

:nopy
echo [错误] 没找到可用的 Python 3.7 以上版本。
echo.
echo   窗口里的 python 多半是 Windows 商店的假 python（点开直接跳商店），
echo   或 Cygwin 自带的 3.6（版本太旧、也没有 Pillow）。
echo.
echo   任选一种解决：
echo     1) 装 Python 3.11+：https://www.python.org/downloads/
echo     2) 已经有 python.exe 的，把它设成环境变量 PYTHON，再双击本文件
echo     3) 或者在本窗口里手敲：  "完整路径\python.exe" serve.py --open
echo.
pause
exit /b 1
