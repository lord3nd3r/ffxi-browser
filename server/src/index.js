import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { router as authRouter } from './auth.js';
import { router as characterRouter } from './character.js';

const app = express();
const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(cors({ origin: ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/character', characterRouter);

app.listen(PORT, () => {
  console.log(`Vana'diel Reverie API listening on :${PORT}`);
});
