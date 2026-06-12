import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { Server as SocketServer } from 'socket.io';
import { router as authRouter } from './auth.js';
import { router as characterRouter } from './character.js';
import { initChat } from './chat.js';

const app = express();
const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/character', characterRouter);

// Attach Socket.IO to the same HTTP server
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: ORIGIN, methods: ['GET', 'POST'] },
});

initChat(io);

httpServer.listen(PORT, () => {
  console.log(`Vana'diel Reverie API + WebSocket listening on :${PORT}`);
});
