import { Server } from 'socket.io';
import pool from './db.js';

let io;

// Active PK matches in memory
const activePkMatches = new Map();

export function initializePkSocket(server) {
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

      try {
        // Get match data
        const matchResult = await pool.query(
          'SELECT * FROM multiplayer_matches WHERE id = $1',
          [matchId]
        );

        // Notify room that player joined
        io.to(`pk_${matchId}`).emit('pk:player_joined', {
          userId,
          timestamp: Date.now()
        });

        console.log(`User ${userId} joined PK match ${matchId}`);
      } catch (err) {
        console.error('Error joining PK room:', err);
      }
    });

    // Player ready
    socket.on('pk:ready', async ({ matchId, userId }) => {
      io.to(`pk_${matchId}`).emit('pk:player_ready', { userId });

      // Check if all players ready
      const match = activePkMatches.get(matchId) || { readyPlayers: [] };
      match.readyPlayers = match.readyPlayers || [];
      if (!match.readyPlayers.includes(userId)) {
        match.readyPlayers.push(userId);
      }
      activePkMatches.set(matchId, match);

      try {
        // If all players ready, start countdown
        const participantsResult = await pool.query(
          'SELECT user_id FROM match_participants WHERE match_id = $1',
          [matchId]
        );
        const participants = participantsResult.rows;

        if (match.readyPlayers.length === participants.length && participants.length > 0) {
          io.to(`pk_${matchId}`).emit('pk:countdown_start', {
            seconds: 3
          });

          setTimeout(() => {
            io.to(`pk_${matchId}`).emit('pk:game_start');
          }, 3000);
        }
      } catch (err) {
        console.error('Error handling player ready:', err);
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

      try {
        // Update in database
        await pool.query(
          'UPDATE match_participants SET score = $1 WHERE match_id = $2 AND user_id = $3',
          [score, matchId, userId]
        );

        console.log(`PK ${matchId}: User ${userId} score: ${score}`);
      } catch (err) {
        console.error('Error updating PK score:', err);
      }
    });

    // Game over
    socket.on('pk:game_over', async ({ matchId, userId, finalScore }) => {
      try {
        // Update final score
        await pool.query(
          "UPDATE match_participants SET score = $1, status = 'finished' WHERE match_id = $2 AND user_id = $3",
          [finalScore, matchId, userId]
        );

        // Check if all players finished
        const participantsResult = await pool.query(
          "SELECT user_id, score FROM match_participants WHERE match_id = $1 AND status = 'finished'",
          [matchId]
        );
        const finishedParticipants = participantsResult.rows;

        const allParticipantsResult = await pool.query(
          'SELECT user_id FROM match_participants WHERE match_id = $1',
          [matchId]
        );
        const allParticipants = allParticipantsResult.rows;

        if (finishedParticipants.length === allParticipants.length && allParticipants.length > 0) {
          // All players finished - determine winner
          const winner = finishedParticipants.reduce((prev, current) =>
            (current.score > prev.score) ? current : prev
          );

          const teamResult = await pool.query(
            'SELECT team FROM match_participants WHERE match_id = $1 AND user_id = $2',
            [matchId, winner.user_id]
          );
          const winnerTeam = teamResult.rows[0]?.team || null;

          // Update match status
          await pool.query(
            "UPDATE multiplayer_matches SET status = 'completed', winner_team = $1, ended_at = CURRENT_TIMESTAMP WHERE id = $2",
            [winnerTeam, matchId]
          );

          // PK rewards system removed

          // Broadcast results
          io.to(`pk_${matchId}`).emit('pk:match_end', {
            winnerId: winner.user_id,
            scores: finishedParticipants
          });

          // Clean up
          activePkMatches.delete(matchId);
        }
      } catch (err) {
        console.error('Error handling game over:', err);
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
