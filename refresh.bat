@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  技能 Tag 检索器 - 数据刷新
echo ============================================
where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 bash，请安装 Git for Windows 后重试。
  pause
  exit /b 1
)
bash refresh.sh
echo.
pause
