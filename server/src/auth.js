import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

const TOKEN_TTL = '30d';

export const router = Router();

const usernameOk = (s) => typeof s === 'string' && /^[a-zA-Z0-9_-]{3,20}$/.test(s);

router.post('/register', async (req, res) => {
  const { username, password, email } = req.body || {};
  if (!usernameOk(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, _ or -' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existing = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username is already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO accounts (username, password_hash, email) VALUES (?, ?, ?)'
  ).run(username, passwordHash, email || null);

  const token = jwt.sign({ accountId: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.status(201).json({ token, username });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  if (!account) return res.status(401).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password, account.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ accountId: account.id, username: account.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, username: account.username });
});

// middleware: verifies the Bearer token and attaches req.accountId
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Missing or invalid Authorization header' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.accountId = payload.accountId;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
