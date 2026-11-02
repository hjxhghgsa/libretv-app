@echo off
chcp 65001 >nul
title LibreTV 影视工作台

REM ============================================================
REM  LibreTV 桌面版启动器
REM
REM  作用：清掉会让 Electron 退化成普通 Node 的环境变量
REM        ELECTRON_RUN_AS_NODE —— 它存在时，Electron 的
REM        require('electron') 返回字符串路径而非模块对象，
REM        主进程会因 app/BrowserWindow 为 undefined 直接崩。
REM
REM  这类变量通常由沙箱、CI、部分工具链注入，
REM  普通用户双击 exe 不受影响，但走这个启动器更保险。
REM ============================================================

set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="

cd /d "%~dp0"
start "" "LibreTV.exe" %*
