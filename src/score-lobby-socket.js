/**
 * Score Lobby — realtime shared scoreboard for AI games.
 *
 * Concept: Every player playing the same AI game (when the game has
 * `lobby_enabled = TRUE`) joins a shared "score lobby". Their score updates
 * broadcast live to everyone else in the lobby, with a live top-N leaderboard.
 *
 * Single-player AI game + shared scoreboard = lightweight asynchronous "competition"
 * without needing real multiplayer game logic.
 *
 * Wire-up:
 *   import { initializeScoreLobbySocket, scoreLobbyRouter } from './score-lobby-socket.js';
 *   initializeScoreLobbySocket(httpServer);
 *   app.use('/api/score-lobbies', scoreLobbyRouter);
 *
 * Client (Socket.IO):
 *   const sock = io(`${SOCKET_URL}/score-lobby`, { auth: { userId } });
 *   sock.emit('lobby:join', { gameId });
 *   sock.emit('lobby:score', { gameId, score });
 *   sock.emit('lobby:leave', { gameId });
 *   sock.on('lobby:state', ({ gameId, players, updatedAt }) => {...});
 */

import { Server } from 'socket.io';
import express from 'express';
import pool from './db.js';

const STATE_BROADCAST_DEBOUNCE_MS = 250; // batch rapid updates

let io = null;

// gameId -> Map<userId, { socketId, score, displayName, avatar, joinedAt, lastUpdate }>
const lobbies = new Map();

// gameId -> Timeout handle for batched broadcasts
const pendingBroadcasts = new Map();

// userId cache
const userCache = new Map();
async function getUser(userId) {
    if (userCache.has(userId)) return userCache.get(userId);
    try {
        const { rows } = await pool.query(
            'SELECT id, username, display_name, avatar, verified FROM users WHERE id = $1',
            [userId]
        );
        const u = rows[0] || null;
        if (u) {
            userCache.set(userId, u);
            // Expire cache entries after 60s
            setTimeout(() => userCache.delete(userId), 60_000);
        }
        return u;
    } catch {
        return null;
    }
}

async function isLobbyEnabled(gameId) {
    try {
        const { rows } = await pool.query(
            'SELECT lobby_enabled FROM games WHERE id = $1 LIMIT 1',
            [gameId]
        );
        return Boolean(rows[0]?.lobby_enabled);
    } catch {
        return false;
    }
}

function snapshot(gameId) {
    const lobby = lobbies.get(gameId);
    if (!lobby) return { gameId, players: [], updatedAt: Date.now() };
    const players = Array.from(lobby.entries())
        .map(([userId, entry]) => ({
            userId,
            score: entry.score || 0,
            displayName: entry.displayName,
            avatar: entry.avatar,
            verified: Boolean(entry.verified),
            lastUpdate: entry.lastUpdate,
        }))
        .sort((a, b) => b.score - a.score);
    return { gameId, players, updatedAt: Date.now() };
}

function scheduleBroadcast(gameId) {
    if (pendingBroadcasts.has(gameId)) return;
    const handle = setTimeout(() => {
        pendingBroadcasts.delete(gameId);
        const state = snapshot(gameId);
        io?.to(`game:${gameId}`).emit('lobby:state', state);
    }, STATE_BROADCAST_DEBOUNCE_MS);
    pendingBroadcasts.set(gameId, handle);
}

async function joinLobby(socket, userId, gameId) {
    if (!gameId) return;

    const enabled = await isLobbyEnabled(gameId);
    if (!enabled) {
        socket.emit('lobby:error', { gameId, message: 'Score lobby not enabled for this game.' });
        return;
    }

    const user = await getUser(userId);
    if (!user) {
        socket.emit('lobby:error', { gameId, message: 'Unknown user.' });
        return;
    }

    if (!lobbies.has(gameId)) lobbies.set(gameId, new Map());
    const lobby = lobbies.get(gameId);

    lobby.set(userId, {
        socketId: socket.id,
        score: lobby.get(userId)?.score || 0,
        displayName: user.display_name || user.username,
        avatar: user.avatar,
        verified: Boolean(user.verified),
        joinedAt: Date.now(),
        lastUpdate: Date.now(),
    });

    socket.join(`game:${gameId}`);
    socket.emit('lobby:joined', { gameId, snapshot: snapshot(gameId) });
    scheduleBroadcast(gameId);
}

