@echo off
echo.
echo ========================================
echo   FamilyLink Backend ^& AI - Dev Server
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

:: Start AI Server (새 창에서 5222 포트로 독립 실행)
echo Starting AI Server (FastAPI) on port 5222...
start "AI Server" cmd /k "cd ai-server && call venv\Scripts\activate && uvicorn main:app --host 0.0.0.0 --port 5222"
echo.

echo   Backend URL: http://localhost:4000
echo   AI Server URL: http://localhost:5222
echo.
npm run dev