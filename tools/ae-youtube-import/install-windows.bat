@echo off
setlocal
rem Installs the YouTube Import extension for After Effects (current user).

set "SRC=%~dp0extension"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.zeph.youtubeimport"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo Can't find the "extension" folder next to this file.
  pause & exit /b 1
)

echo Copying extension to:
echo   %DEST%
robocopy "%SRC%" "%DEST%" /MIR /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo Copy failed.
  pause & exit /b 1
)

rem The extension isn't signed, so let After Effects load unsigned extensions.
for %%V in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo.
echo Done. Restart After Effects, then open Window ^> Extensions ^> YouTube Import.
pause
