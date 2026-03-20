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

echo   http://localhost:4000
echo.
npm run dev
