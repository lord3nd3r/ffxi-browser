// Static game data: jobs, actions, items, monsters, NPCs, quests, recipes.

export const JOBS = {
  WAR: {
    name: 'Warrior', abbr: 'WAR', icon: '⚔️', weapon: 'sword',
    baseHP: 38, baseMP: 0, hpGain: 9, mpGain: 0,
    str: 8, vit: 8, int: 3, mnd: 4, agi: 6,
    cloth: 0x8a4f2d, trim: 0xc9a227,
    desc: 'Front-line fighter. High HP and steady sword damage.',
  },
  MNK: {
    name: 'Monk', abbr: 'MNK', icon: '🥊', weapon: 'fists',
    baseHP: 42, baseMP: 0, hpGain: 10, mpGain: 0,
    str: 7, vit: 9, int: 3, mnd: 5, agi: 7,
    cloth: 0x6b4f3a, trim: 0xd96c2c,
    desc: 'Hand-to-hand brawler. Fast attacks, huge HP pool.',
  },
  WHM: {
    name: 'White Mage', abbr: 'WHM', icon: '✨', weapon: 'club',
    baseHP: 28, baseMP: 26, hpGain: 6, mpGain: 7,
    str: 4, vit: 5, int: 5, mnd: 9, agi: 5,
    cloth: 0xe8e2d4, trim: 0xb33939,
    desc: 'Healer of the party. Cures, protective magic, holy strikes.',
  },
  BLM: {
    name: 'Black Mage', abbr: 'BLM', icon: '🔥', weapon: 'staff',
    baseHP: 26, baseMP: 30, hpGain: 5, mpGain: 8,
    str: 3, vit: 4, int: 10, mnd: 5, agi: 5,
    cloth: 0x2b2b3d, trim: 0xc9a227,
    desc: 'Glass cannon. Devastating elemental magic, fragile body.',
  },
  THF: {
    name: 'Thief', abbr: 'THF', icon: '🗡️', weapon: 'dagger',
    baseHP: 32, baseMP: 0, hpGain: 7, mpGain: 0,
    str: 6, vit: 5, int: 5, mnd: 4, agi: 10,
    cloth: 0x3a4a3a, trim: 0x888888,
    desc: 'Swift skirmisher. High evasion, critical strikes, extra gil.',
  },
};

