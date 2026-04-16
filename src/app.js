require("dotenv").config();

const express = require('express');
const cors    = require('cors');

const authRoutes  = require('./routes/auth');
const roomRoutes  = require('./routes/rooms');
const songRoutes  = require('./routes/songs');
const agoraRoutes = require('./routes/agora');
const friendsRouter = require('./routes/friends');
const sttRouter = require("./routes/stt");
const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',  authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/agora', agoraRoutes);
app.use('/api/friends', friendsRouter);
app.use("/api/stt", sttRouter);
module.exports = app;