function leaveLobby(socket, userId, gameId) {
    if (!gameId) return;
    const lobby = lobbies.get(gameId);
    if (!lobby) return;
    lobby.delete(userId);
    if (lobby.size === 0) lobbies.delete(gameId);
    socket.leave(`game:${gameId}`);
    scheduleBroadcast(gameId);
}

function updateScore(userId, gameId, score) {
    const lobby = lobbies.get(gameId);
    if (!lobby) return;
    const entry = lobby.get(userId);
    if (!entry) return;
    const numScore = Math.max(0, Number(score) || 0);
    if (numScore <= entry.score) return; // never go backwards
    entry.score = numScore;
    entry.lastUpdate = Date.now();
    scheduleBroadcast(gameId);
}

export function initializeScoreLobbySocket(httpServer) {
    io = new Server(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
        path: '/score-lobby',
        transports: ['websocket', 'polling'],
    });

    io.on('connection', (socket) => {
        const userId = socket.handshake.auth?.userId;
        if (!userId) {
            socket.disconnect(true);
            return;
        }

        // Track lobbies this socket is in for clean disconnect
        const joinedGames = new Set();

        socket.on('lobby:join', async ({ gameId }) => {
            if (!gameId) return;
            joinedGames.add(gameId);
            await joinLobby(socket, userId, gameId);
        });

        socket.on('lobby:score', ({ gameId, score }) => {
            if (!gameId || !joinedGames.has(gameId)) return;
            updateScore(userId, gameId, score);
        });

        socket.on('lobby:leave', ({ gameId }) => {
            if (!gameId) return;
            joinedGames.delete(gameId);
            leaveLobby(socket, userId, gameId);
        });

        socket.on('disconnect', () => {
            for (const gameId of joinedGames) {
                leaveLobby(socket, userId, gameId);
            }
        });
    });

    console.log('[ScoreLobby] Socket.IO listening on path=/score-lobby');
    return io;
}

// --- DB helpers --------------------------------------------------------------

export async function ensureScoreLobbyColumn() {
    try {
        await pool.query("ALTER TABLE games ADD COLUMN IF NOT EXISTS lobby_enabled BOOLEAN DEFAULT FALSE");
        await pool.query("CREATE INDEX IF NOT EXISTS idx_games_lobby_enabled ON games(lobby_enabled) WHERE lobby_enabled = TRUE");
    } catch (err) {
        console.warn('[ScoreLobby] ensureScoreLobbyColumn:', err.message);
    }
}

// --- REST router -------------------------------------------------------------

export const scoreLobbyRouter = express.Router();

// List active lobbies (with current player counts)
scoreLobbyRouter.get('/', (req, res) => {
    const out = [];
    for (const [gameId, lobby] of lobbies.entries()) {
        out.push({ gameId, players: lobby.size });
    }
    res.json({ count: out.length, lobbies: out });
});

// Snapshot for a single game
scoreLobbyRouter.get('/:gameId', (req, res) => {
    res.json(snapshot(req.params.gameId));
});

// Admin: enable/disable lobby for a game
scoreLobbyRouter.post('/:gameId/toggle', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { enabled } = req.body || {};
        const next = typeof enabled === 'boolean' ? enabled : true;
        const result = await pool.query(
            'UPDATE games SET lobby_enabled = $1 WHERE id = $2 RETURNING id, name, lobby_enabled',
            [next, gameId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Game not found' });
        }
        res.json({ ok: true, game: result.rows[0] });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
