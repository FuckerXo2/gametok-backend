/**
 * Forge Socket System — Agent-Driven UI over WebSockets
 * 
 * Allows Hermes Agent on the backend to directly drive the Studio UI on mobile.
 * Hermes pushes live thoughts, progress steps, and explicit navigation commands
 * (e.g. NAVIGATE_TO 'directions') directly to the client room, eliminating all
 * client-side polling, artificial timeouts, and out-of-sync bugs.
 */

import { Server } from 'socket.io';
import { getForgeSession } from './ai-engine/forge-session-store.js';

let io = null;

function getRoomName(sessionId) {
    if (!sessionId) return '';
    return sessionId.startsWith('forge_') ? sessionId : `forge_${sessionId}`;
}

export function initializeForgeSocket(server) {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
        path: '/forge',
    });

    io.on('connection', (socket) => {
        let currentSessionId = null;

        socket.on('forge:join', async ({ sessionId }) => {
            if (!sessionId) return;
            currentSessionId = sessionId;
            const roomName = getRoomName(sessionId);
            socket.join(roomName);
            console.log(`🔌 [Forge Socket] Socket ${socket.id} joined room: ${roomName}`);

            try {
                const session = await getForgeSession(sessionId);
                if (session) {
                    socket.emit('forge:sync', session);
                }
            } catch (err) {
                console.warn('[Forge Socket] Error syncing session on join:', err.message);
            }
        });

        socket.on('disconnect', () => {
            if (currentSessionId) {
                const roomName = getRoomName(currentSessionId);
                socket.leave(roomName);
            }
        });
    });

    console.log('⚡ Forge Socket initialized for Hermes Agent-Driven UI at /forge');
}

/**
 * Broadcast Hermes's real-time thought / progress step to the active studio session.
 */
export function broadcastHermesThought(sessionId, { step, phase, message, details = null }) {
    if (!io || !sessionId) return;
    const roomName = getRoomName(sessionId);
    io.to(roomName).emit('hermes:thought', {
        sessionId,
        step,
        phase,
        message,
        details,
        timestamp: Date.now(),
    });
}

/**
 * Broadcast an explicit navigation command from Hermes to the mobile app.
 * Commands include: NAVIGATE_TO { view, ...payload }
 */
export function broadcastHermesCommand(sessionId, command, payload = {}) {
    if (!io || !sessionId) return;
    const roomName = getRoomName(sessionId);
    console.log(`📡 [Forge Socket] Broadcasting Hermes command to ${roomName}: ${command}`);
    io.to(roomName).emit('hermes:command', {
        sessionId,
        command,
        payload,
        timestamp: Date.now(),
    });
}

/**
 * Broadcast an error from Hermes to the mobile app with retry eligibility.
 */
export function broadcastHermesError(sessionId, error) {
    if (!io || !sessionId) return;
    const roomName = getRoomName(sessionId);
    const errorMessage = error?.message || String(error) || 'Generation failed';
    console.warn(`⚠️ [Forge Socket] Broadcasting Hermes error to ${roomName}: ${errorMessage}`);
    io.to(roomName).emit('hermes:error', {
        sessionId,
        message: errorMessage,
        canRetry: true,
        timestamp: Date.now(),
    });
}
