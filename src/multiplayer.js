// Multiplayer Game Server - Socket.io based real-time gaming
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

// In-memory storage for game rooms (use Redis in production)
const gameRooms = new Map();
const playerSockets = new Map(); // odId -> socket
const socketPlayers = new Map(); // socket.id -> userId

// Room states
const ROOM_STATES = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  FINISHED: 'finished',
};

// Game types and their configs
// scoreCompetition: true means both players play same game, highest score wins
const GAME_CONFIGS = {
  // Turn-based games
  'tic-tac-toe': { minPlayers: 2, maxPlayers: 2, turnBased: true },
  'connect4': { minPlayers: 2, maxPlayers: 2, turnBased: true },
  'chess': { minPlayers: 2, maxPlayers: 2, turnBased: true },
  'rock-paper-scissors': { minPlayers: 2, maxPlayers: 2, turnBased: true },
  
  // Real-time games
  'pong': { minPlayers: 2, maxPlayers: 2, turnBased: false, realtime: true },
  
  // Score competition games - ANY game can be played this way
  'tetris': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 120 },
  '2048': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 180 },
  'snake': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'flappy-bird': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'pacman': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'fruit-slicer': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 60 },
  'piano-tiles': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'doodle-jump': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'geometry-dash': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'endless-runner': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'crossy-road': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'breakout': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'ball-bounce': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'whack-a-mole': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 30 },
  'aim-trainer': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 30 },
  'reaction-time': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'color-match': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 60 },
  'memory-match': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'tap-tap-dash': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'number-tap': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 30 },
  'bubble-pop': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 60 },
  'simon-says': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'basketball': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true, timeLimit: 60 },
  'golf-putt': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'snake-io': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'asteroids': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'space-invaders': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'missile-game': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'hexgl': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'racer': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'run3': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'clumsy-bird': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'hextris': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
  'tower-game': { minPlayers: 2, maxPlayers: 2, scoreCompetition: true },
};

