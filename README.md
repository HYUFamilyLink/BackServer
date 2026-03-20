# FamilyLink - Backend

Node.js + Express 기반 백엔드 서버

## 기술 스택

| 기술 | 용도 |
|------|------|
| Node.js + Express | HTTP API 서버 |
| Socket.IO | 실시간 통신 |
| mediasoup | WebRTC 미디어 서버 |
| PostgreSQL 16 | 데이터베이스 |
| Redis 7 | 세션/캐시 |
| JWT | 인증 |
| AWS S3 | 노래 파일 저장 |

## 프로젝트 구조

```
BackServer/
├── src/
│   ├── config/             # 설정
│   │   ├── database.js     # PostgreSQL 연결
│   │   ├── redis.js        # Redis 연결
│   │   └── mediasoup.js    # WebRTC Worker 설정
│   ├── controllers/        # 비즈니스 로직
│   │   ├── authController.js
│   │   ├── roomController.js
│   │   └── songController.js
│   ├── db/
│   │   └── schema.sql      # DB 스키마 (Docker 첫 실행 시 자동 적용)
│   ├── middleware/         # Express 미들웨어
│   ├── routes/             # API 라우트
│   │   ├── auth.js
│   │   ├── rooms.js
│   │   └── songs.js
│   ├── socket/             # Socket.IO 이벤트 핸들러
│   │   ├── handlers/
│   │   │   ├── roomHandler.js
│   │   │   ├── mediasoupHandler.js
│   │   │   ├── queueHandler.js
│   │   │   └── lyricsHandler.js
│   │   └── index.js
│   ├── app.js
│   └── server.js           # 엔트리포인트
├── test/
├── docker-compose.yml      # PostgreSQL + Redis
├── .env                    # 환경변수 (직접 생성)
└── .env.example            # 환경변수 템플릿
```

## 설치 및 실행

**Windows**
```bat
setup.bat   # 최초 1회
start.bat   # 매번 실행
```

**Mac / Linux**
```bash
chmod +x setup.sh start.sh
./setup.sh  # 최초 1회
./start.sh  # 매번 실행
```

서버: http://localhost:4000

## 환경변수 (.env)

```env
# 서버
PORT=4000
NODE_ENV=development

# JWT (반드시 변경)
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=familylink
DB_USER=postgres
DB_PASSWORD=your_db_password   # 반드시 변경

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# mediasoup (WebRTC)
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1   # 배포 시 실제 서버 IP로 변경

# AWS S3 (노래 파일 저장 시 필요)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-northeast-2
AWS_S3_BUCKET=familylink-songs
```

## 사용 가능한 명령어

```bash
npm run dev     # 개발 서버 실행 (nodemon)
npm start       # 프로덕션 서버 실행
npm test        # 테스트 실행
```

## API 라우트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /api/auth/... | 회원가입, 로그인 |
| GET/POST | /api/rooms/... | 룸 목록, 생성 |
| GET/POST | /api/songs/... | 노래 목록, 업로드 |

## Docker (DB)

```bash
# 컨테이너 시작
docker-compose up -d

# 컨테이너 중지
docker-compose down

# 데이터 포함 전체 삭제
docker-compose down -v
```
