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

## 💬 Phase 2: WebSockets & Spatial Chat ✅ DONE
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
- [x] **Friends List**
  - New table `friendships` (`account_id`, `friend_account_id`, `status`: pending/accepted) in `server/src/db.js`.
  - API routes: `POST /api/friends/request`, `POST /api/friends/accept`, `GET /api/friends` (returns friends + their online status by checking the server's active-socket directory).
  - Server tracks online accounts (from Phase 3's player directory) and pushes presence changes to friends over the socket.
  - Client: a Friends panel in `ui.js` listing friends with online/offline indicator; `/tell <name>` routes to a friend by character name globally (not just same-zone), looked up via the server's directory rather than spatial filtering.

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

## ✨ Phase 5: Combat & Spell Visual Polish ✅ DONE
*Goal: Make hits, casts, and effects read clearly at a glance. Independent of the multiplayer work above — can be done anytime, single-player or not.*

- [x] **Per-element spell effects**
  - New `src/effects.js` module: configurable particle system (gravity, drag, additive blending, spawn jitter), expanding shockwave rings, additive glow sprites, and travelling spell bolts with particle trails. Absorbed `spawnBurst`/`updateParticles` from `game.js` (re-exported for compatibility).
  - Element composites: Stone/Stone II (earth chunks arcing up + dust + ground ring, II adds shake), Fire & Blizzard (glowing bolt flies caster→target, then rising embers/flash or ice shards + lingering frost mist), Cure/Banish/Dia/buffs (rising light pillars in their own colors), Sleep (slow drifting purple dust).
  - Works both offline (`resolveAction`) and server-authoritative (`visual:hit` handler in `main.js` routes by `actionId`).
- [x] **Weapon skill flourishes**
  - `weaponSkillEffect()`: additive glow flash + radial particle burst + expanding ground shockwave ring, all scaled to the WS `power`; camera shake scaled by power and attenuated by distance to the player (applied in `updateCamera`, works in first-person too). Gorthak's AoE stomp also shakes the screen.
- [x] **Damage & status feedback**
  - Floaters: "Miss" (italic) and "Resist" text, bigger crits with a scale-pop keyframe animation and golden glow; near-simultaneous floaters on the same target stack vertically instead of overlapping.
  - `tintFlash()`: brief emissive flash on the model when hit — red for physical, lavender for magic, gold for crits. Materials are lazily cloned per entity (SkeletonUtils clones share materials, so without this every twin monster would flash). Replaces the old dead `hitFlash` code.
- [x] **Buff/debuff indicators**
  - Persistent particle auras: every 0.3s each active effect emits colored motes — rising for buffs (Berserk red, Boost orange, Protect cyan, Dodge teal, Defender blue, Flee white), low mist for Sneak Attack & sleeping monsters, falling drips for debuffs (Armor Break gold, Slow frost-blue, Dia DoT golden).

---

## 🤝 Phase 6: Player Parties, Trading & Bazaars ✅ DONE
*Goal: Turn parallel play into playing together — humans grouping, sharing EXP, and exchanging items.*

- [x] **Real player parties**
  - New `server/src/social.js`: party registry (max 6), `party:invite/accept/decline/leave`, leader passing, disband-when-one-remains, disconnect handling.
  - EXP, kill-quest progress and the boss flag are shared with party members within 50 units of a kill, with a +10%-per-extra-member grouping bonus before the split. Gil and item drops stay with the killer.
  - `/p` chat now actually relays to party members. Party vitals (HP/MP/level) are pushed at 1 Hz; the client renders human members as extra party frames (👑 marks the leader).
  - Commands: `/invite <name>`, `/leave`; or right-click another player → Invite to Party. Invites show an Accept/Decline prompt.
- [x] **Player-to-player trading**
  - Trade sessions with offer (items + gil) and double-confirm; any change to either offer resets both confirmations; the swap is validated and executed atomically server-side, then both characters are saved.
  - Client trade window shows both offers live, lets you add/remove items from your bags and set gil. `/trade <name>` or right-click → Trade (must be within 10 units).
- [x] **Personal bazaars**
  - Price any inventory item from the Inventory window ("Bazaar" button); prices persist in a new `bazaar_json` column. Players with an active bazaar get a 🛒 nameplate marker (flag travels in the player snapshot).
  - Right-click a player → Browse Bazaar to see priced items and buy; gil/items transfer server-side with both parties notified and saved (12-unit range).
- [x] **Side fixes**
  - Remote players are now click/right-click targetable (they were unpickable before).
  - The client now listens to `log:message` and `visual:tracker_update` — server combat/loot/quest text was previously dropped entirely.
  - Verified end-to-end with a two-client socket test (18 assertions: invite→accept→state, /p relay, trade confirm + gil movement, bazaar set/browse/buy, leave→disband).
