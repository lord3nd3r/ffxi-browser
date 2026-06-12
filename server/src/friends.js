import { Router } from 'express';
import { requireAuth } from './auth.js';
import { db } from './db.js';
import { isAccountOnline, notifyFriendsUpdate, notifyOnlineFriendsOfStatusChange } from './chat.js';

export const router = Router();

// GET /api/friends - Returns list of friends (accepted, incoming, outgoing)
router.get('/', requireAuth, (req, res) => {
  try {
    const accountId = req.accountId;

    // Get accepted friends
    const acceptedRows = db.prepare(`
      SELECT c.account_id, c.name, c.current_job, c.jobs_json
      FROM friendships f
      JOIN characters c ON c.account_id = (CASE WHEN f.account_id = ? THEN f.friend_id ELSE f.account_id END)
      WHERE (f.account_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    `).all(accountId, accountId, accountId);

    const friends = acceptedRows.map(row => {
      const jobs = JSON.parse(row.jobs_json);
      const level = jobs[row.current_job]?.level || 1;
      return {
        name: row.name,
        job: row.current_job,
        level,
        online: isAccountOnline(row.account_id)
      };
    });

    // Get incoming pending requests
    const incomingRows = db.prepare(`
      SELECT c.account_id, c.name, c.current_job, c.jobs_json
      FROM friendships f
      JOIN characters c ON c.account_id = f.account_id
      WHERE f.friend_id = ? AND f.status = 'pending'
    `).all(accountId);

    const incoming = incomingRows.map(row => {
      const jobs = JSON.parse(row.jobs_json);
      const level = jobs[row.current_job]?.level || 1;
      return {
        name: row.name,
        job: row.current_job,
        level
      };
    });

    // Get outgoing pending requests
    const outgoingRows = db.prepare(`
      SELECT c.account_id, c.name, c.current_job, c.jobs_json
      FROM friendships f
      JOIN characters c ON c.account_id = f.friend_id
      WHERE f.account_id = ? AND f.status = 'pending'
    `).all(accountId);

    const outgoing = outgoingRows.map(row => {
      const jobs = JSON.parse(row.jobs_json);
      const level = jobs[row.current_job]?.level || 1;
      return {
        name: row.name,
        job: row.current_job,
        level
      };
    });

    res.json({ friends, incoming, outgoing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/friends/request - Send a friend request
router.post('/request', requireAuth, (req, res) => {
  try {
    const { friendName } = req.body || {};
    if (typeof friendName !== 'string' || !friendName.trim()) {
      return res.status(400).json({ error: 'Friend name is required' });
    }

    const name = friendName.trim();
    const targetChar = db.prepare('SELECT account_id FROM characters WHERE name = ?').get(name);
    if (!targetChar) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const friendId = targetChar.account_id;
    const accountId = req.accountId;

    if (friendId === accountId) {
      return res.status(400).json({ error: 'Cannot add yourself' });
    }

    // Check if there is an existing friendship row
    const existing = db.prepare(`
      SELECT * FROM friendships 
      WHERE (account_id = ? AND friend_id = ?) OR (account_id = ? AND friend_id = ?)
    `).get(accountId, friendId, friendId, accountId);

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'You are already friends' });
      }
      if (existing.account_id === accountId) {
        return res.status(400).json({ error: 'Friend request already sent' });
      }
      // If the outgoing request was from the friend to us, accept it automatically!
      db.prepare('UPDATE friendships SET status = \'accepted\' WHERE id = ?').run(existing.id);
      
      notifyFriendsUpdate(accountId);
      notifyFriendsUpdate(friendId);
      notifyOnlineFriendsOfStatusChange(accountId);
      notifyOnlineFriendsOfStatusChange(friendId);

      return res.json({ success: true, message: `Friend request accepted. You are now friends with ${name}!` });
    }

    db.prepare('INSERT INTO friendships (account_id, friend_id, status) VALUES (?, ?, \'pending\')').run(accountId, friendId);

    notifyFriendsUpdate(friendId);

    res.json({ success: true, message: `Friend request sent to ${name}.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/friends/accept - Accept a friend request
router.post('/accept', requireAuth, (req, res) => {
  try {
    const { friendName } = req.body || {};
    if (typeof friendName !== 'string' || !friendName.trim()) {
      return res.status(400).json({ error: 'Friend name is required' });
    }

    const name = friendName.trim();
    const targetChar = db.prepare('SELECT account_id FROM characters WHERE name = ?').get(name);
    if (!targetChar) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const friendId = targetChar.account_id;
    const accountId = req.accountId;

    const result = db.prepare(`
      UPDATE friendships 
      SET status = 'accepted'
      WHERE account_id = ? AND friend_id = ? AND status = 'pending'
    `).run(friendId, accountId);

    if (result.changes === 0) {
      return res.status(400).json({ error: 'No pending request found from this player' });
    }

    notifyFriendsUpdate(accountId);
    notifyFriendsUpdate(friendId);
    notifyOnlineFriendsOfStatusChange(accountId);
    notifyOnlineFriendsOfStatusChange(friendId);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/friends/remove - Remove a friend or cancel/reject request
router.post('/remove', requireAuth, (req, res) => {
  try {
    const { friendName } = req.body || {};
    if (typeof friendName !== 'string' || !friendName.trim()) {
      return res.status(400).json({ error: 'Friend name is required' });
    }

    const name = friendName.trim();
    const targetChar = db.prepare('SELECT account_id FROM characters WHERE name = ?').get(name);
    if (!targetChar) {
      return res.status(404).json({ error: 'Character not found' });
    }

    const friendId = targetChar.account_id;
    const accountId = req.accountId;

    const result = db.prepare(`
      DELETE FROM friendships
      WHERE (account_id = ? AND friend_id = ?) OR (account_id = ? AND friend_id = ?)
    `).run(accountId, friendId, friendId, accountId);

    if (result.changes === 0) {
      return res.status(400).json({ error: 'No friendship or request found with this player' });
    }

    notifyFriendsUpdate(accountId);
    notifyFriendsUpdate(friendId);
    notifyOnlineFriendsOfStatusChange(accountId);
    notifyOnlineFriendsOfStatusChange(friendId);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
