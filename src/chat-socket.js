/**
 * Chat Socket System
 * 
 * Real-time messaging features:
 * - Typing indicators
 * - Real-time message delivery
 * - Read receipts
 * - Online presence for DMs
 */

import { Server } from 'socket.io';
import pool from './db.js';

let io;

// In-memory state
const onlineUsers = new Map(); // userId -> { socketId, username }
const typingUsers = new Map(); // `${conversationId}_${userId}` -> timeout

export function initializeChatSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    path: '/chat',
  });

  io.on('connection', (socket) => {
    console.log('[Chat] Socket connected:', socket.id);
    let userId = null;

    // ============================================
    // AUTHENTICATION
    // ============================================
    socket.on('chat:auth', async ({ token }) => {
      try {
        const result = await pool.query(
          'SELECT id, username FROM users WHERE token = $1',
          [token]
        );

        if (result.rows.length === 0) {
          socket.emit('chat:error', { message: 'Invalid token' });
          return;
        }

        const user = result.rows[0];
        userId = user.id;

        // Track user as online
        onlineUsers.set(userId, {
          socketId: socket.id,
          username: user.username,
        });

        socket.userId = userId;
        socket.emit('chat:authenticated', { userId });

        console.log(`[Chat] User authenticated: ${user.username} (${userId})`);
      } catch (err) {
        console.error('[Chat] Auth error:', err);
        socket.emit('chat:error', { message: 'Authentication failed' });
      }
    });

    // ============================================
    // JOIN CONVERSATION (for receiving messages)
    // ============================================
    socket.on('chat:join', ({ conversationId }) => {
      if (!userId) return;
      socket.join(`conv_${conversationId}`);
      console.log(`[Chat] User ${userId} joined conversation ${conversationId}`);
    });

    socket.on('chat:leave', ({ conversationId }) => {
      if (!userId) return;
      socket.leave(`conv_${conversationId}`);
      
      // Clear typing indicator when leaving
      const typingKey = `${conversationId}_${userId}`;
      if (typingUsers.has(typingKey)) {
        clearTimeout(typingUsers.get(typingKey));
        typingUsers.delete(typingKey);
        socket.to(`conv_${conversationId}`).emit('chat:typing_stop', {
          conversationId,
          userId,
        });
      }
    });

    // ============================================
    // TYPING INDICATORS
    // ============================================
    socket.on('chat:typing', ({ conversationId }) => {
      if (!userId) return;

      const typingKey = `${conversationId}_${userId}`;
      
      // Clear existing timeout
      if (typingUsers.has(typingKey)) {
        clearTimeout(typingUsers.get(typingKey));
      }

      // Broadcast typing to others in conversation
      socket.to(`conv_${conversationId}`).emit('chat:typing', {
        conversationId,
        userId,
      });

      // Auto-stop typing after 3 seconds of no activity
      const timeout = setTimeout(() => {
        typingUsers.delete(typingKey);
        socket.to(`conv_${conversationId}`).emit('chat:typing_stop', {
          conversationId,
          userId,
        });
      }, 3000);

      typingUsers.set(typingKey, timeout);
    });

    socket.on('chat:typing_stop', ({ conversationId }) => {
      if (!userId) return;

      const typingKey = `${conversationId}_${userId}`;
      if (typingUsers.has(typingKey)) {
        clearTimeout(typingUsers.get(typingKey));
        typingUsers.delete(typingKey);
      }

      socket.to(`conv_${conversationId}`).emit('chat:typing_stop', {
        conversationId,
        userId,
      });
    });

    // ============================================
    // REAL-TIME MESSAGE DELIVERY
    // ============================================
    socket.on('chat:message', async ({ conversationId, text, gameShare }) => {
      if (!userId) return;

      try {
        // Get user info
        const userResult = await pool.query(
          'SELECT username FROM users WHERE id = $1',
          [userId]
        );
        const username = userResult.rows[0]?.username;

        // Build message text
        let messageText = text || '';
        let gameData = null;

        if (gameShare?.gameId) {
          const gameResult = await pool.query('SELECT * FROM games WHERE id = $1', [gameShare.gameId]);
          if (gameResult.rows.length > 0) {
            const game = gameResult.rows[0];
            const isChallenge = gameShare.isChallenge || false;
            gameData = {
              id: game.id,
              name: game.name,
              icon: game.icon,
              color: game.color,
              thumbnail: game.thumbnail,
              isChallenge,
            };
            const prefix = isChallenge ? '[CHALLENGE:' : '[GAME:';
            messageText = `${prefix}${game.id}] ${messageText || (isChallenge ? `${username} challenged you!` : `Check out ${game.name}!`)}`;
          }
        }

        // Insert message into database
        const result = await pool.query(
          'INSERT INTO messages (conversation_id, sender_id, text, read_by) VALUES ($1, $2, $3, $4) RETURNING *',
          [conversationId, userId, messageText, [userId]]
        );
        
        await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

        const message = result.rows[0];

        // Clear typing indicator
        const typingKey = `${conversationId}_${userId}`;
        if (typingUsers.has(typingKey)) {
          clearTimeout(typingUsers.get(typingKey));
          typingUsers.delete(typingKey);
        }

        // Broadcast message to all in conversation (including sender for confirmation)
        io.to(`conv_${conversationId}`).emit('chat:new_message', {
          conversationId,
          message: {
            id: message.id,
            text: message.text,
            senderId: userId,
            createdAt: message.created_at,
            isRead: false,
            gameShare: gameData,
          },
        });

        // Also emit typing_stop
        socket.to(`conv_${conversationId}`).emit('chat:typing_stop', {
          conversationId,
          userId,
        });

      } catch (err) {
        console.error('[Chat] Message error:', err);
        socket.emit('chat:error', { message: 'Failed to send message' });
      }
    });

    // ============================================
    // READ RECEIPTS
    // ============================================
    socket.on('chat:read', async ({ conversationId, messageIds }) => {
      if (!userId || !messageIds?.length) return;

      try {
        // Mark messages as read in database
        await pool.query(
          `UPDATE messages SET read_by = array_append(read_by, $1) 
           WHERE conversation_id = $2 AND id = ANY($3) AND NOT ($1 = ANY(read_by))`,
          [userId, conversationId, messageIds]
        );

        // Broadcast read receipt to conversation
        socket.to(`conv_${conversationId}`).emit('chat:messages_read', {
          conversationId,
          messageIds,
          readBy: userId,
        });

      } catch (err) {
        console.error('[Chat] Read receipt error:', err);
      }
    });

    // ============================================
    // CHECK IF USER IS ONLINE
    // ============================================
    socket.on('chat:check_online', ({ userIds }) => {
      if (!userId) return;

      const onlineStatus = {};
      for (const uid of userIds) {
        onlineStatus[uid] = onlineUsers.has(uid);
      }

      socket.emit('chat:online_status', { users: onlineStatus });
    });

    // ============================================
    // DISCONNECT
    // ============================================
    socket.on('disconnect', () => {
      if (userId) {
        // Clear all typing indicators for this user
        for (const [key, timeout] of typingUsers) {
          if (key.endsWith(`_${userId}`)) {
            clearTimeout(timeout);
            typingUsers.delete(key);
            const conversationId = key.split('_')[0];
            io.to(`conv_${conversationId}`).emit('chat:typing_stop', {
              conversationId,
              userId,
            });
          }
        }

        onlineUsers.delete(userId);
        console.log(`[Chat] User disconnected: ${userId}`);
      }
    });
  });

  console.log('💬 Chat Socket initialized');
  return io;
}

// Export for checking online status from REST endpoints
export function isUserOnline(userId) {
  return onlineUsers.has(userId);
}

export function getOnlineUsers() {
  return Array.from(onlineUsers.keys());
}