export function initMultiplayer(server, db) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[MP] Client connected: ${socket.id}`);

    // Authenticate user
    socket.on('auth', ({ userId, token }) => {
      // In production, verify token against database
      if (userId) {
        socketPlayers.set(socket.id, userId);
        playerSockets.set(userId, socket);
        socket.userId = userId;
        console.log(`[MP] User authenticated: ${userId}`);
        socket.emit('auth:success', { userId });
      }
    });

    // Create a new game room
    socket.on('room:create', ({ gameId, isPrivate = true }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      const config = GAME_CONFIGS[gameId];
      if (!config) {
        socket.emit('error', { message: 'Invalid game type' });
        return;
      }

      const roomId = uuidv4().slice(0, 8).toUpperCase();
      const room = {
        id: roomId,
        gameId,
        hostId: socket.userId,
        players: [{ id: socket.userId, ready: false }],
        state: ROOM_STATES.WAITING,
        isPrivate,
        gameState: null,
        currentTurn: null,
        config,
        createdAt: Date.now(),
      };

      gameRooms.set(roomId, room);
      socket.join(roomId);
      socket.currentRoom = roomId;

      console.log(`[MP] Room created: ${roomId} for game ${gameId}`);
      socket.emit('room:created', { room: sanitizeRoom(room) });
    });


    // Join an existing room
    socket.on('room:join', ({ roomId }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      const room = gameRooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      if (room.state !== ROOM_STATES.WAITING) {
        socket.emit('error', { message: 'Game already in progress' });
        return;
      }

      if (room.players.length >= room.config.maxPlayers) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      // Check if already in room
      if (room.players.find(p => p.id === socket.userId)) {
        socket.emit('error', { message: 'Already in this room' });
        return;
      }

      room.players.push({ id: socket.userId, ready: false });
      socket.join(roomId);
      socket.currentRoom = roomId;

      console.log(`[MP] User ${socket.userId} joined room ${roomId}`);
      
      // Notify all players in room
      io.to(roomId).emit('room:playerJoined', { 
        room: sanitizeRoom(room),
        playerId: socket.userId 
      });
    });

    // Leave room
    socket.on('room:leave', () => {
      handleLeaveRoom(socket, io);
    });

    // Player ready toggle
    socket.on('room:ready', ({ ready }) => {
      if (!socket.currentRoom) return;
      
      const room = gameRooms.get(socket.currentRoom);
      if (!room) return;

      const player = room.players.find(p => p.id === socket.userId);
      if (player) {
        player.ready = ready;
        io.to(socket.currentRoom).emit('room:updated', { room: sanitizeRoom(room) });

        // Check if all players ready and room is full
        const allReady = room.players.every(p => p.ready);
        const roomFull = room.players.length >= room.config.minPlayers;
        
        if (allReady && roomFull) {
          startGame(room, io);
        }
      }
    });


    // Game move (for turn-based games)
    socket.on('game:move', ({ move }) => {
      if (!socket.currentRoom) return;
      
      const room = gameRooms.get(socket.currentRoom);
      if (!room || room.state !== ROOM_STATES.PLAYING) return;

      // Verify it's this player's turn (for turn-based games)
      if (room.config.turnBased && room.currentTurn !== socket.userId) {
        socket.emit('error', { message: 'Not your turn' });
        return;
      }

      // Process the move based on game type
      const result = processGameMove(room, socket.userId, move);
      
      if (result.valid) {
        room.gameState = result.newState;
        
        // Switch turns for turn-based games
        if (room.config.turnBased) {
          const currentIndex = room.players.findIndex(p => p.id === socket.userId);
          const nextIndex = (currentIndex + 1) % room.players.length;
          room.currentTurn = room.players[nextIndex].id;
        }

        // Broadcast updated state
        io.to(socket.currentRoom).emit('game:state', {
          gameState: room.gameState,
          currentTurn: room.currentTurn,
          lastMove: { playerId: socket.userId, move },
        });

        // Check for game over
        if (result.gameOver) {
          room.state = ROOM_STATES.FINISHED;
          io.to(socket.currentRoom).emit('game:over', {
            winner: result.winner,
            reason: result.reason,
            finalState: room.gameState,
          });
        }
      } else {
        socket.emit('error', { message: result.error || 'Invalid move' });
      }
    });

    // Real-time game update (for non-turn-based games like Pong)
    socket.on('game:update', ({ state }) => {
      if (!socket.currentRoom) return;
      
      const room = gameRooms.get(socket.currentRoom);
      if (!room || room.state !== ROOM_STATES.PLAYING) return;

      // Broadcast to other players (not sender)
      socket.to(socket.currentRoom).emit('game:peerUpdate', {
        playerId: socket.userId,
        state,
      });
    });

    // Find random opponent (matchmaking)
    socket.on('matchmaking:find', ({ gameId }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }

      // Look for existing waiting public room
      for (const [roomId, room] of gameRooms) {
        if (
          room.gameId === gameId &&
          !room.isPrivate &&
          room.state === ROOM_STATES.WAITING &&
          room.players.length < room.config.maxPlayers
        ) {
          // Join this room
          room.players.push({ id: socket.userId, ready: true });
          socket.join(roomId);
          socket.currentRoom = roomId;

          io.to(roomId).emit('room:playerJoined', {
            room: sanitizeRoom(room),
            playerId: socket.userId,
          });

          // Auto-start if room is full
          if (room.players.length >= room.config.minPlayers) {
            room.players.forEach(p => p.ready = true);
            startGame(room, io);
          }
          return;
        }
      }

      // No room found, create new public room
      const config = GAME_CONFIGS[gameId];
      if (!config) {
        socket.emit('error', { message: 'Invalid game type' });
        return;
      }

      const roomId = uuidv4().slice(0, 8).toUpperCase();
      const room = {
        id: roomId,
        gameId,
        hostId: socket.userId,
        players: [{ id: socket.userId, ready: true }],
        state: ROOM_STATES.WAITING,
        isPrivate: false,
        gameState: null,
        currentTurn: null,
        config,
        createdAt: Date.now(),
      };

      gameRooms.set(roomId, room);
      socket.join(roomId);
      socket.currentRoom = roomId;

      socket.emit('matchmaking:waiting', { room: sanitizeRoom(room) });
    });

    // Cancel matchmaking
    socket.on('matchmaking:cancel', () => {
      handleLeaveRoom(socket, io);
    });

    // ============================================
    // SCORE COMPETITION EVENTS
    // ============================================

    // Update score during score competition
    socket.on('competition:score', ({ score }) => {
      if (!socket.currentRoom) return;
      
      const room = gameRooms.get(socket.currentRoom);
      if (!room || room.state !== ROOM_STATES.PLAYING) return;
      if (!room.config.scoreCompetition) return;

      // Update player's score
      room.gameState.scores[socket.userId] = score;
      
      // Broadcast to opponent
      socket.to(socket.currentRoom).emit('competition:opponentScore', {
        score,
        playerId: socket.userId,
      });
    });

    // Player finished their game
    socket.on('competition:finished', ({ finalScore }) => {
      if (!socket.currentRoom) return;
      
      const room = gameRooms.get(socket.currentRoom);
      if (!room || room.state !== ROOM_STATES.PLAYING) return;
      if (!room.config.scoreCompetition) return;

      room.gameState.scores[socket.userId] = finalScore;
      room.gameState.finished[socket.userId] = true;

      // Notify opponent
      socket.to(socket.currentRoom).emit('competition:opponentFinished', {
        score: finalScore,
        playerId: socket.userId,
      });

      // Check if both players finished
      const allFinished = room.players.every(p => room.gameState.finished[p.id]);
      if (allFinished) {
        // Determine winner
        const scores = room.gameState.scores;
        const [p1, p2] = room.players;
        let winner = null;
        
        if (scores[p1.id] > scores[p2.id]) winner = p1.id;
        else if (scores[p2.id] > scores[p1.id]) winner = p2.id;
        // else it's a draw, winner stays null

        room.state = ROOM_STATES.FINISHED;
        
        io.to(socket.currentRoom).emit('game:over', {
          winner,
          reason: winner ? 'win' : 'draw',
          finalScores: scores,
        });
      }
    });

    // Invite friend to game
    socket.on('invite:send', ({ friendId, gameId }) => {
      if (!socket.userId) return;

      const friendSocket = playerSockets.get(friendId);
      if (friendSocket) {
        friendSocket.emit('invite:received', {
          fromUserId: socket.userId,
          gameId,
          roomId: socket.currentRoom,
        });
      }
      // Could also store invite in DB for offline users
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      console.log(`[MP] Client disconnected: ${socket.id}`);
      handleLeaveRoom(socket, io);
      
      if (socket.userId) {
        playerSockets.delete(socket.userId);
        socketPlayers.delete(socket.id);
      }
    });
  });

  // Helper: Handle player leaving room
  function handleLeaveRoom(socket, io) {
    if (!socket.currentRoom) return;

    const room = gameRooms.get(socket.currentRoom);
    if (!room) return;

    const roomId = socket.currentRoom;
    room.players = room.players.filter(p => p.id !== socket.userId);
    socket.leave(roomId);
    socket.currentRoom = null;

    if (room.players.length === 0) {
      // Delete empty room
      gameRooms.delete(roomId);
      console.log(`[MP] Room ${roomId} deleted (empty)`);
    } else {
      // Notify remaining players
      io.to(roomId).emit('room:playerLeft', {
        room: sanitizeRoom(room),
        playerId: socket.userId,
      });

      // If game was in progress, end it
      if (room.state === ROOM_STATES.PLAYING) {
        room.state = ROOM_STATES.FINISHED;
        io.to(roomId).emit('game:over', {
          winner: room.players[0]?.id,
          reason: 'opponent_left',
        });
      }

      // Assign new host if needed
      if (room.hostId === socket.userId && room.players.length > 0) {
        room.hostId = room.players[0].id;
      }
    }
  }

  // Helper: Start the game
  function startGame(room, io) {
    room.state = ROOM_STATES.PLAYING;
    room.gameState = initializeGameState(room.gameId, room.players, room.config);
    room.currentTurn = room.config.scoreCompetition ? null : room.players[0].id;

    console.log(`[MP] Game started in room ${room.id} (${room.config.scoreCompetition ? 'score competition' : 'turn-based'})`);
    
    io.to(room.id).emit('game:start', {
      room: sanitizeRoom(room),
      gameState: room.gameState,
      currentTurn: room.currentTurn,
      isScoreCompetition: room.config.scoreCompetition || false,
      timeLimit: room.config.timeLimit || null,
    });
  }

  // Helper: Sanitize room data for client
  function sanitizeRoom(room) {
    return {
      id: room.id,
      gameId: room.gameId,
      hostId: room.hostId,
      players: room.players,
      state: room.state,
      isPrivate: room.isPrivate,
      maxPlayers: room.config.maxPlayers,
      isScoreCompetition: room.config.scoreCompetition || false,
      timeLimit: room.config.timeLimit || null,
    };
  }

  return io;
}


// ============================================
// GAME-SPECIFIC LOGIC
// ============================================

// Initialize game state based on game type
function initializeGameState(gameId, players, config) {
  // Score competition games
  if (config?.scoreCompetition) {
    return {
      scores: { [players[0].id]: 0, [players[1].id]: 0 },
      finished: { [players[0].id]: false, [players[1].id]: false },
      timeLimit: config.timeLimit || null,
      startTime: Date.now(),
    };
  }

  switch (gameId) {
    case 'tic-tac-toe':
      return {
        board: Array(9).fill(null), // 3x3 grid as flat array
        symbols: { [players[0].id]: 'X', [players[1].id]: 'O' },
      };
    
    case 'connect4':
      return {
        board: Array(6).fill(null).map(() => Array(7).fill(null)), // 6 rows x 7 cols
        symbols: { [players[0].id]: 'red', [players[1].id]: 'yellow' },
      };
    
    case 'rock-paper-scissors':
      return {
        choices: {},
        round: 1,
        scores: { [players[0].id]: 0, [players[1].id]: 0 },
        maxRounds: 3,
      };
    
    case 'chess':
      return {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        colors: { [players[0].id]: 'white', [players[1].id]: 'black' },
        moves: [],
      };
    
    case 'pong':
      return {
        ball: { x: 0.5, y: 0.5, vx: 0.01, vy: 0.01 },
        paddles: { [players[0].id]: 0.5, [players[1].id]: 0.5 },
        scores: { [players[0].id]: 0, [players[1].id]: 0 },
        maxScore: 5,
      };
    
    default:
      return {};
  }
}

// Process a game move and return result
function processGameMove(room, playerId, move) {
  const { gameId, gameState, players } = room;

  switch (gameId) {
    case 'tic-tac-toe':
      return processTicTacToeMove(gameState, playerId, move, players);
    
    case 'connect4':
      return processConnect4Move(gameState, playerId, move, players);
    
    case 'rock-paper-scissors':
      return processRPSMove(gameState, playerId, move, players);
    
    default:
      return { valid: true, newState: gameState };
  }
}


// Tic-Tac-Toe move processing
function processTicTacToeMove(state, playerId, move, players) {
  const { position } = move; // 0-8
  
  if (position < 0 || position > 8 || state.board[position] !== null) {
    return { valid: false, error: 'Invalid position' };
  }

  const newBoard = [...state.board];
  newBoard[position] = state.symbols[playerId];

  const newState = { ...state, board: newBoard };

  // Check for winner
  const winner = checkTicTacToeWinner(newBoard);
  if (winner) {
    const winnerId = Object.keys(state.symbols).find(id => state.symbols[id] === winner);
    return { valid: true, newState, gameOver: true, winner: winnerId, reason: 'win' };
  }

  // Check for draw
  if (newBoard.every(cell => cell !== null)) {
    return { valid: true, newState, gameOver: true, winner: null, reason: 'draw' };
  }

  return { valid: true, newState };
}

function checkTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6], // diagonals
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

// Connect4 move processing
function processConnect4Move(state, playerId, move, players) {
  const { column } = move; // 0-6
  
  if (column < 0 || column > 6) {
    return { valid: false, error: 'Invalid column' };
  }

  // Find lowest empty row in column
  let row = -1;
  for (let r = 5; r >= 0; r--) {
    if (state.board[r][column] === null) {
      row = r;
      break;
    }
  }

  if (row === -1) {
    return { valid: false, error: 'Column is full' };
  }

  const newBoard = state.board.map(r => [...r]);
  newBoard[row][column] = state.symbols[playerId];

  const newState = { ...state, board: newBoard };

  // Check for winner
  if (checkConnect4Winner(newBoard, row, column, state.symbols[playerId])) {
    return { valid: true, newState, gameOver: true, winner: playerId, reason: 'win' };
  }

  // Check for draw (board full)
  const isFull = newBoard[0].every(cell => cell !== null);
  if (isFull) {
    return { valid: true, newState, gameOver: true, winner: null, reason: 'draw' };
  }

  return { valid: true, newState };
}

function checkConnect4Winner(board, row, col, symbol) {
  const directions = [
    [0, 1],  // horizontal
    [1, 0],  // vertical
    [1, 1],  // diagonal down-right
    [1, -1], // diagonal down-left
  ];

  for (const [dr, dc] of directions) {
    let count = 1;
    
    // Check positive direction
    for (let i = 1; i < 4; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === symbol) {
        count++;
      } else break;
    }
    
    // Check negative direction
    for (let i = 1; i < 4; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === symbol) {
        count++;
      } else break;
    }

    if (count >= 4) return true;
  }
  return false;
}


// Rock-Paper-Scissors move processing
function processRPSMove(state, playerId, move, players) {
  const { choice } = move; // 'rock' | 'paper' | 'scissors'
  
  if (!['rock', 'paper', 'scissors'].includes(choice)) {
    return { valid: false, error: 'Invalid choice' };
  }

  const newState = { ...state, choices: { ...state.choices, [playerId]: choice } };

  // Check if both players have made their choice
  if (Object.keys(newState.choices).length === 2) {
    const [p1, p2] = players;
    const c1 = newState.choices[p1.id];
    const c2 = newState.choices[p2.id];

    let roundWinner = null;
    if (c1 !== c2) {
      if (
        (c1 === 'rock' && c2 === 'scissors') ||
        (c1 === 'paper' && c2 === 'rock') ||
        (c1 === 'scissors' && c2 === 'paper')
      ) {
        roundWinner = p1.id;
      } else {
        roundWinner = p2.id;
      }
      newState.scores[roundWinner]++;
    }

    // Check if game is over
    const maxScore = Math.ceil(newState.maxRounds / 2);
    if (newState.scores[p1.id] >= maxScore) {
      return { valid: true, newState, gameOver: true, winner: p1.id, reason: 'win' };
    }
    if (newState.scores[p2.id] >= maxScore) {
      return { valid: true, newState, gameOver: true, winner: p2.id, reason: 'win' };
    }

    // Next round
    if (newState.round >= newState.maxRounds) {
      // Determine winner by score
      const winner = newState.scores[p1.id] > newState.scores[p2.id] ? p1.id :
                     newState.scores[p2.id] > newState.scores[p1.id] ? p2.id : null;
      return { valid: true, newState, gameOver: true, winner, reason: winner ? 'win' : 'draw' };
    }

    newState.round++;
    newState.choices = {}; // Reset for next round
  }

  return { valid: true, newState };
}

export { GAME_CONFIGS, ROOM_STATES };
