// Thin client for the optional cloud-save API (see /server).
// If VITE_API_URL isn't set, the game runs entirely on localStorage, as before.

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'vanadiel_reverie_token';

export const isEnabled = () => !!API_URL;

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
export const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} };
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} };

async function request(path, opts = {}) {
  const res = await fetch(API_URL + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export async function register(username, password) {
  const { token, username: name } = await request('/api/auth/register', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  setToken(token);
  return name;
}

export async function login(username, password) {
  const { token, username: name } = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  setToken(token);
  return name;
}

export async function fetchCharacter() {
  const { character } = await request('/api/character');
  return character;
}

export async function saveCharacter(data, keepalive = false) {
  return request('/api/character/save', { method: 'POST', body: JSON.stringify(data), keepalive });
}
