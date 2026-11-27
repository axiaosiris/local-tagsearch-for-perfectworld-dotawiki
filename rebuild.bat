@echo off
cd /d "%~dp0"
title tagsearch 重建数据与图标
setlocal EnableExtensions

echo ============================================================
echo  重建 data.js / 图标映射 / file:// 截图用的图标内联包
echo  换过图标、改过 _raw.json 之后跑一次，然后回页面按 F5
echo ============================================================
echo.

call pypick.bat
if not defined PY goto nopy
echo 使用 Python：%PY%
echo.

%PY% build_data.py || goto fail
%PY% scripts\local_icons.py || goto fail
%PY% build_data.py || goto fail

echo.
echo 完成 —— 回到页面按 F5 即可看到新图标。
pause
exit /b 0

:fail
echo.
echo [失败] 上面那一步报错了，先照错误信息处理（常见：icons 目录缺文件）。
pause
exit /b 1

:nopy
echo [错误] 没找到可用的 Python 3.7 以上版本，见 start.bat 的说明。
pause
exit /b 1
