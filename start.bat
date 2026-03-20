@echo off
echo.
echo ========================================
echo   FamilyLink Backend - Dev Server
echo ========================================
echo.

:: Start Docker containers
echo Starting Docker containers...
docker-compose up -d
echo.

:: Wait for PostgreSQL to be ready
echo Waiting for PostgreSQL to be ready...
timeout /t 5 /nobreak > nul
echo.

echo   http://localhost:4000
echo.
npm run dev
