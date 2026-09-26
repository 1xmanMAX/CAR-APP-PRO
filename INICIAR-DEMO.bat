@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Flota - DEMO
echo.
echo  ==============================================
echo    CONTROL FLOTA - modo DEMO con datos de ejemplo
echo  ==============================================
echo.
where node >nul 2>nul
if errorlevel 1 goto sinnode

if exist node_modules goto instalado
echo  Instalando lo necesario. Solo la primera vez, tarda 1 a 3 minutos...
call npx --yes pnpm@9.12.3 install --frozen-lockfile
if errorlevel 1 goto error
:instalado

if exist data-demo\pglite goto condatos
echo  Creando los datos de ejemplo: 5 trailers, viajes, partes...
call npx --yes pnpm@9.12.3 demo:flota
if errorlevel 1 goto error
:condatos

set DATA_DIR=./data-demo
set STORAGE_DIR=./data-demo/storage
set WEB_PUERTO=3000
echo.
echo  Abriendo http://localhost:3000 en tu navegador...
echo  Usuario: demo@flota.pe     Clave: demo1234
echo  Para instalarla como app: boton INSTALAR APP arriba a la derecha,
echo  o el icono de instalar en la barra de direcciones de Chrome o Edge.
echo  Para cerrar la app: cierra esta ventana.
echo.
echo  Desde el celular - app Android, mismo wifi - usa esta direccion:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     %%a:3000
echo  Si Windows pregunta por el firewall, marca "Redes privadas" y permite el acceso.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000"
call npx --yes pnpm@9.12.3 web
goto fin

:sinnode
echo  Falta Node.js. Instala la version LTS desde https://nodejs.org
echo  y vuelve a abrir este archivo.
start "" https://nodejs.org/es/download
pause
exit /b 1

:error
echo.
echo  Algo fallo. Revisa el mensaje de arriba, o borra la carpeta node_modules y vuelve a intentar.
pause
exit /b 1

:fin
pause
