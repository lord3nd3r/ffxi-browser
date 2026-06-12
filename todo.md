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

- [ ] **Set up Socket Server Infrastructure**
  - Install socket libraries in backend: `npm install socket.io` (or a lighter alternative like `ws`).
  - Configure the HTTP server to attach a WebSocket listener.
- [ ] **Establish Socket Client Connection**
  - Load the socket client in [main.js](file:///home/ender/ffxi-browser/src/main.js).
  - Connect to the server upon successful login, sending the session token in the handshake.
- [ ] **Create Real-Time Chat Channels**
  - Set up command handler in server for standard chat modes: `/say`, `/shout`, `/tell`, `/party`.
  - **Spatial Filtering for /say**: Ensure the server only broadcasts `/say` packets to clients whose player positions are within a radius of 15–20 meters of the sender.
  - Connect the client message submission in [ui.js](file:///home/ender/ffxi-browser/src/ui.js#L50) `submitChat()` to emit a socket packet rather than logging locally.
  - Tag every chat line with the sender's character name (and job icon), not just raw text — chat is "from" a character, matching FFXI's `<Charname> message` convention.
- [ ] **Friends List**
  - New table `friendships` (`account_id`, `friend_account_id`, `status`: pending/accepted) in `server/src/db.js`.
  - API routes: `POST /api/friends/request`, `POST /api/friends/accept`, `GET /api/friends` (returns friends + their online status by checking the server's active-socket directory).
  - Server tracks online accounts (from Phase 3's player directory) and pushes presence changes to friends over the socket.
  - Client: a Friends panel in [ui.js](file:///home/ender/ffxi-browser/src/ui.js) listing friends with online/offline indicator; `/tell <name>` routes to a friend by character name globally (not just same-zone), looked up via the server's directory rather than spatial filtering.

---

## 🏃 Phase 3: Synchronized Multiplayer Movement
*Goal: Track other players online and show them moving smoothly.*

- [ ] **Implement Server-Side Player Directory**
  - Maintain an in-memory list of active connections, tracking: `socketId`, `characterName`, `coordinates (x, y, z)`, `heading`, `appearance`.
- [ ] **Establish Movement Broadcast Loop**
  - Have the client send position updates (coordinates & rotation) to the server during movement ticks in [game.js](file:///home/ender/ffxi-browser/src/game.js#L995) `updatePlayer()`.
  - Rate-limit updates (e.g., 20hz / every 50ms) to conserve bandwidth.
  - Broadcaster on server relays position changes of moving players to all other connected clients in the same area.
- [ ] **Render Other Players (Puppets) on Client**
  - Refactor [entities.js](file:///home/ender/ffxi-browser/src/entities.js) to support assembling and managing mesh objects for other players.
  - Draw these players inside [state.js](file:///home/ender/ffxi-browser/src/state.js) under a new collection (e.g., `S.otherPlayers`).
- [ ] **Implement Client-Side Interpolation**
  - Because update packets arrive with network latency, do not jump characters immediately to new coords.
  - Write a lerping interpolation routine in the client loop to slide other players smoothly between their last known coordinate and their target coordinate.

---

## ⚔️ Phase 4: Authoritative Combat & Simulation
*Goal: Move all game rules, damage, spawning, and logic to the server. The client becomes a renderer.*

- [ ] **Implement Authoritative Server Tick Loop**
  - Create a main world loop on the backend running at 20-30 ticks per second.
  - Manage monster spawn coordinates and intervals on the server instead of the local spawn list in [game.js](file:///home/ender/ffxi-browser/src/game.js#L178).
- [ ] **Migrate Pathfinding & Monster AI**
  - Run monster aggro checks, chasing states, and wandering timers on the server.
  - Stream monster positions and animations (e.g. death, attack, idle) to clients.
- [ ] **Authoritative Combat Calculations**
  - Server manages ability cooldown logs, MP/TP check validation, and range checks.
  - Re-locate formulas for [meleeSwing](file:///home/ender/ffxi-browser/src/game.js#L311), [applyDamage](file:///home/ender/ffxi-browser/src/game.js#L281), and quest progression to the backend.
  - Client actions like pressing hotbars emit a request (e.g. `use_ability`). The server processes, updates stats, and emits event packets back (e.g. `spell_cast_success`, `damage_applied`).
- [ ] **Synchronized Loot & Gathering**
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