// kind: ws = weapon skill (needs 100 TP), spell = cast time + MP, ability = instant + recast
// type: dmg | heal | buff | debuff | sleep | enmity
export const ACTIONS = {
  // --- Warrior ---
  fast_blade:  { name: 'Fast Blade', icon: '💥', kind: 'ws', job: 'WAR', lv: 1, range: 3, power: 2.4, type: 'dmg', desc: 'Sword weapon skill. Consumes TP.' },
  provoke:     { name: 'Provoke', icon: '😤', kind: 'ability', job: 'WAR', lv: 3, range: 14, recast: 20, type: 'enmity', desc: 'Forces an enemy to attack you.' },
  berserk:     { name: 'Berserk', icon: '🔴', kind: 'ability', job: 'WAR', lv: 6, recast: 60, dur: 30, type: 'buff', buff: 'berserk', desc: '+35% attack, -15% defense for 30s.' },
  defender:    { name: 'Defender', icon: '🛡️', kind: 'ability', job: 'WAR', lv: 10, recast: 60, dur: 30, type: 'buff', buff: 'defender', desc: '+40% defense, -15% attack for 30s.' },
  armor_break: { name: 'Armor Break', icon: '🪓', kind: 'ws', job: 'WAR', lv: 12, range: 3, power: 2.0, type: 'dmg', debuff: 'armorbreak', desc: 'WS: damages and lowers enemy defense.' },

  // --- Monk ---
  combo:       { name: 'Combo', icon: '👊', kind: 'ws', job: 'MNK', lv: 1, range: 3, power: 2.2, type: 'dmg', hits: 3, desc: 'Three-hit hand-to-hand weapon skill.' },
  boost:       { name: 'Boost', icon: '💪', kind: 'ability', job: 'MNK', lv: 3, recast: 15, dur: 20, type: 'buff', buff: 'boost', desc: 'Next attacks +30% for 20s.' },
  dodge:       { name: 'Dodge', icon: '💨', kind: 'ability', job: 'MNK', lv: 8, recast: 60, dur: 30, type: 'buff', buff: 'dodge', desc: '+evasion for 30s.' },
  chakra:      { name: 'Chakra', icon: '🧘', kind: 'ability', job: 'MNK', lv: 12, recast: 45, type: 'heal', power: 3.0, self: true, desc: 'Restores own HP.' },

  // --- White Mage ---
  cure:        { name: 'Cure', icon: '💚', kind: 'spell', job: 'WHM', lv: 1, mp: 8, cast: 2.0, recast: 4, range: 16, power: 2.2, type: 'heal', desc: 'Restores a party member\'s HP.' },
  dia:         { name: 'Dia', icon: '🌞', kind: 'spell', job: 'WHM', lv: 3, mp: 7, cast: 1.5, recast: 6, range: 16, power: 0.6, type: 'dmg', dot: 12, desc: 'Light damage over time, lowers defense.' },
  banish:      { name: 'Banish', icon: '⚪', kind: 'spell', job: 'WHM', lv: 5, mp: 15, cast: 2.2, recast: 8, range: 16, power: 1.6, type: 'dmg', desc: 'Deals light elemental damage.' },
  protect:     { name: 'Protect', icon: '🔰', kind: 'spell', job: 'WHM', lv: 7, mp: 12, cast: 2.5, recast: 10, range: 14, dur: 120, type: 'buff', buff: 'protect', party: true, desc: '+25% defense to the party for 2 min.' },
  cure2:       { name: 'Cure II', icon: '💖', kind: 'spell', job: 'WHM', lv: 11, mp: 22, cast: 2.4, recast: 5, range: 16, power: 4.5, type: 'heal', desc: 'Restores a large amount of HP.' },
  shining_strike: { name: 'Shining Strike', icon: '🌟', kind: 'ws', job: 'WHM', lv: 1, range: 3, power: 2.0, type: 'dmg', desc: 'Club weapon skill. Consumes TP.' },

  // --- Black Mage ---
  stone:       { name: 'Stone', icon: '🪨', kind: 'spell', job: 'BLM', lv: 1, mp: 9, cast: 1.8, recast: 5, range: 18, power: 1.8, type: 'dmg', desc: 'Earth elemental damage.' },
  blizzard:    { name: 'Blizzard', icon: '❄️', kind: 'spell', job: 'BLM', lv: 4, mp: 14, cast: 2.4, recast: 7, range: 18, power: 2.4, type: 'dmg', slow: true, desc: 'Ice damage, briefly slows the enemy.' },
  sleep:       { name: 'Sleep', icon: '💤', kind: 'spell', job: 'BLM', lv: 6, mp: 16, cast: 2.2, recast: 18, range: 18, dur: 14, type: 'sleep', desc: 'Puts an enemy to sleep. Damage wakes it.' },
  fire:        { name: 'Fire', icon: '🔥', kind: 'spell', job: 'BLM', lv: 9, mp: 20, cast: 2.8, recast: 8, range: 18, power: 3.2, type: 'dmg', desc: 'Fire elemental damage.' },
  stone2:      { name: 'Stone II', icon: '⛰️', kind: 'spell', job: 'BLM', lv: 13, mp: 30, cast: 3.0, recast: 9, range: 18, power: 4.6, type: 'dmg', desc: 'Heavy earth elemental damage.' },
  heavy_swing: { name: 'Heavy Swing', icon: '🌀', kind: 'ws', job: 'BLM', lv: 1, range: 3, power: 1.8, type: 'dmg', desc: 'Staff weapon skill. Consumes TP.' },

  // --- Thief ---
  viper_bite:  { name: 'Viper Bite', icon: '🐍', kind: 'ws', job: 'THF', lv: 1, range: 3, power: 2.3, type: 'dmg', desc: 'Dagger weapon skill. Consumes TP.' },
  steal:       { name: 'Steal', icon: '🫳', kind: 'ability', job: 'THF', lv: 4, range: 3, recast: 45, type: 'steal', desc: 'Steal gil from an enemy.' },
  sneak_attack:{ name: 'Sneak Attack', icon: '🌫️', kind: 'ability', job: 'THF', lv: 8, recast: 45, dur: 15, type: 'buff', buff: 'sneak', desc: 'Next weapon skill is a guaranteed critical.' },
  flee:        { name: 'Flee', icon: '🏃', kind: 'ability', job: 'THF', lv: 12, recast: 90, dur: 12, type: 'buff', buff: 'flee', desc: 'Run twice as fast for 12s.' },

  // --- shared ---
  use_potion:  { name: 'Potion', icon: '🧪', kind: 'item', item: 'potion', desc: 'Drink a potion to restore HP.' },
  use_ether:   { name: 'Ether', icon: '🫙', kind: 'item', item: 'ether', desc: 'Drink an ether to restore MP.' },
};

