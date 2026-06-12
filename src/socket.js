// Client-side Socket.IO wrapper for real-time multiplayer chat & presence.
// Mirrors the thin-client pattern of api.js — only active when the server
// is configured (VITE_API_URL is set) and the player is logged in.

import { io } from 'socket.io-client';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let socket = null;
let positionInterval = null;

/** True when a live socket connection is open. */
export function isConnected() {
  return socket?.connected ?? false;
}

/** Get the current socket connection ID. */
export function getId() {
  return socket?.id;
}

/**
 * Connect to the game server's WebSocket endpoint.
 * @param {string} token  JWT from the auth flow
 * @returns {Promise<void>} resolves on successful connection
 */
export function connect(token) {
  if (!API_URL) return Promise.reject(new Error('No API URL configured'));
  if (socket) return Promise.resolve(); // already connected

  return new Promise((resolve, reject) => {
    socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      console.log('[socket] connected:', socket.id);
      resolve();
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect error:', err.message);
      // Only reject on the very first attempt; after that reconnection handles it
      reject(err);
    });

    socket.on('disconnect', (reason) => {
      console.log('[socket] disconnected:', reason);
    });
  });
}

/** Clean disconnect. */
export function disconnect() {
  if (positionInterval) { clearInterval(positionInterval); positionInterval = null; }
  if (socket) { socket.disconnect(); socket = null; }
}

/** Emit an event to the server. */
export function emit(event, data) {
  if (socket?.connected) socket.emit(event, data);
}

/** Listen for a server event. Returns an unsubscribe function. */
export function on(event, cb) {
  if (!socket) return () => {};
  socket.on(event, cb);
  return () => socket?.off(event, cb);
}

/**
 * Tell the server we've entered the world.
 * @param {string} charName
 * @param {string} job
 * @param {any} appearance
 * @param {number} x
 * @param {number} z
 * @param {number} heading
 * @param {boolean} moving
 */
export function enter(charName, job, appearance, x, z, heading, moving) {
  emit('player:enter', { charName, job, appearance, x, z, heading, moving });
}

/**
 * Start sending throttled position updates (~4 Hz).
 * @param {() => {x: number, z: number, heading: number, moving: boolean}} getPos  callback that returns current state
 */
export function startPositionUpdates(getPos) {
  if (positionInterval) clearInterval(positionInterval);
  let lastX = null, lastZ = null, lastHeading = null, lastMoving = null;
  positionInterval = setInterval(() => {
    if (!socket?.connected) return;
    const { x, z, heading, moving } = getPos();
    // Send if position, heading, or moving state changed
    if (x !== lastX || z !== lastZ || heading !== lastHeading || moving !== lastMoving) {
      lastX = x; lastZ = z; lastHeading = heading; lastMoving = moving;
      emit('player:position', { x, z, heading, moving });
    }
  }, 250); // 4 Hz
}

/**
 * Send a chat message on a given channel.
 * @param {'say'|'shout'|'party'} channel
 * @param {string} text
 */
export function sendChat(channel, text) {
  emit(`chat:${channel}`, { text });
}
