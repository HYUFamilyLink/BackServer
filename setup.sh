#!/bin/bash

echo ""
echo "========================================"
echo "  FamilyLink Backend - 환경 설치"
echo "========================================"
echo ""

# Node.js 설치 확인
if ! command -v node &> /dev/null; then
    echo "[오류] Node.js가 설치되어 있지 않습니다."
    echo "https://nodejs.org 에서 설치 후 다시 실행해주세요."
    exit 1
fi

# Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "[오류] Docker가 설치되어 있지 않습니다."
    echo "https://www.docker.com 에서 설치 후 다시 실행해주세요."
    exit 1
fi

echo "[1/4] Node.js, Docker 확인 완료"
echo ""

# .env 파일 생성
if [ ! -f ".env" ]; then
    echo "[2/4] .env 파일 생성 중..."
    cp .env.example .env
    echo "      .env 파일이 생성되었습니다."
    echo "      [필수] .env 파일을 열어 JWT_SECRET, DB_PASSWORD 값을 변경하세요."
else
    echo "[2/4] .env 파일이 이미 존재합니다. 건너뜀."
fi
echo ""

# npm install
echo "[3/4] 패키지 설치 중..."
npm install axios
echo ""

# Docker 실행
echo "[4/4] Docker 컨테이너 시작 중 (PostgreSQL + Redis)..."
docker-compose up -d
echo ""

echo "========================================"
echo "  설치 완료!"
echo "========================================"
echo ""
echo "  [필수] .env 파일에서 JWT_SECRET, DB_PASSWORD를 반드시 변경하세요."
echo ""
echo "  개발 서버 실행: ./start.sh"
echo ""
