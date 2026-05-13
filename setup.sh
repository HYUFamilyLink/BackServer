@echo off
echo.
echo ========================================
echo   FamilyLink Backend ^& AI - Setup
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

:: Check Python (AI 서버용)
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed.
    echo Please install it from https://www.python.org
    pause
    exit /b 1
)

echo [1/5] Node.js, Docker, and Python OK
echo.

:: Create .env file
if not exist ".env" (
    echo [2/5] Creating .env file...
    copy ".env.example" ".env" > nul
    echo       .env file created.
    echo       [REQUIRED] Open .env and change JWT_SECRET and DB_PASSWORD
) else (
    echo [2/5] .env already exists. Skipping.
)
echo.

:: npm install
echo [3/5] Installing Node packages...
call npm install
call npm install axios form-data agora-token multer
echo.

:: Python AI Server Setup
echo [4/5] Setting up Python AI Server...
if not exist "ai-server" mkdir "ai-server"
cd ai-server
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)
echo Installing Python packages...
call venv\Scripts\activate
pip install fastapi uvicorn python-multipart openai-whisper demucs torch
cd ..
echo.

:: Start Docker
echo [5/5] Starting Docker containers (PostgreSQL + Redis)...
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