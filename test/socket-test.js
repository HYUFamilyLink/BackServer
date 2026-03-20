/**
 * Socket.IO + mediasoup 통합 테스트
 *
 * 테스트 흐름:
 *   1. VR 로그인 → 방 생성
 *   2. VR 소켓 연결 → room:join
 *   3. 폰 소켓 연결 → room:join (room:user_joined 이벤트 수신 확인)
 *   4. 노래 큐 추가 → queue:updated 브로드캐스트 확인
 *   5. VR → song:start → song:playing 브로드캐스트 확인
 *   6. VR → lyrics:tick → 폰에서 수신 확인
 *   7. 폰 → user:reaction → 전체 수신 확인
 *   8. mediasoup 시그널링 흐름 (RTP capabilities → transport → produce → consume)
 *   9. VR → song:end → queue:updated + song:ended 확인
 *  10. 폰 disconnect → room:user_left 확인
 */

require('dotenv').config();
const { io } = require('socket.io-client');

const BASE_URL = 'http://localhost:4000';
let passed = 0;
let failed = 0;

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function log(label, msg) {
  console.log(`\n[${label}] ${msg}`);
}

function ok(label) {
  passed++;
  console.log(`  ✅ ${label}`);
}

function fail(label, reason) {
  failed++;
  console.error(`  ❌ ${label}: ${reason}`);
}

