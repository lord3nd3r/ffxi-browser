// Player-to-player social systems: parties (invite/accept/leave, shared EXP,
// /p chat), direct trading with double-confirm, and personal bazaars.
// chat.js owns the players map and inventory helpers and hands them in via init().

const MAX_PARTY = 6;
const TRADE_RANGE = 10;
const BAZAAR_RANGE = 12;

let ctx = null;   // { players, addItem, removeItem, countItem, savePlayerToDb, sendPlayerStatus }

export function init(context) { ctx = context; }

function findByName(name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  for (const [sid, p] of ctx.players) {
    if (p.charName.toLowerCase() === want) return { sid, p };
  }
  return null;
}

function logTo(io, sid, text, channel = 'sys') {
  io.to(sid).emit('log:message', { text, channel });
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// =====================================================================
// parties
// =====================================================================
const parties = new Map();      // partyId -> { id, leader: sid, members: [sid] }
const partyOf = new Map();      // sid -> partyId
const partyInvites = new Map(); // targetSid -> { from: sid, t }
let nextPartyId = 1;

export function getPartySids(sid) {
  const pid = partyOf.get(sid);
  if (!pid) return [sid];
  return [...parties.get(pid).members];
}

function partyPayload(party) {
  return {
    leader: party.leader,
    members: party.members.map(sid => {
      const p = ctx.players.get(sid);
      return p && {
        id: sid, name: p.charName, job: p.job, level: p.level,
        hp: Math.round(p.hp), maxhp: p.maxhp, mp: Math.round(p.mp), maxmp: p.maxmp,
      };
    }).filter(Boolean),
  };
}

function pushPartyState(io, party) {
  const payload = partyPayload(party);
  for (const sid of party.members) io.to(sid).emit('party:state', payload);
}

function leaveParty(io, sid, silent = false) {
  const pid = partyOf.get(sid);
  if (!pid) return;
  const party = parties.get(pid);
  partyOf.delete(sid);
  party.members = party.members.filter(s => s !== sid);
  const leaver = ctx.players.get(sid);
  io.to(sid).emit('party:state', { leader: null, members: [] });
  if (!silent) logTo(io, sid, 'You leave the party.');

  if (party.members.length <= 1) {
    // disband — a party of one is no party
    for (const s of party.members) {
      partyOf.delete(s);
      io.to(s).emit('party:state', { leader: null, members: [] });
      logTo(io, s, 'The party has disbanded.');
    }
    parties.delete(pid);
    return;
  }
  if (party.leader === sid) {
    party.leader = party.members[0];
    const newLead = ctx.players.get(party.leader);
    if (newLead) for (const s of party.members) logTo(io, s, `${newLead.charName} is now the party leader.`);
  }
  if (leaver) for (const s of party.members) logTo(io, s, `${leaver.charName} has left the party.`);
  pushPartyState(io, party);
}

// vitals refresh, called ~1Hz from the world tick
export function tickParties(io) {
  for (const party of parties.values()) pushPartyState(io, party);
}

// =====================================================================
// trading
// =====================================================================
const trades = new Map();       // sid -> trade (both participants map to the same object)
const tradeInvites = new Map(); // targetSid -> fromSid

function tradeStateFor(t, sid) {
  const other = t.a === sid ? t.b : t.a;
  const op = ctx.players.get(other);
  return {
    partner: op ? op.charName : '?',
    mine: { ...t.offers[sid], confirmed: !!t.confirmed[sid] },
    theirs: { ...t.offers[other], confirmed: !!t.confirmed[other] },
  };
}

function pushTradeState(io, t) {
  io.to(t.a).emit('trade:state', tradeStateFor(t, t.a));
  io.to(t.b).emit('trade:state', tradeStateFor(t, t.b));
}

function cancelTrade(io, sid, reason) {
  const t = trades.get(sid);
  if (!t) return;
  trades.delete(t.a);
  trades.delete(t.b);
  for (const s of [t.a, t.b]) {
    io.to(s).emit('trade:cancelled', {});
    logTo(io, s, reason || 'Trade cancelled.');
  }
}

function validOffer(p, offer) {
  if (offer.gil < 0 || offer.gil > p.gil) return false;
  for (const it of offer.items) {
    if (ctx.countItem(p, it.id) < it.qty) return false;
  }
  return true;
}

function executeTrade(io, t) {
  const pa = ctx.players.get(t.a), pb = ctx.players.get(t.b);
  if (!pa || !pb || !validOffer(pa, t.offers[t.a]) || !validOffer(pb, t.offers[t.b])) {
    cancelTrade(io, t.a, 'Trade failed — items or gil no longer available.');
    return;
  }
  const give = (from, to, offer) => {
    from.gil -= offer.gil;
    to.gil += offer.gil;
    for (const it of offer.items) {
      ctx.removeItem(from, it.id, it.qty);
      ctx.addItem(to, it.id, it.qty);
    }
  };
  give(pa, pb, t.offers[t.a]);
  give(pb, pa, t.offers[t.b]);
  trades.delete(t.a);
  trades.delete(t.b);
  for (const [sid, p] of [[t.a, pa], [t.b, pb]]) {
    ctx.savePlayerToDb(p);
    ctx.sendPlayerStatus(io.sockets.sockets.get(sid), p);
    io.to(sid).emit('trade:complete', {});
    logTo(io, sid, 'Trade complete.', 'gain');
  }
}

// =====================================================================
// bazaars
// =====================================================================
export function hasBazaar(p) {
  if (!p.bazaar) return false;
  for (const id of Object.keys(p.bazaar)) if (ctx.countItem(p, id) > 0) return true;
  return false;
}

function bazaarListing(sellerSid, seller) {
  const items = [];
  for (const [id, price] of Object.entries(seller.bazaar || {})) {
    const qty = ctx.countItem(seller, id);
    if (qty > 0 && price > 0) items.push({ id, qty, price });
  }
  return { sellerId: sellerSid, seller: seller.charName, items };
}

// =====================================================================
// socket handlers
// =====================================================================
export function register(io, socket) {
  const sid = () => socket.id;
  const me = () => ctx.players.get(socket.id);

  // ── party ──────────────────────────────────────────────────────
  socket.on('party:invite', ({ targetName }) => {
    const p = me();
    if (!p) return;
    const hit = findByName(targetName);
    if (!hit) { logTo(io, sid(), `${targetName} is not online.`); return; }
    if (hit.sid === sid()) { logTo(io, sid(), 'You cannot invite yourself.'); return; }
    if (partyOf.get(hit.sid)) { logTo(io, sid(), `${hit.p.charName} is already in a party.`); return; }
    const pid = partyOf.get(sid());
    if (pid) {
      const party = parties.get(pid);
      if (party.leader !== sid()) { logTo(io, sid(), 'Only the party leader can invite.'); return; }
      if (party.members.length >= MAX_PARTY) { logTo(io, sid(), 'The party is full.'); return; }
    }
    partyInvites.set(hit.sid, { from: sid(), t: Date.now() });
    io.to(hit.sid).emit('party:invited', { from: p.charName });
    logTo(io, sid(), `You invite ${hit.p.charName} to your party.`);
  });

  socket.on('party:accept', () => {
    const p = me();
    const inv = partyInvites.get(sid());
    partyInvites.delete(sid());
    if (!p || !inv) return;
    const host = ctx.players.get(inv.from);
    if (!host) { logTo(io, sid(), 'The inviter is no longer online.'); return; }
    if (partyOf.get(sid())) { logTo(io, sid(), 'You are already in a party.'); return; }
    let pid = partyOf.get(inv.from);
    let party = pid && parties.get(pid);
    if (!party) {
      party = { id: nextPartyId++, leader: inv.from, members: [inv.from] };
      parties.set(party.id, party);
      partyOf.set(inv.from, party.id);
    }
    if (party.members.length >= MAX_PARTY) { logTo(io, sid(), 'The party is full.'); return; }
    party.members.push(sid());
    partyOf.set(sid(), party.id);
    for (const s of party.members) logTo(io, s, `${p.charName} joins the party!`, 'gain');
    pushPartyState(io, party);
  });

  socket.on('party:decline', () => {
    const inv = partyInvites.get(sid());
    partyInvites.delete(sid());
    const p = me();
    if (inv && p) logTo(io, inv.from, `${p.charName} declines your party invitation.`);
  });

  socket.on('party:leave', () => leaveParty(io, sid()));

  // ── trading ────────────────────────────────────────────────────
  socket.on('trade:request', ({ targetName }) => {
    const p = me();
    if (!p) return;
    const hit = findByName(targetName);
    if (!hit || hit.sid === sid()) { logTo(io, sid(), `${targetName} is not online.`); return; }
    if (trades.get(sid()) || trades.get(hit.sid)) { logTo(io, sid(), 'A trade is already in progress.'); return; }
    if (dist(p, hit.p) > TRADE_RANGE) { logTo(io, sid(), `${hit.p.charName} is too far away to trade.`); return; }
    tradeInvites.set(hit.sid, sid());
    io.to(hit.sid).emit('trade:requested', { from: p.charName });
    logTo(io, sid(), `You propose a trade to ${hit.p.charName}.`);
  });

  socket.on('trade:accept', () => {
    const from = tradeInvites.get(sid());
    tradeInvites.delete(sid());
    const p = me();
    const host = from && ctx.players.get(from);
    if (!p || !host) return;
    if (trades.get(sid()) || trades.get(from)) return;
    const t = {
      a: from, b: sid(),
      offers: { [from]: { items: [], gil: 0 }, [sid()]: { items: [], gil: 0 } },
      confirmed: {},
    };
    trades.set(from, t);
    trades.set(sid(), t);
    pushTradeState(io, t);
  });

  socket.on('trade:decline', () => {
    const from = tradeInvites.get(sid());
    tradeInvites.delete(sid());
    const p = me();
    if (from && p) logTo(io, from, `${p.charName} declines the trade.`);
  });

  socket.on('trade:offer', ({ items, gil }) => {
    const p = me();
    const t = trades.get(sid());
    if (!p || !t) return;
    const clean = [];
    if (Array.isArray(items)) {
      for (const it of items.slice(0, 8)) {
        const qty = Math.floor(Number(it.qty));
        if (typeof it.id === 'string' && qty > 0 && ctx.countItem(p, it.id) >= qty) clean.push({ id: it.id, qty });
      }
    }
    const g = Math.max(0, Math.min(Math.floor(Number(gil) || 0), p.gil));
    t.offers[sid()] = { items: clean, gil: g };
    t.confirmed = {};   // any change resets both confirmations
    pushTradeState(io, t);
  });

  socket.on('trade:confirm', () => {
    const t = trades.get(sid());
    if (!t) return;
    t.confirmed[sid()] = true;
    if (t.confirmed[t.a] && t.confirmed[t.b]) executeTrade(io, t);
    else pushTradeState(io, t);
  });

  socket.on('trade:cancel', () => cancelTrade(io, sid()));

  // ── bazaar ─────────────────────────────────────────────────────
  socket.on('bazaar:set', ({ itemId, price }) => {
    const p = me();
    if (!p || typeof itemId !== 'string') return;
    p.bazaar = p.bazaar || {};
    const pr = Math.floor(Number(price) || 0);
    if (pr > 0 && ctx.countItem(p, itemId) > 0) {
      p.bazaar[itemId] = pr;
      logTo(io, sid(), `Bazaar: selling ${itemId.replace(/_/g, ' ')} for ${pr} gil.`);
    } else {
      delete p.bazaar[itemId];
      logTo(io, sid(), `Bazaar: ${itemId.replace(/_/g, ' ')} removed from sale.`);
    }
    ctx.savePlayerToDb(p);
    socket.emit('bazaar:mine', { bazaar: p.bazaar });
  });

  socket.on('bazaar:browse', ({ sellerId }) => {
    const p = me();
    const seller = ctx.players.get(sellerId);
    if (!p || !seller) { logTo(io, sid(), 'That player is no longer here.'); return; }
    if (dist(p, seller) > BAZAAR_RANGE) { logTo(io, sid(), `${seller.charName} is too far away.`); return; }
    socket.emit('bazaar:list', bazaarListing(sellerId, seller));
  });

  socket.on('bazaar:buy', ({ sellerId, itemId, qty }) => {
    const p = me();
    const seller = ctx.players.get(sellerId);
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    if (!p || !seller || sellerId === sid()) return;
    if (dist(p, seller) > BAZAAR_RANGE) { logTo(io, sid(), `${seller.charName} is too far away.`); return; }
    const price = seller.bazaar?.[itemId];
    if (!price || ctx.countItem(seller, itemId) < n) { logTo(io, sid(), 'That item is no longer for sale.'); return; }
    const total = price * n;
    if (p.gil < total) { logTo(io, sid(), 'Not enough gil.'); return; }
    p.gil -= total;
    seller.gil += total;
    ctx.removeItem(seller, itemId, n);
    ctx.addItem(p, itemId, n);
    ctx.savePlayerToDb(p);
    ctx.savePlayerToDb(seller);
    ctx.sendPlayerStatus(socket, p);
    ctx.sendPlayerStatus(io.sockets.sockets.get(sellerId), seller);
    logTo(io, sid(), `You buy ${n} × ${itemId.replace(/_/g, ' ')} from ${seller.charName} for ${total} gil.`, 'gain');
    logTo(io, sellerId, `${p.charName} buys ${n} × ${itemId.replace(/_/g, ' ')} from your bazaar (+${total} gil).`, 'loot');
    socket.emit('bazaar:list', bazaarListing(sellerId, seller));   // refresh the browser's view
  });
}

export function onDisconnect(io, socket) {
  leaveParty(io, socket.id, true);
  cancelTrade(io, socket.id, 'Trade cancelled — partner disconnected.');
  partyInvites.delete(socket.id);
  tradeInvites.delete(socket.id);
}
