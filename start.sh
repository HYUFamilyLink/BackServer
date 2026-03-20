#!/bin/bash

echo ""
echo "========================================"
echo "  FamilyLink Backend - 개발 서버 실행"
echo "========================================"
echo ""

# Docker 컨테이너 확인 및 실행
echo "Docker 컨테이너 확인 중..."
docker-compose up -d
echo ""

echo "  http://localhost:4000"
echo ""
npm run dev
