#!/bin/bash

echo ""
echo "========================================"
echo "  FamilyLink Backend & AI - Setup"
echo "========================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    echo "Run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed."
    echo "Run: sudo apt install -y docker.io docker-compose"
    exit 1
fi

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 is not installed."
    echo "Run: sudo apt install -y python3 python3-venv python3-pip"
    exit 1
fi

echo "[1/5] Node.js, Docker, Python OK"
echo ""

# Create .env file
if [ ! -f ".env" ]; then
    echo "[2/5] Creating .env file..."
    cp .env.example .env
    echo "      .env file created."
    echo "      [REQUIRED] Edit .env and change JWT_SECRET and DB_PASSWORD"
else
    echo "[2/5] .env already exists. Skipping."
fi
echo ""

# npm install
echo "[3/5] Installing Node packages..."
npm install
npm install axios form-data agora-token multer
echo ""

# Python AI Server Setup
echo "[4/5] Setting up Python AI Server..."
mkdir -p ai-server
cd ai-server
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi
echo "Installing Python packages..."
source venv/bin/activate
pip install fastapi uvicorn python-multipart openai-whisper demucs torch pydub
deactivate
cd ..
echo ""

# Start Docker
echo "[5/5] Starting Docker containers (PostgreSQL + Redis)..."
sudo systemctl stop redis 2>/dev/null || true
sudo docker-compose up -d
echo ""

echo "========================================"
echo "  Setup complete!"
echo "========================================"
echo ""
echo "  [REQUIRED] Edit .env and change JWT_SECRET and DB_PASSWORD"
echo ""
echo "  To start dev server: bash start-linux.sh"
echo ""
