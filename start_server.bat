@echo off
chcp 65001 >nul
cd /d "%~dp0server"
echo ================================
echo   剧集采集后端服务
echo   地址: http://localhost:5000
echo   后台: http://localhost:5000/dashboard
echo ================================
C:/Users/X/.local/bin/python3.14.exe src/app.py
pause
