@echo off
chcp 65001 >nul
title English AI Workbench
echo ========================================
echo   English AI Workbench - AI英语学习工作台
echo ========================================
echo.

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: Install dependencies
echo [1/3] 检查依赖...
pip install -r requirements.txt --quiet 2>nul

:: Set API key if provided as argument
if not "%~1"=="" (
    echo [2/3] 设置 Kimi API Key...
    set KIMI_API_KEY=%~1
) else (
    echo [2/3] 提示: 启动后可在"我的"页面设置 Kimi API Key
)

:: Start server
echo [3/3] 启动服务器...
echo.
echo ========================================
echo   服务已启动！
echo   本机访问: http://localhost:8000
echo   手机访问: http://你的电脑IP:8000
echo   (手机和电脑需在同一WiFi下)
echo ========================================
echo.
echo 按 Ctrl+C 停止服务器
echo.
python main.py
