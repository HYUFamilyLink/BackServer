-- =============================================
-- FamilyLink VR Karaoke — DB Schema
-- =============================================

-- 유저
CREATE TABLE IF NOT EXISTS users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(32) UNIQUE NOT NULL,  -- 로그인 아이디 겸 표시 이름 (예: 김순자, 김순자A)
  pin        VARCHAR(128) NOT NULL,        -- 4자리 생년월일 (bcrypt 등으로 암호화 저장 권장)
  role       VARCHAR(8)  NOT NULL DEFAULT 'phone'  
                         CHECK (role IN ('vr', 'phone')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friends (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID        NOT NULL REFERENCES users(id),
  receiver_id  UUID        NOT NULL REFERENCES users(id),
  status       VARCHAR(16) NOT NULL DEFAULT 'pending' 
                           CHECK (status IN ('pending', 'accepted')),
  UNIQUE(requester_id, receiver_id)
);
-- 노래 목록 (YouTube 메타데이터)
CREATE TABLE IF NOT EXISTS songs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   VARCHAR(32) UNIQUE NOT NULL,          -- YouTube videoId
  title      VARCHAR(256) NOT NULL,
  artist     VARCHAR(128) NOT NULL,
  thumbnail  TEXT,                                  -- YouTube 썸네일 URL
  duration   INTEGER,                              -- 초 단위
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 방
CREATE TABLE IF NOT EXISTS rooms (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code  VARCHAR(8)  UNIQUE NOT NULL,           -- 참여 코드 (6자리)
  host_id    UUID        NOT NULL REFERENCES users(id),
  status     VARCHAR(16) NOT NULL DEFAULT 'waiting'
                         CHECK (status IN ('waiting', 'singing', 'result', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at  TIMESTAMPTZ
);

-- 노래 큐 (방별 신청 목록)
CREATE TABLE IF NOT EXISTS queue_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  song_id      UUID        NOT NULL REFERENCES songs(id),
  requested_by UUID        NOT NULL REFERENCES users(id),
  position     INTEGER     NOT NULL,               -- 재생 순서
  played       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 세션 점수
CREATE TABLE IF NOT EXISTS scores (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id),
  song_id    UUID        NOT NULL REFERENCES songs(id),
  score      INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_rooms_join_code    ON rooms(join_code);
CREATE INDEX IF NOT EXISTS idx_queue_room_id      ON queue_items(room_id, position);
CREATE INDEX IF NOT EXISTS idx_scores_room_id     ON scores(room_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_friend_pair 
ON friends (LEAST(requester_id, receiver_id), GREATEST(requester_id, receiver_id));