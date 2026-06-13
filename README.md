# FamilyLink - Backend

Node.js + Express 기반 백엔드 서버
Node.js 기반의 메인 API 및 Socket 서버와, 실시간 오디오 처리 및 음성 인식을 담당하는 Python FastAPI(AI Server)로 구성된 **MSA(Microservices Architecture) 형태의 멀티 서버 환경**을 갖춤.

* **실시간 양방향 통신 (Socket.IO):** 룸(Room) 상태 동기화, 턴(Turn) 기반 대기열 큐 로직, 이모지 및 애니메이션 이벤트 브로드캐스팅.
* **오디오 & 영상 동기화 제어:** Agora RTC 네트워크 지연(Latency) 통계를 바탕으로 프론트엔드의 YouTube MR 오프셋 조정을 위한 동기화 신호 중계.
* **AI 음성 인식 (VR 연동):** Python FastAPI와 OpenAI Whisper API를 활용하여 VR 기기에서 전송된 유저의 음성(마이크) 데이터를 텍스트로 변환 및 처리.
* **음원 분리 및 전처리 (Demucs):** `demucs` 및 `torch`를 활용한 업로드 음원(MR/보컬) 분리 및 `pydub`을 이용한 오디오 파일 포맷팅.
* **시스템 TTS 안내:** `google-tts-api`를 활용해 방 입장, 차례 안내 등의 시스템 공지를 음성(Audio Stream)으로 변환하여 실시간 브로드캐스트.
* **인메모리 대기열 시스템:** Redis를 활용하여 동시 접속 환경에서도 안전하고 빠른 턴(Turn) 대기열 및 방 참가자 상태 관리.

## 기술 스택

| 분류 | 기술 및 라이브러리 |
|------|------|
| **Main Server** | Node.js, Express, Socket.IO |
| **AI Server** | Python 3, FastAPI, Uvicorn |
| **RTC / Media** | **Agora RTC** (`agora-token` 발급), `google-tts-api` |
| **AI / Audio** | OpenAI Whisper, Demucs (Source Separation), PyTorch, PyDub |
| **Database** | PostgreSQL 16 (기본 데이터) |
| **In-Memory Cache** | Redis 7 (세션, 룸 상태, 턴 큐 관리) |
| **Infra & Storage** | Docker (DB/Redis), AWS S3 (`multer`, `form-data`) |

## 프로젝트 구조

```
ai-server/                  # 음성입력을 위한 uvcorn 서버
BackServer/
├── src/
│   ├── config/             # 설정
│   │   ├── database.js     # PostgreSQL 연결
│   │   └── redis.js        # Redis 연결
│   ├── controllers/        # 비즈니스 로직
│   ├── db/
│   │   └── schema.sql      # DB 스키마 (Docker 첫 실행 시 자동 적용)
│   ├── middleware/         # Express 미들웨어
│   ├── routes/             # API 라우트
│   ├── socket/             # Socket.IO 이벤트 핸들러
│   │   ├── handlers/
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
Python AI Server: http://0.0.0.0:5222
## 환경변수 (.env)

```env
# 서버
PORT=4000
NODE_ENV=development

# JWT & Database (반드시 변경)
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
DB_HOST=localhost
DB_PORT=5432
DB_NAME=familylink
DB_USER=postgres
DB_PASSWORD=your_db_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Agora RTC (마이크/보이스 통신용)
AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_agora_certificate

# AWS S3 (음원 업로드용)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-northeast-2
AWS_S3_BUCKET=familylink-songs

OPENAI_API_KEY=your_openai_api_key_here
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