export const ITEMS = {
  // weapons (job -> tiers)
  onion_sword:  { name: 'Onion Sword', type: 'weapon', job: 'WAR', dmg: 4, delay: 2.8, price: 0, icon: '🗡️' },
  bronze_sword: { name: 'Bronze Sword', type: 'weapon', job: 'WAR', dmg: 7, delay: 2.8, price: 280, icon: '⚔️' },
  iron_sword:   { name: 'Iron Sword', type: 'weapon', job: 'WAR', dmg: 12, delay: 2.8, price: 950, icon: '⚔️' },
  cesti:        { name: 'Cesti', type: 'weapon', job: 'MNK', dmg: 3, delay: 1.9, price: 0, icon: '🥊' },
  leather_himantes: { name: 'Himantes', type: 'weapon', job: 'MNK', dmg: 5, delay: 1.9, price: 260, icon: '🥊' },
  impact_knuckles: { name: 'Impact Knuckles', type: 'weapon', job: 'MNK', dmg: 9, delay: 1.9, price: 900, icon: '🥊' },
  bronze_knife: { name: 'Bronze Knife', type: 'weapon', job: 'THF', dmg: 4, delay: 2.0, price: 0, icon: '🔪' },
  baselard:     { name: 'Baselard', type: 'weapon', job: 'THF', dmg: 7, delay: 2.0, price: 300, icon: '🔪' },
  mythril_knife:{ name: 'Mythril Knife', type: 'weapon', job: 'THF', dmg: 11, delay: 2.0, price: 980, icon: '🔪' },
  bronze_rod:   { name: 'Bronze Rod', type: 'weapon', job: 'WHM', dmg: 4, delay: 3.0, price: 0, icon: '🪄' },
  maple_club:   { name: 'Maple Club', type: 'weapon', job: 'WHM', dmg: 8, delay: 3.0, price: 320, icon: '🏏' },
  holy_mace:    { name: 'Holy Mace', type: 'weapon', job: 'WHM', dmg: 13, delay: 3.0, price: 1000, icon: '🔨' },
  ash_staff:    { name: 'Ash Staff', type: 'weapon', job: 'BLM', dmg: 4, delay: 3.2, price: 0, icon: '🪵' },
  willow_wand:  { name: 'Willow Wand', type: 'weapon', job: 'BLM', dmg: 7, delay: 3.2, matk: 4, price: 340, icon: '🪄' },
  elm_staff:    { name: 'Elm Staff', type: 'weapon', job: 'BLM', dmg: 10, delay: 3.2, matk: 9, price: 1050, icon: '🌿' },

  // armor
  tunic:        { name: 'Traveler\'s Tunic', type: 'armor', def: 2, price: 0, icon: '👕' },
  leather_vest: { name: 'Leather Vest', type: 'armor', def: 5, price: 400, icon: '🦺' },
  scale_mail:   { name: 'Scale Mail', type: 'armor', def: 9, price: 1200, icon: '🛡️' },
  seer_tunic:   { name: 'Seer\'s Tunic', type: 'armor', def: 4, mp: 12, price: 800, icon: '🥻' },

  // consumables
  potion:       { name: 'Potion', type: 'consumable', heal: 45, price: 60, icon: '🧪' },
  hi_potion:    { name: 'Hi-Potion', type: 'consumable', heal: 110, price: 200, icon: '⚗️' },
  ether:        { name: 'Ether', type: 'consumable', mpheal: 35, price: 90, icon: '🫙' },
  rabbit_pie:   { name: 'Shepherd\'s Pie', type: 'consumable', heal: 70, price: 0, icon: '🥧' },

  // materials
  hare_meat:    { name: 'Sheep Meat', type: 'material', price: 12, icon: '🍖' },
  honey:        { name: 'Honey', type: 'material', price: 15, icon: '🍯' },
  mandra_sprout:{ name: 'Mandragora Sprout', type: 'material', price: 18, icon: '🌱' },
  gob_mask:     { name: 'Goblin Mask', type: 'material', price: 35, icon: '👺' },
  worm_silica:  { name: 'Worm Silica', type: 'material', price: 30, icon: '💠' },
  bat_wing:     { name: 'Bat Wing', type: 'material', price: 14, icon: '🦇' },
  spider_web:   { name: 'Spider Web', type: 'material', price: 28, icon: '🕸️' },
  orc_tooth:    { name: 'Orcish Tooth', type: 'material', price: 40, icon: '🦷' },
  maple_log:    { name: 'Maple Log', type: 'material', price: 20, icon: '🪵' },
  copper_ore:   { name: 'Copper Ore', type: 'material', price: 25, icon: '🪨' },
  wild_herb:    { name: 'Wild Herb', type: 'material', price: 10, icon: '🌿' },
  sealed_scroll:{ name: 'Sealed Scroll', type: 'key', price: 0, icon: '📜' },
  render_horn:  { name: 'Gorthak\'s Horn', type: 'key', price: 0, icon: '🦬' },
};

