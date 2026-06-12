# MMORPG Transition Roadmap: Vana'diel Reverie

This checklist outlines the progressive phases required to convert the single-player, client-authoritative game into a true, server-authoritative multiplayer MMORPG.

---

## 🛠️ Phase 1: Accounts, Database & Cloud Saves ✅ DONE
*Goal: Move player save data from client-side `localStorage` to a centralized database.*

- [x] **Set up Server Directory Architecture**
  - Created `/server` (Node ESM project) with `src/index.js`, `src/db.js`, `src/auth.js`, `src/character.js`.
  - Installed `express`, `better-sqlite3`, `bcryptjs`, `jsonwebtoken`, `dotenv`, `cors`.
  - Used **SQLite** instead of Postgres/Mongo — zero external services to stand up on a VPS, single file at `server/data/vanadiel.db`. Swapping to Postgres later is a small change confined to `db.js` since the rest of the code talks to it via prepared statements.
- [x] **Configure the Database**
  - `accounts`: `id`, `username`, `password_hash`, `email`, `created_at`.
  - `characters`: `id`, `account_id` (unique FK), `name`, `current_job`, `gil`, `jobs_json`, `inventory_json`, `equipment_json`, `quests_json`, `appearance_json`, `recruited_json`, `auto_magic_json`, `boss_down`, `hp`, `mp`, `pos_x`, `pos_z`, `updated_at`. One character per account for now.
- [x] **Build the Auth API Endpoint Routes**
  - `POST /api/auth/register`, `POST /api/auth/login` — bcrypt hashing, JWT (30-day expiry) in `server/src/auth.js`.
- [x] **Build the Character Save/Load API Route**
  - `GET /api/character`, `POST /api/character/save` (both require `Authorization: Bearer <jwt>`) in `server/src/character.js`.
- [x] **Refactor Client Save/Load Hook**
  - `src/api.js` — thin fetch client (register/login/fetchCharacter/saveCharacter, token in localStorage).
  - `src/game.js` `saveGame()` still writes to `localStorage` first (instant, offline-safe), then throttled-syncs to the cloud (min 15s between syncs, `force`/`keepalive` on character-creation and tab-close).
  - `src/ui.js` adds `loginScreen()` (Log In / Register / Play Offline) and `charCreate()` now shows **Log Out** for cloud accounts.
  - Entirely opt-in: if `VITE_API_URL` isn't set (as on the Vercel demo), the game behaves exactly as before — pure `localStorage`, no login screen.
  - **Still open**: no "New Character" reset for cloud accounts (would need a `DELETE /api/character` route) and no migration path to copy an existing local save into a freshly-created cloud account.

---

## 💬 Phase 2: WebSockets & Spatial Chat
*Goal: Introduce real-time communication and chat filtering based on player coordinates.*

- [x] **Set up Socket Server Infrastructure**
  - Installed `socket.io` in server. Refactored `server/src/index.js` to use `http.createServer()` so Socket.IO shares the same port as the REST API.
  - Created `server/src/chat.js` — JWT auth on connect, in-memory player registry tracking `charName`, `x`, `z` per socket.
- [x] **Establish Socket Client Connection**
  - Installed `socket.io-client` in the Vite project.
  - Created `src/socket.js` — thin client module (connect with JWT, enter, throttled position updates at 4Hz, sendChat helper).
  - Wired into `src/main.js`: after `startGame()`, if logged in, connects WebSocket, emits `player:enter`, starts position updates, listens for `chat:message` and `player:count`.
- [x] **Create Real-Time Chat Channels**
  - Server handles `chat:say` (spatial, 20-unit radius), `chat:shout` (global broadcast), `chat:party` (echo to self — stub until server-side party system).
  - Refactored `src/ui.js` `submitChat()` to parse `/say`, `/sh`/`/shout`, `/p`/`/party` prefixes and route through Socket. Bare text defaults to `/say`. Local commands like `/sit` still work.
  - Falls back to original offline local echo + NPC flavor responses when not connected.
  - Added CSS colors: `.shout` (golden-orange `#ffb347`), `.party-chat` (sky-blue `#74c0fc`).
  - Added `<span id="player-count">` in the minimap panel + `updatePlayerCount()` in UI.
