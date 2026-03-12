/**
 * Game Lobby Socket System
 * 
 * Real-time presence tracking and challenge system:
 * - Track who's online globally
 * - Track who's in which game lobby
 * - Send/receive live challenges
 * - Auto-match players looking for opponents
 */

import { Server } from 'socket.io';
import pool from './db.js';

let io;

// In-memory state
const onlineUsers = new Map(); // userId -> { socketId, username, displayName, avatar, currentLobby, joinedAt }
const gameLobbies = new Map(); // gameId -> Set<userId>
const activeChallenges = new Map(); // challengeId -> { from, to, gameId, gameName, createdAt }

export function initializeLobbySocket(server) {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        // Don't conflict with pk-socket if it creates its own Server
        path: '/lobby',
    });

    io.on('connection', (socket) => {
        console.log('[Lobby] Socket connected:', socket.id);
        let userId = null;

        // ============================================
        // AUTHENTICATION
        // ============================================
        socket.on('lobby:auth', async ({ token }) => {
            try {
                const result = await pool.query(
                    'SELECT id, username, display_name, avatar FROM users WHERE token = $1',
                    [token]
                );

                if (result.rows.length === 0) {
                    socket.emit('lobby:error', { message: 'Invalid token' });
                    return;
                }

                const user = result.rows[0];
                userId = user.id;

                // If user already connected from another device, disconnect old one
                const existing = onlineUsers.get(userId);
                if (existing && existing.socketId !== socket.id) {
                    const oldSocket = io.sockets.sockets.get(existing.socketId);
                    if (oldSocket) {
                        oldSocket.emit('lobby:kicked', { reason: 'Connected from another device' });
                        oldSocket.disconnect(true);
                    }
                }

                // Track user as online
                onlineUsers.set(userId, {
                    socketId: socket.id,
                    username: user.username,
                    displayName: user.display_name,
                    avatar: user.avatar,
                    currentLobby: null,
                    joinedAt: Date.now(),
                });

                socket.userId = userId;
                socket.emit('lobby:authenticated', {
                    userId,
                    onlineCount: onlineUsers.size,
                });

                console.log(`[Lobby] User authenticated: ${user.username} (${userId})`);
            } catch (err) {
                console.error('[Lobby] Auth error:', err);
                socket.emit('lobby:error', { message: 'Authentication failed' });
            }
        });

        // ============================================
        // GAME LOBBY - JOIN / LEAVE
        // ============================================
        socket.on('lobby:join_game', ({ gameId }) => {
            if (!userId) return;

            const userData = onlineUsers.get(userId);
            if (!userData) return;

            // Leave previous lobby if any
            if (userData.currentLobby) {
                const prevLobby = gameLobbies.get(userData.currentLobby);
                if (prevLobby) {
                    prevLobby.delete(userId);
                    socket.leave(`game_lobby_${userData.currentLobby}`);
                    // Notify others in old lobby
                    io.to(`game_lobby_${userData.currentLobby}`).emit('lobby:player_left', {
                        userId,
                        playerCount: prevLobby.size,
                    });
                }
            }

            // Join new lobby
            if (!gameLobbies.has(gameId)) {
                gameLobbies.set(gameId, new Set());
            }
            gameLobbies.get(gameId).add(userId);
            userData.currentLobby = gameId;
            socket.join(`game_lobby_${gameId}`);

            // Build list of players in this lobby (excluding self)
            const lobbyPlayers = [];
            for (const uid of gameLobbies.get(gameId)) {
                if (uid === userId) continue;
                const u = onlineUsers.get(uid);
                if (u) {
                    lobbyPlayers.push({
                        id: uid,
                        username: u.username,
                        displayName: u.displayName,
                        avatar: u.avatar,
                    });
                }
            }

            // Send lobby state to joining user
            socket.emit('lobby:game_joined', {
                gameId,
                players: lobbyPlayers,
                playerCount: gameLobbies.get(gameId).size,
            });

            // Notify others in lobby that someone joined
            socket.to(`game_lobby_${gameId}`).emit('lobby:player_joined', {
                userId,
                username: userData.username,
                displayName: userData.displayName,
                avatar: userData.avatar,
                playerCount: gameLobbies.get(gameId).size,
            });

            console.log(`[Lobby] ${userData.username} joined game lobby: ${gameId} (${gameLobbies.get(gameId).size} players)`);
        });

        socket.on('lobby:leave_game', () => {
            if (!userId) return;
            leaveCurrentLobby(userId, socket);
        });

        // ============================================
        // CHALLENGE SYSTEM
        // ============================================
        socket.on('lobby:challenge', async ({ targetUserId, gameId, gameName }) => {
            if (!userId) return;

            const challenger = onlineUsers.get(userId);
            const target = onlineUsers.get(targetUserId);

            if (!challenger || !target) {
                socket.emit('lobby:error', { message: 'Player not found or offline' });
                return;
            }

            // Generate challenge ID
            const challengeId = `ch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

            // Store active challenge (expires in 30 seconds)
            activeChallenges.set(challengeId, {
                from: userId,
                to: targetUserId,
                gameId,
                gameName,
                createdAt: Date.now(),
            });

            // Auto-expire after 30s
            setTimeout(() => {
                const ch = activeChallenges.get(challengeId);
                if (ch && ch.from === userId) {
                    activeChallenges.delete(challengeId);
                    // Notify both parties of expiration
                    const fromSocket = io.sockets.sockets.get(onlineUsers.get(userId)?.socketId);
                    const toSocket = io.sockets.sockets.get(onlineUsers.get(targetUserId)?.socketId);
                    if (fromSocket) fromSocket.emit('lobby:challenge_expired', { challengeId });
                    if (toSocket) toSocket.emit('lobby:challenge_expired', { challengeId });
                }
            }, 30000);

            // Send challenge to target
            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) {
                targetSocket.emit('lobby:challenge_received', {
                    challengeId,
                    from: {
                        id: userId,
                        username: challenger.username,
                        displayName: challenger.displayName,
                        avatar: challenger.avatar,
                    },
                    gameId,
                    gameName,
                });
            }

            // Confirm to challenger
            socket.emit('lobby:challenge_sent', {
                challengeId,
                to: {
                    id: targetUserId,
                    username: target.username,
                    displayName: target.displayName,
                    avatar: target.avatar,
                },
                gameId,
                gameName,
            });

            console.log(`[Lobby] Challenge: ${challenger.username} -> ${target.username} for ${gameName}`);
        });

        socket.on('lobby:challenge_accept', async ({ challengeId }) => {
            if (!userId) return;

            const challenge = activeChallenges.get(challengeId);
            if (!challenge || challenge.to !== userId) {
                socket.emit('lobby:error', { message: 'Challenge not found or expired' });
                return;
            }

            activeChallenges.delete(challengeId);

            const challenger = onlineUsers.get(challenge.from);
            const accepter = onlineUsers.get(userId);

            try {
                // Create match in database
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    const match = await client.query(
                        `INSERT INTO multiplayer_matches (game_id, match_type, status, started_at)
             VALUES ($1, '1v1', 'active', NOW())
             RETURNING id`,
                        [challenge.gameId]
                    );
                    const matchId = match.rows[0].id;

                    await client.query(
                        `INSERT INTO match_participants (match_id, user_id, team)
             VALUES ($1, $2, 1), ($1, $3, 2)`,
                        [matchId, challenge.from, userId]
                    );

                    await client.query('COMMIT');

                    // Notify both players - match is ready!
                    const matchData = {
                        matchId,
                        gameId: challenge.gameId,
                        gameName: challenge.gameName,
                        matchType: '1v1',
                        opponent: null,
                    };

                    // Notify challenger
                    const challengerSocket = io.sockets.sockets.get(challenger?.socketId);
                    if (challengerSocket) {
                        challengerSocket.emit('lobby:match_ready', {
                            ...matchData,
                            opponent: {
                                id: userId,
                                username: accepter?.username,
                                displayName: accepter?.displayName,
                                avatar: accepter?.avatar,
                            },
                        });
                    }

                    // Notify accepter
                    socket.emit('lobby:match_ready', {
                        ...matchData,
                        opponent: {
                            id: challenge.from,
                            username: challenger?.username,
                            displayName: challenger?.displayName,
                            avatar: challenger?.avatar,
                        },
                    });

                    console.log(`[Lobby] Match created: ${matchId} (${challenge.gameName})`);
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('[Lobby] Create match error:', err);
                socket.emit('lobby:error', { message: 'Failed to create match' });
            }
        });

        socket.on('lobby:challenge_decline', ({ challengeId }) => {
            if (!userId) return;

            const challenge = activeChallenges.get(challengeId);
            if (!challenge || challenge.to !== userId) return;

            activeChallenges.delete(challengeId);

            // Notify challenger
            const challenger = onlineUsers.get(challenge.from);
            if (challenger) {
                const challengerSocket = io.sockets.sockets.get(challenger.socketId);
                if (challengerSocket) {
                    const decliner = onlineUsers.get(userId);
                    challengerSocket.emit('lobby:challenge_declined', {
                        challengeId,
                        by: {
                            id: userId,
                            username: decliner?.username,
                            displayName: decliner?.displayName,
                        },
                    });
                }
            }
        });

        socket.on('lobby:challenge_cancel', ({ challengeId }) => {
            if (!userId) return;

            const challenge = activeChallenges.get(challengeId);
            if (!challenge || challenge.from !== userId) return;

            activeChallenges.delete(challengeId);

            // Notify target
            const target = onlineUsers.get(challenge.to);
            if (target) {
                const targetSocket = io.sockets.sockets.get(target.socketId);
                if (targetSocket) {
                    targetSocket.emit('lobby:challenge_cancelled', { challengeId });
                }
            }
        });

        // ============================================
        // AUTO-MATCH (instant queue within lobby)
        // ============================================
        socket.on('lobby:find_anyone', ({ gameId, gameName }) => {
            if (!userId) return;

            const lobby = gameLobbies.get(gameId);
            if (!lobby || lobby.size < 2) {
                socket.emit('lobby:no_opponents', { gameId });
                return;
            }

            // Find first available player (not self) who isn't already in a challenge
            for (const candidateId of lobby) {
                if (candidateId === userId) continue;

                // Check if candidate is in an active challenge
                let inChallenge = false;
                for (const [, ch] of activeChallenges) {
                    if (ch.from === candidateId || ch.to === candidateId) {
                        inChallenge = true;
                        break;
                    }
                }
                if (inChallenge) continue;

                // Auto-challenge this person
                socket.emit('lobby:auto_challenging', {
                    targetId: candidateId,
                    username: onlineUsers.get(candidateId)?.username,
                });

                // Trigger a challenge
                const challengeId = `auto_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                activeChallenges.set(challengeId, {
                    from: userId,
                    to: candidateId,
                    gameId,
                    gameName: gameName || gameId,
                    createdAt: Date.now(),
                });

                // Auto-expire
                setTimeout(() => {
                    if (activeChallenges.has(challengeId)) {
                        activeChallenges.delete(challengeId);
                    }
                }, 30000);

                const targetSocket = io.sockets.sockets.get(onlineUsers.get(candidateId)?.socketId);
                if (targetSocket) {
                    const challenger = onlineUsers.get(userId);
                    targetSocket.emit('lobby:challenge_received', {
                        challengeId,
                        from: {
                            id: userId,
                            username: challenger?.username,
                            displayName: challenger?.displayName,
                            avatar: challenger?.avatar,
                        },
                        gameId,
                        gameName: gameName || gameId,
                    });
                }

                socket.emit('lobby:challenge_sent', {
                    challengeId,
                    to: {
                        id: candidateId,
                        username: onlineUsers.get(candidateId)?.username,
                        displayName: onlineUsers.get(candidateId)?.displayName,
                        avatar: onlineUsers.get(candidateId)?.avatar,
                    },
                    gameId,
                    gameName: gameName || gameId,
                });

                return; // Only challenge one person
            }

            // No available opponents
            socket.emit('lobby:no_opponents', { gameId });
        });

        // ============================================
        // DISCONNECT
        // ============================================
        socket.on('disconnect', () => {
            if (userId) {
                leaveCurrentLobby(userId, socket);
                onlineUsers.delete(userId);
                console.log(`[Lobby] User disconnected: ${userId}`);
            }
        });
    });

    // Periodically clean up stale challenges
    setInterval(() => {
        const now = Date.now();
        for (const [id, ch] of activeChallenges) {
            if (now - ch.createdAt > 35000) {
                activeChallenges.delete(id);
            }
        }
    }, 10000);

    console.log('🎯 Lobby Socket initialized');
    return io;
}

// Helper: remove user from their current game lobby
function leaveCurrentLobby(userId, socket) {
    const userData = onlineUsers.get(userId);
    if (!userData || !userData.currentLobby) return;

    const gameId = userData.currentLobby;
    const lobby = gameLobbies.get(gameId);
    if (lobby) {
        lobby.delete(userId);
        if (lobby.size === 0) {
            gameLobbies.delete(gameId);
        }
    }

    socket.leave(`game_lobby_${gameId}`);
    userData.currentLobby = null;

    // Notify remaining players
    io.to(`game_lobby_${gameId}`).emit('lobby:player_left', {
        userId,
        playerCount: lobby?.size || 0,
    });
}

// Export for use in REST endpoints if needed
export function getOnlineCount() {
    return onlineUsers.size;
}

export function getLobbyCount(gameId) {
    return gameLobbies.get(gameId)?.size || 0;
}