export const RECIPES = [
  { id: 'r_potion', result: 'potion', qty: 2, mats: [{ id: 'wild_herb', qty: 2 }], skill: 'Alchemy' },
  { id: 'r_pie', result: 'rabbit_pie', qty: 1, mats: [{ id: 'hare_meat', qty: 2 }, { id: 'wild_herb', qty: 1 }], skill: 'Cooking' },
  { id: 'r_club', result: 'maple_club', qty: 1, mats: [{ id: 'maple_log', qty: 3 }], skill: 'Woodworking' },
  { id: 'r_wand', result: 'willow_wand', qty: 1, mats: [{ id: 'maple_log', qty: 2 }, { id: 'worm_silica', qty: 1 }], skill: 'Woodworking' },
  { id: 'r_sword', result: 'bronze_sword', qty: 1, mats: [{ id: 'copper_ore', qty: 3 }], skill: 'Smithing' },
  { id: 'r_hipotion', result: 'hi_potion', qty: 1, mats: [{ id: 'wild_herb', qty: 2 }, { id: 'honey', qty: 1 }], skill: 'Alchemy' },
];

// family drives the procedural mesh; aggressive monsters chase on sight
export const MONSTERS = {
  hare:    { name: 'Mad Sheep', family: 'sheep', lv: [1, 3], hp: 28, dmg: 4, def: 0, exp: 24, speed: 3.2, aggressive: false, sight: 0, drops: [{ id: 'hare_meat', c: 0.7 }], gil: [3, 10] },
  bee:     { name: 'Stinger Wasp', family: 'bee', lv: [2, 4], hp: 34, dmg: 6, def: 1, exp: 32, speed: 4.0, aggressive: false, sight: 0, drops: [{ id: 'honey', c: 0.55 }], gil: [5, 14] },
  mandra:  { name: 'Mandragora', family: 'mandra', lv: [3, 6], hp: 46, dmg: 8, def: 2, exp: 46, speed: 2.8, aggressive: true, sight: 9, drops: [{ id: 'mandra_sprout', c: 0.6 }, { id: 'wild_herb', c: 0.35 }], gil: [8, 20] },
  worm:    { name: 'Stone Eater', family: 'worm', lv: [5, 8], hp: 70, dmg: 11, def: 5, exp: 66, speed: 1.6, aggressive: false, sight: 0, drops: [{ id: 'worm_silica', c: 0.6 }, { id: 'copper_ore', c: 0.3 }], gil: [10, 26] },
  bat:     { name: 'Forest Bat', family: 'bat', lv: [4, 7], hp: 50, dmg: 9, def: 1, exp: 52, speed: 4.4, aggressive: false, sight: 0, drops: [{ id: 'bat_wing', c: 0.6 }], gil: [6, 18] },
  spider:  { name: 'Crag Spider', family: 'spider', lv: [7, 10], hp: 95, dmg: 14, def: 5, exp: 92, speed: 3.8, aggressive: true, sight: 11, drops: [{ id: 'spider_web', c: 0.55 }, { id: 'wild_herb', c: 0.25 }], gil: [14, 38] },
  goblin:  { name: 'Goblin Mugger', family: 'goblin', lv: [6, 9], hp: 85, dmg: 13, def: 4, exp: 84, speed: 3.6, aggressive: true, sight: 13, drops: [{ id: 'gob_mask', c: 0.5 }, { id: 'potion', c: 0.2 }], gil: [18, 45] },
  orc:     { name: 'Orcish Grunt', family: 'orc', lv: [9, 12], hp: 130, dmg: 18, def: 7, exp: 120, speed: 3.4, aggressive: true, sight: 14, drops: [{ id: 'orc_tooth', c: 0.55 }, { id: 'hi_potion', c: 0.15 }], gil: [25, 60] },
  boss:    { name: 'Gorthak the Render', family: 'boss', lv: [14, 14], hp: 900, dmg: 26, def: 10, exp: 900, speed: 3.8, aggressive: true, sight: 16, drops: [{ id: 'render_horn', c: 1 }, { id: 'hi_potion', c: 1 }], gil: [400, 600], boss: true },
};

