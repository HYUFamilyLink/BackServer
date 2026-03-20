require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./socket');
const { connectDB } = require('./config/database');
const { connectRedis } = require('./config/redis');
const { createMediasoupWorker } = require('./config/mediasoup');

const PORT = process.env.PORT || 4000;

async function bootstrap() {
  try {
    await connectDB();
    await connectRedis();
    await createMediasoupWorker();

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`[Server] FamilyLink backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

bootstrap();
