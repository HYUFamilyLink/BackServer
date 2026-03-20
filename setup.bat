@echo off
echo.
echo ========================================
echo   FamilyLink Backend - Setup
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install it from https://nodejs.org
    pause
    exit /b 1
)

:: Check Docker
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed.
    echo Please install it from https://www.docker.com
    pause
    exit /b 1
)

echo [1/4] Node.js and Docker OK
echo.

:: Create .env file
if not exist ".env" (
    echo [2/4] Creating .env file...
    copy ".env.example" ".env" > nul
    echo       .env file created.
    echo       [REQUIRED] Open .env and change JWT_SECRET and DB_PASSWORD
) else (
    echo [2/4] .env already exists. Skipping.
)
echo.

:: npm install
echo [3/4] Installing packages...
npm install
echo.

:: Start Docker
echo [4/4] Starting Docker containers (PostgreSQL + Redis)...
docker-compose up -d
echo.

echo ========================================
echo   Setup complete!
echo ========================================
echo.
echo   [REQUIRED] Edit .env and change JWT_SECRET and DB_PASSWORD
echo.
echo   To start dev server: start.bat
echo.
pause
