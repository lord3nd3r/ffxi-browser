import { Router } from 'express';
import { db } from './db.js';
import { requireAuth } from './auth.js';

export const router = Router();
router.use(requireAuth);

const getStmt = db.prepare('SELECT * FROM characters WHERE account_id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO characters (
    account_id, name, current_job, gil, jobs_json, inventory_json,
    equipment_json, quests_json, appearance_json, recruited_json,
    auto_magic_json, boss_down, hp, mp, pos_x, pos_z, updated_at
  ) VALUES (
    @account_id, @name, @current_job, @gil, @jobs_json, @inventory_json,
    @equipment_json, @quests_json, @appearance_json, @recruited_json,
    @auto_magic_json, @boss_down, @hp, @mp, @pos_x, @pos_z, datetime('now')
  )
  ON CONFLICT(account_id) DO UPDATE SET
    name = excluded.name, current_job = excluded.current_job, gil = excluded.gil,
    jobs_json = excluded.jobs_json, inventory_json = excluded.inventory_json,
    equipment_json = excluded.equipment_json, quests_json = excluded.quests_json,
    appearance_json = excluded.appearance_json, recruited_json = excluded.recruited_json,
    auto_magic_json = excluded.auto_magic_json, boss_down = excluded.boss_down,
    hp = excluded.hp, mp = excluded.mp, pos_x = excluded.pos_x, pos_z = excluded.pos_z,
    updated_at = datetime('now')
`);

// row -> client save shape (matches src/game.js saveGame()/loadGame())
function toClientShape(row) {
  if (!row) return null;
  return {
    charName: row.name,
    appearance: JSON.parse(row.appearance_json),
    job: row.current_job,
    jobs: JSON.parse(row.jobs_json),
    gil: row.gil,
    inventory: JSON.parse(row.inventory_json),
    equipPerJob: JSON.parse(row.equipment_json),
    quests: JSON.parse(row.quests_json),
    bossDown: !!row.boss_down,
    recruited: JSON.parse(row.recruited_json),
    autoMagic: JSON.parse(row.auto_magic_json),
    vitals: { hp: row.hp, mp: row.mp },
    pos: row.pos_x == null ? undefined : { x: row.pos_x, z: row.pos_z },
    updatedAt: row.updated_at,
  };
}

router.get('/', (req, res) => {
  const row = getStmt.get(req.accountId);
  res.json({ character: toClientShape(row) });
});

router.post('/save', (req, res) => {
  const c = req.body || {};
  if (!c.charName || !c.job || !c.jobs || !c.appearance) {
    return res.status(400).json({ error: 'Missing required character fields' });
  }
  upsertStmt.run({
    account_id: req.accountId,
    name: c.charName,
    current_job: c.job,
    gil: c.gil || 0,
    jobs_json: JSON.stringify(c.jobs),
    inventory_json: JSON.stringify(c.inventory || []),
    equipment_json: JSON.stringify(c.equipPerJob || {}),
    quests_json: JSON.stringify(c.quests || {}),
    appearance_json: JSON.stringify(c.appearance),
    recruited_json: JSON.stringify(c.recruited || {}),
    auto_magic_json: JSON.stringify(c.autoMagic || {}),
    boss_down: c.bossDown ? 1 : 0,
    hp: c.vitals?.hp ?? null,
    mp: c.vitals?.mp ?? null,
    pos_x: c.pos?.x ?? null,
    pos_z: c.pos?.z ?? null,
  });
  res.json({ ok: true });
});
