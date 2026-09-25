@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Control Flota
where node >nul 2>nul
if errorlevel 1 goto sinnode

if exist .env goto conenv
copy .env.example .env >nul
echo  Se creo el archivo .env. Completa los datos de tu empresa, placas, conductor y tu correo,
echo  y el TELEGRAM_BOT_TOKEN si ya lo tienes. Luego guarda, cierra el Bloc de notas
echo  y vuelve a abrir INICIAR.bat.
notepad .env
exit /b 0
:conenv

if exist node_modules goto instalado
echo  Instalando lo necesario. Solo la primera vez, tarda 1 a 3 minutos...
call npx --yes pnpm@9.12.3 install --frozen-lockfile
if errorlevel 1 goto error
:instalado

if exist data\pglite goto sembrado
echo  Cargando los datos iniciales de tu empresa...
call npx --yes pnpm@9.12.3 sembrar
if errorlevel 1 goto error
:sembrado

echo  Abriendo http://localhost:3000 ... La primera vez te pedira crear tu acceso de dueno.
echo  Para cerrar la app: cierra esta ventana.
echo  Desde el celular - app Android, mismo wifi - usa esta direccion:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     %%a:3000
echo  Si Windows pregunta por el firewall, marca "Redes privadas" y permite el acceso.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:3000"
call npx --yes pnpm@9.12.3 app
goto fin

:sinnode
echo  Falta Node.js. Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
start "" https://nodejs.org/es/download
pause
exit /b 1

:error
echo.
echo  Algo fallo. Revisa el mensaje de arriba.
pause
exit /b 1

:fin
pause