- [ ] **Friends List**
  - New table `friendships` (`account_id`, `friend_account_id`, `status`: pending/accepted) in `server/src/db.js`.
  - API routes: `POST /api/friends/request`, `POST /api/friends/accept`, `GET /api/friends` (returns friends + their online status by checking the server's active-socket directory).
  - Server tracks online accounts (from Phase 3's player directory) and pushes presence changes to friends over the socket.
  - Client: a Friends panel in [ui.js](file:///home/ender/ffxi-browser/src/ui.js) listing friends with online/offline indicator; `/tell <name>` routes to a friend by character name globally (not just same-zone), looked up via the server's directory rather than spatial filtering.

---

## 🏃 Phase 3: Synchronized Multiplayer Movement ✅ DONE
*Goal: Track other players online and show them moving smoothly.*

- [x] **Implement Server-Side Player Directory**
  - Maintain an in-memory list of active connections, tracking: `socketId`, `characterName`, `coordinates (x, y, z)`, `heading`, `appearance`.
- [x] **Establish Movement Broadcast Loop**
  - Have the client send position updates (coordinates & rotation) to the server during movement ticks in [game.js](file:///home/ender/ffxi-browser/src/game.js#L995) `updatePlayer()`.
  - Rate-limit updates (e.g., 20hz / every 50ms) to conserve bandwidth.
  - Broadcaster on server relays position changes of moving players to all other connected clients in the same area.
- [x] **Render Other Players (Puppets) on Client**
  - Refactor [entities.js](file:///home/ender/ffxi-browser/src/entities.js) to support assembling and managing mesh objects for other players.
  - Draw these players inside [state.js](file:///home/ender/ffxi-browser/src/state.js) under a new collection (e.g., `S.otherPlayers`).
- [x] **Implement Client-Side Interpolation**
  - Because update packets arrive with network latency, do not jump characters immediately to new coords.
  - Write a lerping interpolation routine in the client loop to slide other players smoothly between their last known coordinate and their target coordinate.

---

## ⚔️ Phase 4: Authoritative Combat & Simulation ✅ DONE
*Goal: Move all game rules, damage, spawning, and logic to the server. The client becomes a renderer.*

- [x] **Implement Authoritative Server Tick Loop**
  - Create a main world loop on the backend running at 20-30 ticks per second.
  - Manage monster spawn coordinates and intervals on the server instead of the local spawn list in [game.js](file:///home/ender/ffxi-browser/src/game.js#L178).
- [x] **Migrate Pathfinding & Monster AI**
  - Run monster aggro checks, chasing states, and wandering timers on the server.
  - Stream monster positions and animations (e.g. death, attack, idle) to clients.
- [x] **Authoritative Combat Calculations**
  - Server manages ability cooldown logs, MP/TP check validation, and range checks.
  - Re-locate formulas for [meleeSwing](file:///home/ender/ffxi-browser/src/game.js#L281), [applyDamage](file:///home/ender/ffxi-browser/src/game.js#L281), and quest progression to the backend.
  - Client actions like pressing hotbars emit a request (e.g. `use_ability`). The server processes, updates stats, and emits event packets back (e.g. `spell_cast_success`, `damage_applied`).
- [x] **Synchronized Loot & Gathering**
  - Make gathering nodes ([updateNodes](file:///home/ender/ffxi-browser/src/game.js#L1191)) shareable. If a player harvests a node, the server marks it unavailable and broadcasts the visual update to everyone nearby.
  - Server rolls for loot drops on monster deaths and appends the item to the inventory in the database.

---

## ✨ Phase 5: Combat & Spell Visual Polish
*Goal: Make hits, casts, and effects read clearly at a glance. Independent of the multiplayer work above — can be done anytime, single-player or not.*

- [ ] **Per-element spell effects**
  - Today [tryAction](file:///home/ender/ffxi-browser/src/game.js#L548) plays a generic `Spellcast_Shoot` animation for all WHM/BLM spells and reuses one particle burst ([G.particles](file:///home/ender/ffxi-browser/src/game.js#L797)).
  - Give each element a distinct particle color/shape/travel effect: Stone (earth chunks arcing up), Blizzard (ice shards + slow frost trail), Fire (rising embers/flash), Cure/Banish (light pillar), Sleep (drifting z/dust cloud).
- [ ] **Weapon skill flourishes**
  - On `kind === 'ws'` hits, add a brief camera shake / flash / radial burst scaled to the weapon skill's `power`, so a Fast Blade reads as bigger than a normal swing.
- [ ] **Damage & status feedback**
  - Extend [UI.floater](file:///home/ender/ffxi-browser/src/ui.js#L70) (currently plain numbers) with crit/miss styling (color, size, "Miss"/"Resist" text) and stacked offsets so simultaneous hits from a 3-person party don't overlap illegibly.
  - Add a brief tint flash on a unit's model when it takes damage or lands a crit.
- [ ] **Buff/debuff indicators**
  - Small persistent particle auras or icon overlays for active buffs (Berserk, Protect, sneak attack, Dia DoT) tied to the `e.buffs` map in [updateBuffsAndRegen](file:///home/ender/ffxi-browser/src/game.js#L1223), so effects are visible without checking the party frame.
