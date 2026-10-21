@echo off
chcp 65001 >nul
cd /d "%~dp0"
title tagsearch 本地服务

set "PY=%PYTHON%"
if "%PY%"=="" set "PY=python"

echo ============================================================
echo  tagsearch 本地服务 —— 静态托管 + 一键更新数据
echo  打开后点右上角「更新本地数据」即可抓取 partner 最新数据
echo  抓取需：bsk daemon 运行中 + 浏览器已连 browser-skill 扩展
echo  停止服务：在本窗口按 Ctrl+C
echo ============================================================
echo.

"%PY%" serve.py --open
echo.
echo 服务已退出。
pause
