const { getRouter } = require('../../config/mediasoup');

/**
 * mediasoup WebRTC 시그널링 핸들러
 *
 * 연결 흐름 (1:1 기준)
 *   1. 클라이언트 → ms:get_rtp_capabilities  → RTP 코덱 정보 수신
 *   2. 클라이언트 → ms:create_transport       → WebRTC transport 생성
 *   3. 클라이언트 → ms:connect_transport      → DTLS 파라미터 전달 (연결 확립)
 *   4. 보내는 쪽  → ms:produce               → 오디오 트랙 발행
 *   5. 받는 쪽   → ms:consume               → 발행된 오디오 구독
 *
 * transport는 방향별로 2개:
 *   sendTransport  : 마이크 → 서버
 *   recvTransport  : 서버 → 스피커
 */
module.exports = function mediasoupHandler(io, socket) {

  // ── 1. RTP Capabilities ─────────────────────────────────────────────────
  socket.on('ms:get_rtp_capabilities', (_, ack) => {
    const router = getRouter(socket.roomId);
    if (!router) return ack?.({ error: 'No router for this room' });
    ack?.({ rtpCapabilities: router.rtpCapabilities });
  });

  // ── 2. Transport 생성 ───────────────────────────────────────────────────
  socket.on('ms:create_transport', async ({ direction } = {}, ack) => {
    // direction: 'send' | 'recv'
    const router = getRouter(socket.roomId);
    if (!router) return ack?.({ error: 'No router for this room' });

    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [
          {
            ip:          process.env.MEDIASOUP_LISTEN_IP    || '0.0.0.0',
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
          },
        ],
        enableUdp:    true,
        enableTcp:    true,
        preferUdp:    true,
      });

      // transport를 socket에 저장
      if (!socket.transports) socket.transports = {};
      socket.transports[direction] = transport;

      ack?.({
        id:             transport.id,
        iceParameters:  transport.iceParameters,
        iceCandidates:  transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      console.error('[mediasoupHandler] create_transport error', err);
      ack?.({ error: 'Failed to create transport' });
    }
  });

  // ── 3. Transport 연결 (DTLS 핸드셰이크) ────────────────────────────────
  socket.on('ms:connect_transport', async ({ direction, dtlsParameters } = {}, ack) => {
    const transport = socket.transports?.[direction];
    if (!transport) return ack?.({ error: 'Transport not found' });

    try {
      await transport.connect({ dtlsParameters });
      ack?.({ ok: true });
    } catch (err) {
      console.error('[mediasoupHandler] connect_transport error', err);
      ack?.({ error: 'Failed to connect transport' });
    }
  });

  // ── 4. Produce (마이크 → 서버) ──────────────────────────────────────────
  socket.on('ms:produce', async ({ rtpParameters, kind } = {}, ack) => {
    const transport = socket.transports?.['send'];
    if (!transport) return ack?.({ error: 'Send transport not found' });

    try {
      const producer = await transport.produce({ kind, rtpParameters });
      socket.producerId = producer.id;

      // 같은 방 다른 사람들에게 새 producer 알림 → 구독(consume) 시작 유도
      socket.to(socket.roomId).emit('ms:new_producer', {
        producerId: producer.id,
        userId:     socket.user.id,
        nickname:   socket.user.nickname,
      });

      ack?.({ producerId: producer.id });
    } catch (err) {
      console.error('[mediasoupHandler] produce error', err);
      ack?.({ error: 'Failed to produce' });
    }
  });

  // ── 5. Consume (서버 → 스피커) ──────────────────────────────────────────
  socket.on('ms:consume', async ({ producerId, rtpCapabilities } = {}, ack) => {
    const router    = getRouter(socket.roomId);
    const transport = socket.transports?.['recv'];
    if (!router || !transport) return ack?.({ error: 'Not ready' });

    try {
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        return ack?.({ error: 'Cannot consume' });
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false,
      });

      ack?.({
        consumerId:    consumer.id,
        producerId,
        kind:          consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error('[mediasoupHandler] consume error', err);
      ack?.({ error: 'Failed to consume' });
    }
  });

  // ── Disconnect 정리 ─────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (socket.transports) {
      Object.values(socket.transports).forEach((t) => t.close());
    }
  });
};
