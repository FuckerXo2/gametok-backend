/**
 * Realtime presence module.
 *
 * Tracks userId → { status, lastBeat, socketId } in memory.
 * Statuses: 'online' | 'in-game' | 'idle' | 'offline'
 *
 * Wire-up:
 *   import { initializePresenceSocket, presenceRouter } from './presence-socket.js';
 *   initializePresenceSocket(httpServer);
 *   app.use('/api/presence', presenceRouter);
 *
 * Client (Socket.IO):
 *   const sock = io(`${SOCKET_URL}/presence`, { auth: { userId } });
 *   sock.emit('presence:set', { status: 'in-game' });   // change status
 *   sock.emit('presence:beat');                         // heartbeat (every 25s)
 *   sock.on('presence:update', ({ userId, status }) => {...}); // friend status change
 *
 * Statuses time-out:
 *   - online → idle if no beat for 60s
 *   - idle → offline if no beat for 120s (we just remove the entry)
 */

import { Server } from 'socket.io';
import express from 'express';
import pool from './db.js';

const HEARTBEAT_GRACE_MS = 60_000;       // mark idle after 60s of no beat
const OFFLINE_GRACE_MS = 120_000;         // remove from online list after 120s

let io = null;

// userId -> { status, lastBeat, socketId, prevStatus }
const presence = new Map();

// userId -> Set<userId> follower cache (refreshed lazily)
const followersCache = new Map();
const FOLLOWERS_TTL_MS = 30_000;
const followersFetchedAt = new Map();

async function getFollowersOf(userId) {
    const fetchedAt = followersFetchedAt.get(userId) || 0;
    if (Date.now() - fetchedAt < FOLLOWERS_TTL_MS && followersCache.has(userId)) {
        return followersCache.get(userId);
    }
    try {
        const res = await pool.query(
            'SELECT follower_id FROM followers WHERE following_id = $1',
            [userId]
        );
        const ids = new Set(res.rows.map((r) => r.follower_id));
        followersCache.set(userId, ids);
        followersFetchedAt.set(userId, Date.now());
        return ids;
    } catch {
        return new Set();
    }
}

async function broadcastPresence(userId, status) {
    if (!io) return;
    const followers = await getFollowersOf(userId);
    for (const followerId of followers) {
        const entry = presence.get(followerId);
        if (entry?.socketId) {
            io.to(entry.socketId).emit('presence:update', { userId, status });
        }
    }
    // Also emit to the user themselves (so other devices/tabs sync)
    const self = presence.get(userId);
    if (self?.socketId) {
        io.to(self.socketId).emit('presence:update', { userId, status });
    }
}

function setStatus(userId, status, socketId) {
    const prev = presence.get(userId);
    const now = Date.now();
    presence.set(userId, {
        status,
        lastBeat: now,
        socketId: socketId || prev?.socketId || null,
        prevStatus: prev?.status,
    });
    if (!prev || prev.status !== status) {
        broadcastPresence(userId, status).catch(() => {});
    }
}

function dropUser(userId) {
    presence.delete(userId);
    broadcastPresence(userId, 'offline').catch(() => {});
}

// Sweep: demote stale entries
setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of presence.entries()) {
        const age = now - entry.lastBeat;
        if (entry.status !== 'idle' && age > HEARTBEAT_GRACE_MS && age <= OFFLINE_GRACE_MS) {
            setStatus(userId, 'idle', entry.socketId);
        } else if (age > OFFLINE_GRACE_MS) {
            dropUser(userId);
        }
    }
}, 15_000);

export function initializePresenceSocket(httpServer) {
    io = new Server(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        path: '/presence',
        transports: ['websocket', 'polling'],
    });

    io.on('connection', (socket) => {
        const userId = socket.handshake.auth?.userId;
        if (!userId) {
            socket.disconnect(true);
            return;
        }

        setStatus(userId, 'online', socket.id);

        socket.on('presence:set', ({ status }) => {
            const allowed = ['online', 'in-game', 'idle'];
            const next = allowed.includes(status) ? status : 'online';
            setStatus(userId, next, socket.id);
        });

        socket.on('presence:beat', () => {
            const entry = presence.get(userId);
            if (entry) {
                entry.lastBeat = Date.now();
                if (entry.status === 'idle') {
                    setStatus(userId, 'online', socket.id);
                }
            } else {
                setStatus(userId, 'online', socket.id);
            }
        });

        socket.on('disconnect', () => {
            const entry = presence.get(userId);
            if (entry?.socketId === socket.id) {
                dropUser(userId);
            }
        });
    });

    console.log('[Presence] Socket.IO listening on path=/presence');
    return io;
}

// --- REST router ------------------------------------------------------------

export const presenceRouter = express.Router();

presenceRouter.get('/', (req, res) => {
    const userIdsParam = String(req.query.userIds || '').trim();
    if (!userIdsParam) {
        return res.json({ online: presence.size, statuses: {} });
    }
    const ids = userIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
    const statuses = {};
    for (const id of ids) {
        statuses[id] = presence.get(id)?.status || 'offline';
    }
    res.json({ statuses });
});

presenceRouter.get('/online', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const out = [];
    for (const [userId, entry] of presence.entries()) {
        if (out.length >= limit) break;
        out.push({ userId, status: entry.status });
    }
    res.json({ count: presence.size, users: out });
});

presenceRouter.get('/:userId', (req, res) => {
    const status = presence.get(req.params.userId)?.status || 'offline';
    res.json({ userId: req.params.userId, status });
});

export function getPresenceSnapshot() {
    const out = {};
    for (const [userId, entry] of presence.entries()) {
        out[userId] = entry.status;
    }
    return out;
}