export const SPAWNS = [
  { monster: 'hare', count: 7, area: { x: 8, z: -42, r: 26 } },
  { monster: 'hare', count: 4, area: { x: -38, z: 8, r: 18 } },
  { monster: 'bee', count: 6, area: { x: 48, z: -18, r: 22 } },
  { monster: 'mandra', count: 6, area: { x: 52, z: 44, r: 24 } },
  { monster: 'bat', count: 5, area: { x: 58, z: 52, r: 22 } },
  { monster: 'spider', count: 4, area: { x: 62, z: 42, r: 20 } },
  { monster: 'worm', count: 4, area: { x: -52, z: -38, r: 18 } },
  { monster: 'goblin', count: 5, area: { x: -16, z: -70, r: 20 } },
  { monster: 'orc', count: 4, area: { x: -68, z: -62, r: 16 } },
  { monster: 'boss', count: 1, area: { x: -78, z: -78, r: 4 } },
];

export const NPCS = [
  { id: 'eustace', name: 'Gate Guard Eustace', x: 4, z: 22, role: 'quest', look: { cloth: 0x445577, trim: 0xc0c0c0 } },
  { id: 'mirelle', name: 'Mirelle, Weaponsmith', x: -10, z: 6, role: 'weapons', look: { cloth: 0x774433, trim: 0x222222 } },
  { id: 'tarutaru', name: 'Pikko-Wikko', x: 10, z: 4, role: 'items', look: { cloth: 0x9944aa, trim: 0xffe066 }, small: true },
  { id: 'father_odo', name: 'Father Odo', x: -3, z: -12, role: 'quest', look: { cloth: 0xe8e2d4, trim: 0xb33939 } },
  { id: 'galdric', name: 'Carpenter Galdric', x: 14, z: -8, role: 'quest', look: { cloth: 0x556633, trim: 0x8a4f2d } },
  { id: 'scholar', name: 'Archaeologist Renn', x: -62, z: -55, role: 'quest', look: { cloth: 0x886622, trim: 0xffffff } },
];

