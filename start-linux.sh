#!/bin/bash

echo ""
echo "========================================"
echo "  FamilyLink Backend & AI - Dev Server"
echo "========================================"
echo ""

# Start Docker containers
echo "Starting Docker containers..."
sudo systemctl stop redis 2>/dev/null || true
sudo docker-compose up -d
echo ""

# Wait for PostgreSQL
echo "Waiting for PostgreSQL to be ready..."
sleep 5

# Start AI Server via pm2
echo "Starting AI Server (FastAPI) on port 5222..."
cd ai-server
source venv/bin/activate
pm2 start "uvicorn main:app --host 0.0.0.0 --port 5222" --name ai-server --interpreter none
deactivate
cd ..
echo ""

echo "  Backend URL:   http://localhost:4000"
echo "  AI Server URL: http://localhost:5222"
echo ""

# Start Node.js backend via pm2
pm2 start src/server.js --name familylink
pm2 save

echo ""
echo "  pm2 logs familylink   <- 백엔드 로그"
echo "  pm2 logs ai-server    <- AI 서버 로그"
echo ""
