const { Server } = require('socket.io');
const db = require('./db');

let io;

// Active PK matches in memory
const activePkMatches = new Map();

function initializePkSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('PK Socket connected:', socket.id);

    // Join PK match room
    socket.on('pk:join', async ({ matchId, userId }) => {
      socket.join(`pk_${matchId}`);
      socket.userId = userId;
      socket.matchId = matchId;

      // Get match data
      const match = await db.get(
        'SELECT * FROM multiplayer_matches WHERE id = ?',
        [matchId]
      );

      // Notify room that player joined
      io.to(`pk_${matchId}`).emit('pk:player_joined', {
        userId,
        timestamp: Date.now()
      });

      console.log(`User ${userId} joined PK match ${matchId}`);
    });

    // Player ready
    socket.on('pk:ready', async ({ matchId, userId }) => {
      io.to(`pk_${matchId}`).emit('pk:player_ready', { userId });

      // Check if all players ready
      const match = activePkMatches.get(matchId) || { readyPlayers: [] };
      match.readyPlayers = match.readyPlayers || [];
      match.readyPlayers.push(userId);
      activePkMatches.set(matchId, match);

      // If all players ready, start countdown
      const participants = await db.all(
        'SELECT user_id FROM match_participants WHERE match_id = ?',
        [matchId]
      );

      if (match.readyPlayers.length === participants.length) {
        io.to(`pk_${matchId}`).emit('pk:countdown_start', {
          seconds: 3
        });

        setTimeout(() => {
          io.to(`pk_${matchId}`).emit('pk:game_start');
        }, 3000);
      }
    });

    // Score update
    socket.on('pk:score', async ({ matchId, userId, score }) => {
      // Broadcast to all players in room
      socket.to(`pk_${matchId}`).emit('pk:score_update', {
        userId,
        score,
        timestamp: Date.now()
      });

      // Update in database
      await db.run(
        'UPDATE match_participants SET score = ? WHERE match_id = ? AND user_id = ?',
        [score, matchId, userId]
      );

      console.log(`PK ${matchId}: User ${userId} score: ${score}`);
    });

    // Game over
    socket.on('pk:game_over', async ({ matchId, userId, finalScore }) => {
      // Update final score
      await db.run(
        'UPDATE match_participants SET score = ?, completed_at = CURRENT_TIMESTAMP WHERE match_id = ? AND user_id = ?',
        [finalScore, matchId, userId]
      );

      // Check if all players finished
      const participants = await db.all(
        'SELECT user_id, score FROM match_participants WHERE match_id = ? AND completed_at IS NOT NULL',
        [matchId]
      );

      const allParticipants = await db.all(
        'SELECT user_id FROM match_participants WHERE match_id = ?',
        [matchId]
      );

      if (participants.length === allParticipants.length) {
        // All players finished - determine winner
        const winner = participants.reduce((prev, current) => 
          (current.score > prev.score) ? current : prev
        );

        // Update match status
        await db.run(
          'UPDATE multiplayer_matches SET status = ?, winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['completed', winner.user_id, matchId]
        );

        // Distribute rewards
        for (const participant of participants) {
          let coins = 25; // Participation reward
          if (participant.user_id === winner.user_id) {
            coins = 100; // Winner reward
          }

          await db.run(
            'UPDATE users SET coins = coins + ? WHERE id = ?',
            [coins, participant.user_id]
          );
        }

        // Broadcast results
        io.to(`pk_${matchId}`).emit('pk:match_end', {
          winnerId: winner.user_id,
          scores: participants,
          rewards: participants.map(p => ({
            userId: p.user_id,
            coins: p.user_id === winner.user_id ? 100 : 25
          }))
        });

        // Clean up
        activePkMatches.delete(matchId);
      }
    });

    // Chat message
    socket.on('pk:chat', ({ matchId, userId, message }) => {
      io.to(`pk_${matchId}`).emit('pk:chat_message', {
        userId,
        message,
        timestamp: Date.now()
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      if (socket.matchId) {
        io.to(`pk_${socket.matchId}`).emit('pk:player_left', {
          userId: socket.userId
        });
      }
      console.log('PK Socket disconnected:', socket.id);
    });
  });

  return io;
}

module.exports = { initializePkSocket };
