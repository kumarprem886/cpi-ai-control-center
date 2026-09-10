@echo off
echo === Building React frontend ===
cd FrontEnd
call npm install
call npm run build
if errorlevel 1 (echo Frontend build failed & exit /b 1)

echo === Copying dist to BackEnd\public ===
cd ..
if exist BackEnd\public rmdir /s /q BackEnd\public
xcopy /E /I /Y FrontEnd\dist BackEnd\public

echo === Pushing to SAP BTP Cloud Foundry ===
cd BackEnd
cf push

echo === Done! ===
