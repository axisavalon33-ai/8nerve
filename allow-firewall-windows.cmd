@echo off
rem Ear & Balance: lets the tablet and phone reach this laptop through Windows Firewall.
rem Right-click this file and choose "Run as administrator".
netsh advfirewall firewall delete rule name="Ear and Balance station" >nul 2>&1
netsh advfirewall firewall add rule name="Ear and Balance station" dir=in action=allow protocol=TCP localport=8443,8080 profile=any
if errorlevel 1 (
  echo.
  echo Could not change the firewall. Right-click this file and choose "Run as administrator".
) else (
  echo.
  echo Done. The tablet and phone can now reach this laptop on ports 8443 and 8080.
)
echo.
pause
