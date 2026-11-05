@echo off
rem Bam dup de chay web RehabBoard AI (board phai chay firmware REHABBOARD_WEB, dong Arduino IDE truoc).
rem Che do mo phong (khong can board): CHAY_WEB.bat --demo
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:8095
python server.py %*
pause