export const QUESTS = {
  q_hares: {
    name: 'Plains of Plenty', giver: 'eustace', type: 'kill', target: 'hare', count: 4,
    reward: { gil: 250, exp: 80 },
    offer: 'The sheep have gone mad and wandered off the farms — they\'re trampling the crops flat. Cull <b>4 Mad Sheep</b> south of town and I\'ll see you paid.',
    done: 'That\'s the spirit! The farmers will sleep easier. Here, as promised.',
  },
  q_logs: {
    name: 'Timber!', giver: 'galdric', type: 'collect', target: 'maple_log', count: 3,
    reward: { gil: 200, exp: 70, item: 'maple_club' },
    offer: 'My lumber shipment never arrived. Bring me <b>3 Maple Logs</b> — you can chop them from the logging points in the eastern woods — and this fine club is yours.',
    done: 'Ahh, good maple! Solid grain. Take the club — swing it in good health.',
  },
  q_scroll: {
    name: 'A Sealed Past', giver: 'father_odo', type: 'deliver', target: 'scholar', item: 'sealed_scroll',
    reward: { gil: 300, exp: 120 },
    offer: 'An archaeologist named Renn camps by the old ruins to the southwest, past the goblin camps. Deliver this <b>sealed scroll</b> to her. Beware — the path is dangerous.',
    done: '(Renn breaks the seal) …So the altar truly is Galkan. Fascinating! Thank you, adventurer — and do be careful, something monstrous prowls these ruins.',
    prereq: null,
  },
  q_boss: {
    name: 'The Render of the Ruins', giver: 'scholar', type: 'kill', target: 'boss', count: 1,
    reward: { gil: 1000, exp: 600, item: 'hi_potion' },
    offer: 'A horned beast the goblins call <b>Gorthak the Render</b> has claimed the inner ruins. I cannot work while it prowls. Slay it — but bring your companions, it will take all three of you.',
    done: 'You… actually felled it?! The Render is no more! You are a true hero of these plains. Take this — you have more than earned it.',
    prereq: 'q_scroll',
  },
};

export const VENDOR_STOCK = {
  weapons: ['bronze_sword', 'iron_sword', 'leather_himantes', 'impact_knuckles', 'baselard', 'mythril_knife', 'maple_club', 'holy_mace', 'willow_wand', 'elm_staff', 'leather_vest', 'scale_mail', 'seer_tunic'],
  items: ['potion', 'hi_potion', 'ether'],
};

// EXP needed to go from level L to L+1
export const expToNext = (l) => Math.floor(80 * l + 22 * l * l);
export const MAX_LEVEL = 15;

// default starter weapon per job
export const STARTER_WEAPON = { WAR: 'onion_sword', MNK: 'cesti', WHM: 'bronze_rod', BLM: 'ash_staff', THF: 'bronze_knife' };

// actions a job knows at a given level (hotbar order)
export function jobActions(job, level) {
  const out = [];
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.job === job && a.lv <= level) out.push(id);
  }
  out.push('use_potion', 'use_ether');
  return out.slice(0, 10);
}
