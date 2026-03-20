const mediasoup = require('mediasoup');

// Worker: mediasoup 프로세스 (CPU 코어 1개당 1개 권장)
let worker;

// Router: 1개의 방(Room)당 1개 할당
// roomId → router 매핑은 roomHandler에서 관리
const routers = new Map();

const mediaCodecs = [
  {
    kind:      'audio',
    mimeType:  'audio/opus',
    clockRate: 48000,
    channels:  2,
  },
];

async function createMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT) || 40000,
    rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT) || 49999,
  });

  worker.on('died', () => {
    console.error('[mediasoup] Worker died, restarting process');
    process.exit(1);
  });

  console.log('[mediasoup] Worker created');
}

async function createRouter(roomId) {
  const router = await worker.createRouter({ mediaCodecs });
  routers.set(roomId, router);
  return router;
}

function getRouter(roomId) {
  return routers.get(roomId);
}

function deleteRouter(roomId) {
  const router = routers.get(roomId);
  if (router) {
    router.close();
    routers.delete(roomId);
  }
}

module.exports = {
  createMediasoupWorker,
  createRouter,
  getRouter,
  deleteRouter,
};