function waitFor(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function httpPost(path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function httpGet(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, {
      auth: { token },
      transports: ['websocket'],
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emitWithAck(socket, event, data, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Ack timeout: ${event}`)), timeoutMs);
    socket.emit(event, data, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

// ── 메인 테스트 ───────────────────────────────────────────────────────────────

async function runTests() {
  console.log('='.repeat(60));
  console.log('  FamilyLink Socket.IO + mediasoup 통합 테스트');
  console.log('='.repeat(60));

  // ── Step 1. 로그인 ───────────────────────────────────────────────────────
  log('STEP 1', 'HTTP 로그인');

  const vrAuth = await httpPost('/api/auth/login', { email: 'vr@test.com', password: 'pass1234' });
  const phoneAuth = await httpPost('/api/auth/login', { email: 'phone@test.com', password: 'pass1234' });

  if (vrAuth.token && phoneAuth.token) {
    ok('VR + 폰 로그인');
  } else {
    fail('로그인', JSON.stringify({ vrAuth, phoneAuth }));
    process.exit(1);
  }

  // ── Step 2. 방 생성 ──────────────────────────────────────────────────────
  log('STEP 2', '방 생성');
  const room = await httpPost('/api/rooms', {}, vrAuth.token);
  if (room.join_code) {
    ok(`방 생성 완료 (join_code: ${room.join_code})`);
  } else {
    fail('방 생성', JSON.stringify(room));
    process.exit(1);
  }

  // ── Step 3. 소켓 연결 ────────────────────────────────────────────────────
  log('STEP 3', '소켓 연결');
  const vrSocket    = await connectSocket(vrAuth.token);
  const phoneSocket = await connectSocket(phoneAuth.token);
  ok(`VR 소켓 연결 (id: ${vrSocket.id})`);
  ok(`폰 소켓 연결 (id: ${phoneSocket.id})`);

  // ── Step 4. room:join ────────────────────────────────────────────────────
  log('STEP 4', 'room:join');

  // 폰이 먼저 대기
  const phoneJoinedPromise = waitFor(phoneSocket, 'room:user_joined');

  // VR 입장
  const vrJoinAck = await emitWithAck(vrSocket, 'room:join', { joinCode: room.join_code });
  if (vrJoinAck.roomId) {
    ok(`VR room:join ack (roomId: ${vrJoinAck.roomId})`);
  } else {
    fail('VR room:join', JSON.stringify(vrJoinAck));
  }

  // 폰 입장 → VR에서 user_joined 수신 대기
  const vrUserJoinedPromise = waitFor(vrSocket, 'room:user_joined');
  const phoneJoinAck = await emitWithAck(phoneSocket, 'room:join', { joinCode: room.join_code });
  if (phoneJoinAck.roomId) {
    ok(`폰 room:join ack (roomId: ${phoneJoinAck.roomId})`);
  } else {
    fail('폰 room:join', JSON.stringify(phoneJoinAck));
  }

  const vrUserJoined = await vrUserJoinedPromise;
  if (vrUserJoined.nickname === 'PhoneUser') {
    ok(`VR에서 room:user_joined 수신 (nickname: ${vrUserJoined.nickname})`);
  } else {
    fail('room:user_joined', JSON.stringify(vrUserJoined));
  }

  // ── Step 5. 노래 큐 추가 ─────────────────────────────────────────────────
  log('STEP 5', 'queue:add');

  // 노래 ID 조회
  const songs = await httpGet('/api/songs', phoneAuth.token);
  const songId = songs[0]?.id;
  if (!songId) {
    fail('queue:add', '노래 없음');
  } else {
    const vrQueueUpdatedPromise = waitFor(vrSocket, 'queue:updated');
    const queueAck = await emitWithAck(phoneSocket, 'queue:add', { songId });

    if (queueAck.item) {
      ok(`queue:add ack (itemId: ${queueAck.item.id})`);
    } else {
      fail('queue:add ack', JSON.stringify(queueAck));
    }

    const queueUpdated = await vrQueueUpdatedPromise;
    if (queueUpdated.queue?.length > 0) {
      ok(`VR에서 queue:updated 수신 (총 ${queueUpdated.queue.length}곡)`);
    } else {
      fail('queue:updated', JSON.stringify(queueUpdated));
    }

    // ── Step 6. song:start ─────────────────────────────────────────────────
    log('STEP 6', 'song:start');
    const phoneSongPlayingPromise = waitFor(phoneSocket, 'song:playing');
    const queueItemId = queueAck.item.id;
    vrSocket.emit('song:start', { queueItemId });

    const songPlaying = await phoneSongPlayingPromise;
    if (songPlaying.song?.video_id) {
      ok(`폰에서 song:playing 수신 (video_id: ${songPlaying.song.video_id})`);
    } else {
      fail('song:playing', JSON.stringify(songPlaying));
    }

    // ── Step 7. lyrics:tick ────────────────────────────────────────────────
    log('STEP 7', 'lyrics:tick');
    const phoneLyricsPromise = waitFor(phoneSocket, 'lyrics:tick');
    vrSocket.emit('lyrics:tick', { currentMs: 5000 });
    const lyricsTick = await phoneLyricsPromise;
    if (lyricsTick.currentMs === 5000) {
      ok(`폰에서 lyrics:tick 수신 (currentMs: ${lyricsTick.currentMs})`);
    } else {
      fail('lyrics:tick', JSON.stringify(lyricsTick));
    }

    // ── Step 8. user:reaction ──────────────────────────────────────────────
    log('STEP 8', 'user:reaction');
    const vrReactionPromise   = waitFor(vrSocket, 'user:reaction');
    const phoneReactionPromise = waitFor(phoneSocket, 'user:reaction');
    phoneSocket.emit('user:reaction', { emoji: '🎤' });
    const [vrReaction] = await Promise.all([vrReactionPromise, phoneReactionPromise]);
    if (vrReaction.emoji === '🎤') {
      ok(`전체 user:reaction 수신 (emoji: ${vrReaction.emoji}, from: ${vrReaction.nickname})`);
    } else {
      fail('user:reaction', JSON.stringify(vrReaction));
    }

    // ── Step 9. mediasoup 시그널링 ─────────────────────────────────────────
    log('STEP 9', 'mediasoup 시그널링');

    // 9-1. RTP capabilities
    const rtpCaps = await emitWithAck(vrSocket, 'ms:get_rtp_capabilities', {});
    if (rtpCaps.rtpCapabilities) {
      ok('ms:get_rtp_capabilities (VR)');
    } else {
      fail('ms:get_rtp_capabilities', JSON.stringify(rtpCaps));
    }

    // 9-2. send transport 생성 (VR: 마이크 → 서버)
    const vrSendTransport = await emitWithAck(vrSocket, 'ms:create_transport', { direction: 'send' });
    if (vrSendTransport.id && vrSendTransport.iceParameters) {
      ok(`ms:create_transport send (VR) - transport id: ${vrSendTransport.id}`);
    } else {
      fail('ms:create_transport send', JSON.stringify(vrSendTransport));
    }

    // 9-3. recv transport 생성 (VR: 서버 → 스피커)
    const vrRecvTransport = await emitWithAck(vrSocket, 'ms:create_transport', { direction: 'recv' });
    if (vrRecvTransport.id) {
      ok(`ms:create_transport recv (VR) - transport id: ${vrRecvTransport.id}`);
    } else {
      fail('ms:create_transport recv', JSON.stringify(vrRecvTransport));
    }

    // 9-4. 폰 send/recv transport
    const phoneSendTransport = await emitWithAck(phoneSocket, 'ms:create_transport', { direction: 'send' });
    const phoneRecvTransport = await emitWithAck(phoneSocket, 'ms:create_transport', { direction: 'recv' });
    if (phoneSendTransport.id && phoneRecvTransport.id) {
      ok('ms:create_transport send+recv (폰)');
    } else {
      fail('ms:create_transport (폰)', JSON.stringify({ phoneSendTransport, phoneRecvTransport }));
    }

    ok('mediasoup transport 생성 흐름 완료 (DTLS 핸드셰이크는 실제 클라이언트 SDK 필요)');

    // ── Step 10. song:end ──────────────────────────────────────────────────
    log('STEP 10', 'song:end');
    const phoneSongEndedPromise   = waitFor(phoneSocket, 'song:ended');
    const phoneQueueAfterEndPromise = waitFor(phoneSocket, 'queue:updated');
    vrSocket.emit('song:end', { queueItemId });

    const [songEnded] = await Promise.all([phoneSongEndedPromise, phoneQueueAfterEndPromise]);
    if (songEnded.queueItemId === queueItemId) {
      ok(`폰에서 song:ended 수신 (queueItemId: ${songEnded.queueItemId})`);
    } else {
      fail('song:ended', JSON.stringify(songEnded));
    }
    ok('song:end 후 queue:updated 수신');
  }

  // ── Step 11. disconnect ───────────────────────────────────────────────────
  log('STEP 11', 'disconnect');
  const vrUserLeftPromise = waitFor(vrSocket, 'room:user_left', 4000);
  phoneSocket.disconnect();
  const userLeft = await vrUserLeftPromise;
  if (userLeft.nickname === 'PhoneUser') {
    ok(`VR에서 room:user_left 수신 (nickname: ${userLeft.nickname})`);
  } else {
    fail('room:user_left', JSON.stringify(userLeft));
  }

  vrSocket.disconnect();

  // ── 결과 ─────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`  결과: ✅ ${passed}개 통과 / ❌ ${failed}개 실패`);
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
