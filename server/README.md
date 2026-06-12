# Vana'diel Reverie — Cloud Save API

Optional backend for accounts and cloud character saves (Phase 1 of `../todo.md`).
The game works fully without this — it just uses browser `localStorage`. Run this if
you want players to log in and sync their character across devices/browsers.

## Setup

```bash
cd server
npm install
cp .env.example .env
# edit .env: set JWT_SECRET to a random string, and CORS_ORIGIN to your game's URL
npm start          # listens on :8787 by default
```

Data is stored in a local SQLite file at `server/data/vanadiel.db` (created
automatically). For development, `npm run dev` restarts on file changes.

## Generating a JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## API

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| GET | `/api/health` | – | – | Health check |
| POST | `/api/auth/register` | – | `{ username, password, email? }` | Create an account, returns `{ token, username }` |
| POST | `/api/auth/login` | – | `{ username, password }` | Returns `{ token, username }` |
| GET | `/api/character` | Bearer | – | Returns `{ character }` (or `null` if none saved yet) |
| POST | `/api/character/save` | Bearer | character save object | Upserts the account's character |

## Pointing the game at this server

In the game's project root, set `VITE_API_URL` to this server's URL before building
(or in `.env.local` for `npm run dev`):

```
VITE_API_URL=https://your-server.example.com
```

If unset, the game never shows the login screen and runs purely on `localStorage` —
this is what the Vercel demo does.
