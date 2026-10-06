@echo off
rem Pixel Company: bat Paperclip neu chua chay, roi bat Pixel Company va mo trinh duyet.
rem Cau hinh (khong bat buoc) trong file .env, xem .env.example:
rem   VITE_PAPERCLIP_URL    dia chi Paperclip, mac dinh http://127.0.0.1:3100
rem   PAPERCLIP_WSL_DISTRO  ten WSL dang chay Paperclip (vd. Ubuntu). Co thi script tu bat Paperclip trong WSL do.
rem Paperclip chay trong cua so rieng "Paperclip" (thu nho). Dong cua so do = tat Paperclip.
cd /d "%~dp0"

set "PAPERCLIP=http://127.0.0.1:3100"
set "WSL_DISTRO="
if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="VITE_PAPERCLIP_URL" if not "%%b"=="" set "PAPERCLIP=%%b"
    if /i "%%a"=="PAPERCLIP_WSL_DISTRO" if not "%%b"=="" set "WSL_DISTRO=%%b"
  )
)
echo Paperclip: %PAPERCLIP%

curl -s -f -o nul -m 3 %PAPERCLIP%/api/health
if not errorlevel 1 (
  echo Paperclip dang chay.
  goto :coopverse
)

if defined WSL_DISTRO (
  rem wsl tra ma loi am khi khong co distro, nen dung "||" thay cho "if errorlevel 1"
  wsl -d %WSL_DISTRO% -- true >nul 2>&1 || (
    echo Khong tim thay WSL "%WSL_DISTRO%". Kiem tra PAPERCLIP_WSL_DISTRO trong file .env.
    goto :coopverse
  )
  echo Paperclip chua chay. Dang bat Paperclip trong WSL %WSL_DISTRO%...
  start "Paperclip" /min wsl -d %WSL_DISTRO% --cd ~ -- bash -lc "export PATH=$HOME/.local/bin:$PATH; exec paperclipai run"
  goto :wait
)

where paperclipai >nul 2>&1
if not errorlevel 1 (
  echo Paperclip chua chay. Dang bat Paperclip...
  start "Paperclip" /min cmd /c paperclipai run
  goto :wait
)

echo Paperclip chua chay. Hay tu bat Paperclip ^(paperclipai run^), Pixel Company se tu ket noi lai.
goto :coopverse

:wait
call :waitpaperclip
if errorlevel 1 (
  echo Paperclip chua len sau 90 giay. Van mo Pixel Company, no se tu ket noi lai khi Paperclip san sang.
) else (
  echo Paperclip da san sang.
)

:coopverse
if not exist node_modules (
  echo Dang cai thu vien lan dau...
  call npm install || goto :error
)
start "" http://127.0.0.1:5179
call npm run dev
goto :eof

:waitpaperclip
for /l %%i in (1,1,45) do (
  ping -n 3 127.0.0.1 >nul
  curl -s -f -o nul -m 2 %PAPERCLIP%/api/health && exit /b 0
)
exit /b 1

:error
echo Cai dat that bai. Xem loi o tren.
pause
