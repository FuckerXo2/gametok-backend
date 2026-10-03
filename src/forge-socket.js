/**
 * Forge Socket System — Agent-Driven UI over WebSockets
 * 
 * Allows Hermes Agent on the backend to directly drive the Studio UI on mobile.
 * Hermes pushes live thoughts, progress steps, and explicit navigation commands
 * (e.g. NAVIGATE_TO 'directions') directly to the client room, eliminating all
 * client-side polling, artificial timeouts, and out-of-sync bugs.
 */

import { Server } from 'socket.io';
import { getForgeSession } from './ai-engine/routes.js';

let io = null;

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
            const roomName = `forge_${sessionId}`;
            socket.join(roomName);

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
                socket.leave(`forge_${currentSessionId}`);
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
    io.to(`forge_${sessionId}`).emit('hermes:thought', {
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
    console.log(`📡 [Forge Socket] Broadcasting Hermes command to forge_${sessionId}: ${command}`);
    io.to(`forge_${sessionId}`).emit('hermes:command', {
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
    const errorMessage = error?.message || String(error) || 'Generation failed';
    console.warn(`⚠️ [Forge Socket] Broadcasting Hermes error to forge_${sessionId}: ${errorMessage}`);
    io.to(`forge_${sessionId}`).emit('hermes:error', {
        sessionId,
        message: errorMessage,
        canRetry: true,
        timestamp: Date.now(),
    });
}
