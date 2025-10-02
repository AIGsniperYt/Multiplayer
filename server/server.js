/*
  AIGsniper copyright © 2025 - all rights reserved
*/

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 334;

// CORS at the very top - BEFORE any other middleware
app.use(cors({
  origin: function (origin, callback) {
    // 1. Allow requests with no origin (like from mobile apps, Postman, or same-origin requests)
    if (!origin) {
      console.log('CORS: No origin header (likely same-origin request). Allowing.');
      return callback(null, true);
    }

    // 2. List of allowed origins
    const allowedOrigins = [
      "https://aigsniperyt.github.io", // Your GitHub Pages site
      "http://localhost:3000",         // Local React dev server
      "http://127.0.0.1:5500",         // Local Live Server (VS Code)
      "http://localhost:5500",         // Another common Live Server port
      "https://aigsniperyt.github.io"  // Duplicate but explicit
    ];

    // 3. Check if the origin is in the allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 4. Log the blocked origin for debugging
      console.log('🚫 CORS: BLOCKING request from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight OPTIONS requests for ALL routes
app.options('*', cors());

// JSON middleware - AFTER CORS
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  // 1. Set Cache-Control for all responses
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  // 2. Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // 3. Remove the X-Powered-By header (often done by Helmet.js)
  res.removeHeader('X-Powered-By');
  
  // 4. (Bonus) Other very important security headers
  // This defines which features and APIs can be used in the browser (e.g., prevent misuse of microphone/camera)
  res.setHeader('Permissions-Policy', 'interest-cohort=()');
  // This helps prevent clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');
  
  next();
});

// Static files AFTER CORS and other middleware
app.use(express.static(path.join(__dirname, '..')));

// === Long polling storage ===
const longPollingClients = new Map();
const users = new Map();
const pendingUsers = new Map(); // Users waiting for approval
const messages = [];
const rooms = new Map(); // New: Room storage
const chessGames = new Map(); // gameId -> gameState
const clients = new Map(); // For tracking connected clients

rooms.set('global', {
  id: 'global',
  name: 'Global Chat',
  users: new Set(),
  isDM: false,
  messages: []
});

// === Server Activation System ===
let isServerActive = false;
let activeModerator = null;
let isServerLocked = false;
const SERVER_ACTIVATION_PASSWORD = "esports2024";
const MOD_TIMEOUT = 1800000;   // 30 mins for moderators (more tolerant)
const CLIENT_TIMEOUT = 60000;    // 60 seconds for normal clients
const MOD_CHECK_INTERVAL = 10000; // check every 10s

setInterval(() => {
  if (isServerActive && activeModerator) {
    const mod = users.get(activeModerator);
    if (!mod || Date.now() - (mod.lastCheck || 0) > MOD_TIMEOUT) {
      console.log("Moderator timed out - deactivating server");
      deactivateServer();
    }
  } else if (isServerActive && !activeModerator) {
    // No active moderator but server is active - deactivate immediately
    console.log("No active moderator - deactivating server");
    deactivateServer();
  }
}, MOD_CHECK_INTERVAL);

function activateServer(modClientId) {
  isServerActive = true;
  activeModerator = modClientId;
  console.log(`Server activated by moderator: ${users.get(modClientId)?.username}`);
  broadcastToAll('server_activated', {});
}

function deactivateServer() {
  isServerActive = false;
  
  // Store the list of users to kick before broadcasting
  const usersToKick = Array.from(users.keys());
  const moderatorName = activeModerator ? users.get(activeModerator)?.username : 'Unknown';
  
  activeModerator = null;
  console.log("Server deactivated - requires moderator");

  // First broadcast the deactivation message
  broadcastToAll('server_deactivated', {});
  
  // Kick all users immediately (no delay needed)
  usersToKick.forEach(userId => {
    // Send kick notification
    const client = longPollingClients.get(userId);
    if (client && client.res && !client.res.finished) {
      try {
        client.res.json({ 
          events: [{ 
            event: 'kicked', 
            data: { reason: 'Server deactivated due to moderator leaving' },
            timestamp: Date.now()
          }], 
          timestamp: Date.now() 
        });
      } catch (e) {
        console.log('Error sending kick notification:', e);
      }
    }
    
    // Remove from tracking
    users.delete(userId);
    longPollingClients.delete(userId);
  });
  
  // Clear all messages and rooms (except global)
  messages.length = 0;
  rooms.forEach((room, roomId) => {
    if (roomId !== 'global') {
      rooms.delete(roomId);
    } else {
      // Clear global room messages but keep the room
      room.messages.length = 0;
      room.users.clear();
    }
  });
  
  console.log(`All users kicked due to server deactivation by ${moderatorName}`);
}

// === DM Room Cleanup Function ===
function cleanupEmptyDMRooms() {
    rooms.forEach((room, roomId) => {
        // Only check DM rooms (not global or other room types)
        if (room.isDM && roomId !== 'global') {
            // Count active users (users that still exist in the users map)
            let activeUserCount = 0;
            const activeUsers = [];
            
            room.users.forEach(userId => {
                if (users.has(userId)) {
                    activeUserCount++;
                    activeUsers.push(userId);
                }
            });
            
            // If less than 2 active users, close the room
            if (activeUserCount < 2) {
                console.log(`Cleaning up DM room ${roomId} with only ${activeUserCount} active users`);
                
                const globalRoom = rooms.get('global');
                
                // Move remaining user(s) to global room and notify them
                activeUsers.forEach(userId => {
                    if (users.has(userId)) {
                        // Add to global room
                        globalRoom.users.add(userId);
                        
                        // Remove from DM room
                        room.users.delete(userId);
                        
                        // Notify user about room closure
                        broadcastToClient(userId, 'room_closed', { 
                            roomId, 
                            reason: activeUserCount === 1 ? 'Other participant left' : 'Room has no participants'
                        });
                        
                        // Also notify them to switch to global
                        broadcastToClient(userId, 'room_deleted', { roomId });
                    }
                });
                
                // Delete the room
                rooms.delete(roomId);
                
                // Broadcast to all that this room was deleted
                broadcastToAll('room_deleted', { roomId });
                
                // Update user lists
                broadcastUsersList('global');
            }
        }
    });
}

// === HTTP endpoints ===
// Color selection endpoint
app.post('/api/chess-color-select', (req, res) => {
    const { clientId, gameId, color } = req.body;
    
    const game = chessGames.get(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    if (game.challengerId !== clientId) {
        return res.status(403).json({ error: 'Only challenger can select color' });
    }
    
    game.challengerColor = color;
    game.opponentColor = color === 'white' ? 'black' : 'white';
    
    // Notify opponent about color selection
    const opponentId = game.challengerId === game.playerWhite ? game.playerBlack : game.playerWhite;
    addEventToUser(opponentId, {
        event: 'color_selected',
        data: { gameId, color }
    });
    
    res.json({ success: true, gameState: game });
});

// Start game endpoint
app.post('/api/start-chess-game', (req, res) => {
    const { clientId, gameId, challengerColor } = req.body;
    
    const game = chessGames.get(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    if (game.challengerId !== clientId) {
        return res.status(403).json({ error: 'Only challenger can start game' });
    }
    
    // Assign colors based on challenger's choice
    if (challengerColor === 'black') {
        // Swap player roles
        [game.playerWhite, game.playerBlack] = [game.playerBlack, game.playerWhite];
        [game.whiteName, game.blackName] = [game.blackName, game.whiteName];
    }
    
    game.status = 'active';
    
    // Notify both players
    addEventToUser(game.playerWhite, {
        event: 'chess_game_started',
        data: { gameId, gameState: game }
    });
    
    addEventToUser(game.playerBlack, {
        event: 'chess_game_started',
        data: { gameId, gameState: game }
    });
    
    res.json({ success: true, gameState: game });
});

// Cancel game endpoint
app.post('/api/cancel-chess-game', (req, res) => {
    const { clientId, gameId } = req.body;
    
    const game = chessGames.get(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    // Notify opponent about cancellation
    const opponentId = game.challengerId === game.playerWhite ? game.playerBlack : game.playerWhite;
    addEventToUser(opponentId, {
        event: 'chess_game_cancelled',
        data: { gameId }
    });
    
    chessGames.delete(gameId);
    res.json({ success: true });
});

app.post('/api/create-chess-game', (req, res) => {
    const { clientId, opponentId, challengerName } = req.body;
    
    if (!clientId || !opponentId) {
        return res.status(400).json({ error: 'Missing clientId or opponentId' });
    }

    const challenger = clients.get(clientId);
    const opponent = clients.get(opponentId);
    
    if (!challenger || !opponent) {
        return res.status(404).json({ error: 'User not found or offline' });
    }

    const gameId = `chess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const gameState = {
        id: gameId,
        playerWhite: clientId, // Initially assign challenger as white
        playerBlack: opponentId,
        whiteName: challengerName || challenger.username,
        blackName: opponent.username,
        challengerId: clientId,
        challengerName: challengerName || challenger.username,
        challengerColor: null,
        opponentColor: null,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // Ensure 'w' for white's turn
        moves: [],
        status: 'waiting',
        result: null,
        createdAt: Date.now(),
        lastMoveTime: Date.now()
    };

    chessGames.set(gameId, gameState);

    // Notify opponent
    addEventToUser(opponentId, {
        event: 'chess_invitation',
        data: {
            gameId,
            challenger: challengerName || challenger.username,
            challengerId: clientId
        }
    });

    res.json({ success: true, gameId, gameState });
});

// Update accept invitation to send game ready event
app.post('/api/accept-chess-invitation', (req, res) => {
    const { clientId, gameId } = req.body;
    
    const game = chessGames.get(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    if (!clients.has(clientId)) {
        return res.status(404).json({ error: 'User not found' });
    }

    if (game.playerBlack !== clientId) {
        return res.status(403).json({ error: 'Not your invitation' });
    }

    game.status = 'ready'; // Changed from 'active' to 'ready'
    
    // Notify challenger that game is ready for setup
    addEventToUser(game.playerWhite, {
        event: 'chess_game_ready',
        data: { gameId, gameState: game }
    });
    
    // Notify challenged player as well
    addEventToUser(game.playerBlack, {
        event: 'chess_game_ready',
        data: { gameId, gameState: game }
    });

    res.json({ success: true, gameState: game });
});

app.post('/api/chess-move', (req, res) => {
  const { clientId, gameId, move } = req.body;
  
  if (!clientId || !gameId || !move) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const game = chessGames.get(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Game not active' });
  }

  // FIX: Check if user exists in users map (not clients map)
  if (!users.has(clientId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const currentTurn = game.fen.split(' ')[1]; // Get the turn from FEN: 'w' or 'b'
  const isWhiteTurn = currentTurn === 'w';

  // Determine which player should be moving based on turn
  const currentPlayer = isWhiteTurn ? game.playerWhite : game.playerBlack;

  if (currentPlayer !== clientId) {
    return res.status(403).json({ error: 'Not your turn' });
  }
  
  console.log('Turn validation:', {
    fen: game.fen,
    currentTurn: currentTurn,
    isWhiteTurn: isWhiteTurn,
    currentPlayer: currentPlayer,
    requestingClient: clientId,
    playerWhite: game.playerWhite,
    playerBlack: game.playerBlack,
    isValid: currentPlayer === clientId,
    hasPromotion: !!move.promotion // Log if promotion is present
  });

  // Validate move structure
  if (!move.from || !move.to || !Array.isArray(move.from) || !Array.isArray(move.to)) {
    return res.status(400).json({ error: 'Invalid move format' });
  }

  // Add move to game history - include promotion if present
  game.moves.push({
    move: {
      from: move.from,
      to: move.to,
      piece: move.piece,
      capture: move.capture,
      promotion: move.promotion || null, // Ensure promotion is included
      flags: move.flags || {}
    },
    player: clientId,
    timestamp: Date.now()
  });

  // Update FEN - switch turn AND handle promotion in FEN
  const fenParts = game.fen.split(' ');
  fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w'; // Switch turn
  
  // If it's a promotion move, we need to update the board representation in FEN
  // This is a simplified approach - you might need more sophisticated FEN updating
  if (move.promotion) {
    console.log('Promotion move detected:', move.promotion);
    // Note: In a full implementation, you'd update the FEN board string here
    // to reflect the promoted piece
  }
  
  game.fen = fenParts.join(' ');
  
  game.lastMoveTime = Date.now();

  // Determine opponent
  const opponentId = clientId === game.playerWhite ? game.playerBlack : game.playerWhite;

  // Notify opponent - make sure to include the promotion in the move data
  addEventToUser(opponentId, {
    event: 'chess_move_made',
    data: {
      gameId,
      move: {
        from: move.from,
        to: move.to,
        piece: move.piece,
        capture: move.capture,
        promotion: move.promotion || null, // Include promotion
        flags: move.flags || {}
      },
      newFen: game.fen,
      gameState: game
    }
  });

  res.json({ success: true, gameState: game });
});
// Add move validation endpoint
app.post('/api/validate-move', (req, res) => {
    const { clientId, gameId, move } = req.body;
    
    const game = chessGames.get(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    // Basic move validation
    if (!move.from || !move.to || !Array.isArray(move.from) || !Array.isArray(move.to)) {
        return res.status(400).json({ error: 'Invalid move format' });
    }
    
    // Turn validation
    const currentTurn = game.fen.split(' ')[1];
    const isWhiteTurn = currentTurn === 'w';
    const currentPlayer = isWhiteTurn ? game.playerWhite : game.playerBlack;
    
    if (currentPlayer !== clientId) {
        return res.json({ valid: false, error: 'Not your turn' });
    }
    
    res.json({ valid: true });
});

// Add game state checksum for synchronization
app.get('/api/game-state-checksum/:gameId', (req, res) => {
    const game = chessGames.get(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    
    // Simple checksum based on FEN and move count
    const checksum = {
        fen: game.fen,
        moveCount: game.moves.length,
        lastMoveTime: game.lastMoveTime
    };
    
    res.json({ checksum });
});
app.get('/api/refresh-chess-game/:gameId/:clientId', (req, res) => {
    const { gameId, clientId } = req.params;
    const game = chessGames.get(gameId);
    
    if (!game) {
        return res.status(404).json({ error: 'Game not found' });
    }
    
    // Verify user is in this game
    if (game.playerWhite !== clientId && game.playerBlack !== clientId) {
        return res.status(403).json({ error: 'Not in this game' });
    }
    
    res.json({ success: true, gameState: game });
});
// Get game state
app.get('/api/chess-game/:gameId', (req, res) => {
    const game = chessGames.get(req.params.gameId);
    if (!game) {
        return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ success: true, gameState: game });
});

// Get user's active chess games
app.get('/api/user-chess-games/:clientId', (req, res) => {
    const clientId = req.params.clientId;
    const userGames = [];
    
    for (const [gameId, game] of chessGames) {
        if (game.playerWhite === clientId || game.playerBlack === clientId) {
            userGames.push(game);
        }
    }
    
    res.json({ success: true, games: userGames });
});


app.post('/api/join', (req, res) => {
  if (!isServerActive) {
    return res.status(403).json({ error: 'Server not active. Requires moderator activation.' });
  }

  const { username, isChessClient } = req.body; // ← ADD isChessClient to destructuring
  if (!username) return res.status(400).json({ error: 'Username required' });

  // Check if server is locked
  if (isServerLocked) {
    const clientId = `pending_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Add to pending users instead of active users
    pendingUsers.set(clientId, { 
      username, 
      clientId, 
      requestedAt: Date.now(),
      isChessClient: !!isChessClient // ← Store chess client status for pending users too
    });
    
    console.log(`User pending approval: ${username} (clientId: ${clientId}, chessClient: ${isChessClient})`);
    
    // Notify moderators about the pending user
    users.forEach((user, userId) => {
      if (user.isMod && !user.isHidden) {
        broadcastToClient(userId, 'user_pending', { username, clientId, isChessClient });
      }
    });
    
    return res.json({ 
      success: false, 
      isPending: true, 
      clientId,
      message: 'Server is locked. Waiting for moderator approval.' 
    });
  }

  // === Original join logic (when unlocked) ===
  const clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  users.set(clientId, { username, isMod: false, joinedAt: Date.now(), clientId, lastCheck: Date.now() });
  longPollingClients.set(clientId, { res: null, lastCheck: Date.now() });

  if (isChessClient) { // ← Now this variable is properly defined
      clients.set(clientId, { 
          username, 
          clientId, 
          isChessClient: true,
          joinedAt: Date.now() 
      });
  }

  const globalRoom = rooms.get('global');
  globalRoom.users.add(clientId);

  console.log(`User joined: ${username} (clientId: ${clientId}, chessClient: ${isChessClient})`);
  broadcastToRoom('global', 'user_joined', username);
  broadcastUsersList('global');

  res.json({
    success: true,
    clientId,
    messages: globalRoom.messages.slice(-20),
    users: Array.from(users.values()).filter(u => globalRoom.users.has(u.clientId)).map(u => ({
      username: u.username,
      isMod: u.isMod,
      isHidden: u.isHidden || false,
      joinedAt: u.joinedAt,
      clientId: u.clientId
    })),
    currentRoom: 'global'
  });
});

app.post('/api/send-message', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, message, roomId } = req.body; // Added roomId
  if (!clientId || !message || !roomId) return res.status(400).json({ error: 'Missing fields' });
  
  const user = users.get(clientId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  // Check if user is in this room
  const room = rooms.get(roomId);
  if (!room || !room.users.has(clientId)) {
    return res.status(403).json({ error: 'Not in this room' });
  }

  console.log(`Encrypted message from ${user.username} in room ${roomId}: ${message}`);

  const msgData = { 
    id: Date.now(), 
    username: user.username, 
    message,
    timestamp: Date.now(),
    clientId: clientId,
    roomId: roomId
  };
  
  // Store message in room
  room.messages.push(msgData);
  if (room.messages.length > 100) room.messages.shift();
  
  broadcastToRoom(roomId, 'receive_message', msgData);
  res.json({ success: true });
});

app.post('/api/get-updates', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId } = req.body;
  
  // Allow pending users to poll for updates
  const isPendingUser = clientId && clientId.startsWith('pending_') && pendingUsers.has(clientId);
  const isActiveUser = clientId && users.has(clientId);
  
  if (!isPendingUser && !isActiveUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Store the pending user's response object so we can send events to them
  longPollingClients.set(clientId, { res, lastCheck: Date.now() });
  
  // Set timeout for pending users too (shorter timeout)
  const timeout = isPendingUser ? 15000 : 25000; // 15s for pending, 25s for active
  
  setTimeout(() => {
    const client = longPollingClients.get(clientId);
    if (client && client.res === res) {
      res.json({ events: [], timestamp: Date.now() });
      longPollingClients.delete(clientId);
    }
  }, timeout);
});

app.post('/api/leave', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId } = req.body;
  if (clientId && users.has(clientId)) {
    const user = users.get(clientId);
    
    // Remove user from all rooms
    rooms.forEach(room => {
      if (room.users.has(clientId)) {
        room.users.delete(clientId);
        broadcastToRoom(room.id, 'user_left', user.username);
      }
    });
    
    users.delete(clientId);
    longPollingClients.delete(clientId);
    console.log(`User left via leave API: ${user.username} (clientId: ${clientId})`);
    
    // NEW: Clean up empty DM rooms
    cleanupEmptyDMRooms();
    
    broadcastUsersList('global');
  }
  res.json({ success: true });
});

app.post('/api/activate-server', (req, res) => {
  const { password, clientId: providedClientId } = req.body;
  if (password === SERVER_ACTIVATION_PASSWORD) {
    if (!isServerActive) {
      let clientId = providedClientId;
      if (!clientId || !users.has(clientId)) {
        clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        users.set(clientId, {
          username: "Developer", 
          isMod: true,
          joinedAt: Date.now(),
          clientId,
          lastCheck: Date.now(),
          isHidden: true 
        });
      } else {
        const user = users.get(clientId);
        user.isMod = true;
        user.isHidden = true; // Set hidden when becoming mod
      }
      activateServer(clientId);
      return res.json({ success: true, clientId, isMod: true });
    }
    return res.json({ success: true, message: 'Server already active' });
  }
  res.json({ success: false, error: 'Invalid activation password' });
});

app.post('/api/toggle-visibility', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, isHidden } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing parameters' });
  
  const user = users.get(clientId);
  if (!user || !user.isMod) return res.status(403).json({ error: 'Not a developer' });

  user.isHidden = isHidden;
  
  // Broadcast updated user list to all rooms the user is in
  rooms.forEach(room => {
    if (room.users.has(clientId)) {
      broadcastUsersList(room.id);
    }
  });
  
  res.json({ success: true, isHidden });
});

app.post('/api/toggle-lock', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, lockState } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing parameters' });
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  isServerLocked = lockState;
  
  // Notify all users about the lock state change
  broadcastToAll('server_lock_changed', { isLocked: isServerLocked });
  
  console.log(`Server ${isServerLocked ? 'locked' : 'unlocked'} by ${moderator.username}`);
  res.json({ success: true, isLocked: isServerLocked });
});

app.get('/api/pending-users', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  const pendingList = Array.from(pendingUsers.values()).map(user => ({
    username: user.username,
    clientId: user.clientId,
    requestedAt: user.requestedAt
  }));
  
  res.json({ pendingUsers: pendingList });
});

app.post('/api/handle-user-request', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, targetClientId, approve } = req.body;
  if (!clientId || !targetClientId || typeof approve === 'undefined') {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  const pendingUser = pendingUsers.get(targetClientId);
  if (!pendingUser) return res.status(404).json({ error: 'Pending user not found' });

  if (approve) {
    // Generate a new clientId for the approved user (convert from pending_ to regular)
    const newClientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Add user to global room
    const globalRoom = rooms.get('global');
    globalRoom.users.add(newClientId);
    
    // Update user tracking with new clientId
    users.set(newClientId, { 
      username: pendingUser.username,
      joinedAt: Date.now(), 
      lastCheck: Date.now(),
      isMod: false,
      clientId: newClientId
    });

    // Add to chess clients if this was a chess client
    if (pendingUser.isChessClient) {
      clients.set(newClientId, { 
        username: pendingUser.username, 
        clientId: newClientId, 
        isChessClient: true,
        joinedAt: Date.now() 
      });
    }
    
    console.log(`User approved: ${pendingUser.username} (new clientId: ${newClientId}) by ${moderator.username}`);
    broadcastToRoom('global', 'user_joined', pendingUser.username);
    broadcastUsersList('global');
    
    // Send approval to the pending user using their OLD clientId
    broadcastToClient(targetClientId, 'join_approved', { 
      clientId: newClientId, // Send the NEW clientId
      username: pendingUser.username,
      success: true
    });
  } else {
    // Notify the rejected user using their pending clientId
    broadcastToClient(targetClientId, 'join_rejected', { 
      reason: 'Join request rejected by moderator'
    });
    console.log(`User rejected: ${pendingUser.username} by ${moderator.username}`);
  }
  
  // Remove from pending regardless of approval status
  pendingUsers.delete(targetClientId);
  
  res.json({ success: true });
});

app.post('/api/become-mod', (req, res) => {
  const { clientId, password } = req.body;
  if (password === SERVER_ACTIVATION_PASSWORD) {
    const user = users.get(clientId);
    if (user) {
      user.isMod = true;
      if (!isServerActive) activateServer(clientId);
      broadcastToAll('mod_joined', user.username);
      broadcastToClient(clientId, 'mod_status', { isMod: true });
      broadcastUsersList();
      return res.json({ success: true });
    }
  }
  res.json({ success: false });
});

app.get('/api/status', (req, res) => {
  res.json({ active: isServerActive, users: users.size, requiresMod: !activeModerator && isServerActive });
});

app.get('/api/active-users', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });
  const roomId = req.query.roomId || 'global';
  const room = rooms.get(roomId);
  
  if (!room) return res.status(404).json({ error: 'Room not found' });
  
  const activeUsers = Array.from(room.users)
    .filter(clientId => users.has(clientId))
    .map(clientId => {
      const u = users.get(clientId);
      return {
        username: u.username,
        isMod: u.isMod,
        isHidden: u.isHidden || false,
        joinedAt: u.joinedAt,
        clientId: u.clientId
      };
    });
    
  res.json({ users: activeUsers });
});

app.post('/api/kick-user', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, targetUsername } = req.body;
  if (!clientId || !targetUsername) return res.status(400).json({ error: 'Missing parameters' });
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  let userToKick = null, userClientId = null;
  for (const [id, user] of users.entries()) {
    if (user.username === targetUsername) { userToKick = user; userClientId = id; break; }
  }
  if (userToKick && userClientId) {
    broadcastToClient(userClientId, 'kicked', {});
    users.delete(userClientId);
    longPollingClients.delete(userClientId);
    console.log(`User kicked: ${targetUsername} by ${moderator.username}`);
    
    // NEW: Clean up empty DM rooms
    cleanupEmptyDMRooms();
    
    broadcastToAll('user_left', userToKick.username);
    broadcastUsersList();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'User not found' });
});

app.post('/api/delete-message', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, messageId, roomId } = req.body; // Added roomId
  if (!clientId || !messageId || !roomId) return res.status(400).json({ error: 'Missing parameters' });
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  // Find the room and message
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const messageIndex = room.messages.findIndex(m => m.id === messageId);
  if (messageIndex !== -1) {
    room.messages.splice(messageIndex, 1);
    broadcastToRoom(roomId, 'message_deleted', messageId);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Message not found' });
});

app.post('/api/clear-messages', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, roomId } = req.body;
  console.log('Clear messages request:', { clientId, roomId });
  
  if (!clientId || !roomId) {
    console.log('Missing parameters:', { clientId, roomId });
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) {
    console.log('Not a moderator:', { clientId, userExists: !!moderator, isMod: moderator?.isMod });
    return res.status(403).json({ error: 'Not a moderator' });
  }

  const room = rooms.get(roomId);
  if (room) {
    console.log('Clearing messages in room:', roomId);
    room.messages.length = 0;
    broadcastToRoom(roomId, 'messages_cleared', {});
    return res.json({ success: true });
  }
  
  console.log('Room not found:', roomId);
  res.status(404).json({ error: 'Room not found' });
});

app.post('/api/kick-all-users', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing parameters' });
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  // Kick all users except the moderator
  users.forEach((user, userId) => {
    if (userId !== clientId) {
      broadcastToClient(userId, 'kicked', {});
      users.delete(userId);
      longPollingClients.delete(userId);
    }
  });

  broadcastUsersList();
  res.json({ success: true });
});

app.post('/api/server-message', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, message, roomId = 'global' } = req.body; // Add roomId parameter with default
  
  // Add debug logging
  console.log('Server message request received:', { clientId, message, roomId });
  
  if (!clientId || !message) {
    console.log('Missing parameters:', { clientId, message });
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) {
    console.log('Not a moderator:', { clientId, userExists: !!moderator, isMod: moderator?.isMod });
    return res.status(403).json({ error: 'Not a moderator' });
  }

  // Send message as server to the specified room (default to global)
  const serverMsgData = {
    id: Date.now(),
    username: "SERVER", // This is not encrypted
    message: message,
    timestamp: Date.now(),
    isServerMessage: true,
    roomId: roomId // Include room ID
  };
  
  // Store message in the appropriate room
  const room = rooms.get(roomId);
  if (room) {
    room.messages.push(serverMsgData);
    if (room.messages.length > 100) room.messages.shift();
  } else {
    // Fallback to global if room doesn't exist
    const globalRoom = rooms.get('global');
    globalRoom.messages.push(serverMsgData);
    if (globalRoom.messages.length > 100) globalRoom.messages.shift();
  }
  
  // Broadcast to the specific room
  broadcastToRoom(roomId, 'receive_message', serverMsgData);
  res.json({ success: true });
});

app.get('/api/check-lock', (req, res) => {
  res.json({ isLocked: isServerLocked });
});

app.post('/api/create-dm-room', (req, res) => {
    if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

    const { clientId, targetClientId } = req.body;
    if (!clientId || !targetClientId) return res.status(400).json({ error: 'Missing parameters' });
    
    const user1 = users.get(clientId);
    const user2 = users.get(targetClientId);
    if (!user1 || !user2) return res.status(404).json({ error: 'User not found' });

    // Check if DM room already exists
    const roomId = `dm_${[clientId, targetClientId].sort().join('_')}`;
    
    if (!rooms.has(roomId)) {
        // Create room name with both usernames for moderators, but store both for flexibility
        const roomName = `DM: ${user1.username} & ${user2.username}`;
        
        rooms.set(roomId, {
            id: roomId,
            name: roomName,
            users: new Set([clientId, targetClientId]),
            isDM: true,
            messages: [],
            participantUsernames: [user1.username, user2.username] // Store both for reference
        });
        
        // Add moderator to room if one exists and it's not a moderator-initiated DM
        if (activeModerator && activeModerator !== clientId && activeModerator !== targetClientId) {
            rooms.get(roomId).users.add(activeModerator);
        }
        
        console.log(`Created DM room: ${roomId}`);
        
        // Notify all participants about the new room
        broadcastToClient(clientId, 'room_created', { roomId, roomName });
        broadcastToClient(targetClientId, 'room_created', { roomId, roomName });
        
        // Also notify moderator if they were added
        if (activeModerator && rooms.get(roomId).users.has(activeModerator)) {
            broadcastToClient(activeModerator, 'room_created', { roomId, roomName });
        }
    }
    
    // Return room info
    const room = rooms.get(roomId);
    res.json({ 
        success: true, 
        room: {
            id: room.id,
            name: room.name,
            isDM: room.isDM,
            participantUsernames: room.participantUsernames
        }
    });
});

app.get('/api/room-display-name', async (req, res) => {
    if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

    const { roomId, clientId } = req.query;
    if (!roomId || !clientId) return res.status(400).json({ error: 'Missing parameters' });
    
    const room = rooms.get(roomId);
    const user = users.get(clientId);
    
    if (!room || !user) return res.status(404).json({ error: 'Room or user not found' });
    
    if (room.isDM && room.participantUsernames) {
        // For moderators, return the usernames as-is (encrypted)
        // For participants, decrypt their own username but leave others encrypted
        let displayNames = [];
        
        for (const encryptedUsername of room.participantUsernames) {
            // If this is the current user's encrypted username, decrypt it
            if (encryptedUsername.startsWith('ENCRYPTED:') && 
                encryptedUsername === user.username) {
                // This is the current user's own encrypted username
                // We can't decrypt it here (server doesn't have the key)
                // So we'll return it as-is and let the client handle decryption
                displayNames.push(encryptedUsername);
            } else {
                // For other users or if user is moderator, keep encrypted
                displayNames.push(encryptedUsername);
            }
        }
        
        // Filter out the current user's name for display
        const filteredNames = displayNames.filter(name => name !== user.username);
        
        res.json({ 
            displayName: filteredNames.join(' & '),
            needsDecryption: filteredNames.some(name => name.startsWith('ENCRYPTED:'))
        });
    } else {
        res.json({ displayName: room.name, needsDecryption: false });
    }
});

app.post('/api/join-room', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, roomId } = req.body;
  if (!clientId || !roomId) return res.status(400).json({ error: 'Missing parameters' });
  
  const user = users.get(clientId);
  const room = rooms.get(roomId);
  if (!user || !room) return res.status(404).json({ error: 'User or room not found' });
  
  // Add user to room
  room.users.add(clientId);
  
  res.json({ 
    success: true, 
    messages: room.messages.slice(-20),
    users: Array.from(room.users)
      .filter(clientId => users.has(clientId))
      .map(clientId => {
        const u = users.get(clientId);
        return {
          username: u.username,
          isMod: u.isMod,
          isHidden: u.isHidden || false, // Add this line
          joinedAt: u.joinedAt,
          clientId: u.clientId
        };
      })
  });
});

app.get('/api/user-rooms', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId } = req.query;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
  
  const userRooms = [];
  rooms.forEach(room => {
    if (room.users.has(clientId)) {
      userRooms.push({
        id: room.id,
        name: room.name,
        isDM: room.isDM
      });
    }
  });
  
  res.json({ rooms: userRooms });
});

app.post('/api/delete-room', (req, res) => {
    if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

    const { clientId, roomId } = req.body;
    if (!clientId || !roomId) return res.status(400).json({ error: 'Missing parameters' });
    
    const moderator = users.get(clientId);
    if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Don't allow deletion of the global room
    if (roomId === 'global') return res.status(400).json({ error: 'Cannot delete global room' });

    // Move all users to global room
    const globalRoom = rooms.get('global');
    room.users.forEach(userId => {
        if (users.has(userId)) {
            room.users.delete(userId);
            globalRoom.users.add(userId);
            // Notify user they've been moved
            broadcastToClient(userId, 'room_deleted', { roomId });
        }
    });

    // Remove the room
    rooms.delete(roomId);
    console.log(`Room deleted by moderator ${moderator.username}: ${roomId}`);

    // Notify all clients to update their room lists
    broadcastToAll('room_deleted', { roomId });

    res.json({ success: true });
});

// === Broadcast helpers ===
function broadcastToRoom(roomId, event, data) {
  const room = rooms.get(roomId);
  if (!room) return;

  const ev = { event, data, timestamp: Date.now() };
  room.users.forEach(clientId => {
    const client = longPollingClients.get(clientId);
    if (client && client.res && !client.res.finished) {
      client.res.json({ events: [ev], timestamp: Date.now() });
      longPollingClients.delete(clientId);
    }
  });
}
function broadcastToAll(event, data) {
  const ev = { event, data, timestamp: Date.now() };
  longPollingClients.forEach((client, id) => {
    if (client.res && !client.res.finished) {
      client.res.json({ events: [ev], timestamp: Date.now() });
      longPollingClients.delete(id);
    }
  });
}

function addEventToUser(clientId, eventData) {
  const client = longPollingClients.get(clientId);
  if (client && client.res && !client.res.finished) {
    client.res.json({ events: [eventData], timestamp: Date.now() });
    longPollingClients.delete(clientId);
  }
}
function broadcastToClient(clientId, event, data) {
  const client = longPollingClients.get(clientId);
  if (client && client.res && !client.res.finished) {
    client.res.json({ events: [{ event, data, timestamp: Date.now() }], timestamp: Date.now() });
    longPollingClients.delete(clientId);
  }
}
function broadcastUsersList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const list = Array.from(room.users)
    .filter(clientId => users.has(clientId))
    .map(clientId => {
      const u = users.get(clientId);
      // Don't include hidden developers in the user list
      if (u.isMod && u.isHidden) {
        return null; // Skip hidden mods
      }
      return {
        username: u.username, 
        isMod: u.isMod,
        isHidden: u.isHidden, // Add this line
        joinedAt: u.joinedAt,
        clientId: u.clientId
      };
    })
    .filter(user => user !== null); // Remove null entries
    
  console.log(`Broadcasting users list for room ${roomId}: ${JSON.stringify(list)}`);
  broadcastToRoom(roomId, 'users_list', list);
}

// === Cleanup ===
setInterval(() => {
  const now = Date.now();
  
  // Clean up pending users first (shorter timeout)
  pendingUsers.forEach((user, clientId) => {
    if (now - user.requestedAt > 300000) { // 5 minutes for pending users
      pendingUsers.delete(clientId);
      console.log(`Pending user timed out: ${user.username}`);
    }
  });
  
  // Clean up long polling clients and inactive users
  longPollingClients.forEach((client, clientId) => {
    if (now - (client.lastCheck || 0) > CLIENT_TIMEOUT) {
      if (client.res && !client.res.finished) {
        try { client.res.json({ events: [], timestamp: now }); } catch {}
      }
      longPollingClients.delete(clientId);

      const user = users.get(clientId);
      if (user) {
        // Don't auto-delete moderator accounts here
        if (user.isMod) {
          console.log(`Skipping cleanup for moderator: ${user.username} (clientId: ${clientId})`);
          return;
        }
        users.delete(clientId);
        console.log(`User cleaned up due to inactivity: ${user.username} (clientId: ${clientId})`);
        
        // NEW: Clean up empty DM rooms
        cleanupEmptyDMRooms();
        
        broadcastToAll('user_left', user.username);
        broadcastUsersList();
      }
    }
  });
}, 10000);

// === Add cleanup for pending users ===
setInterval(() => {
  const now = Date.now();
  const PENDING_TIMEOUT = 300000; // 5 minutes
  
  pendingUsers.forEach((user, clientId) => {
    if (now - user.requestedAt > PENDING_TIMEOUT) {
      pendingUsers.delete(clientId);
      console.log(`Pending user timed out: ${user.username}`);
    }
  });
}, 60000); // Check every minute

setInterval(() => {
  console.log(`Server status: active=${isServerActive}, users=${users.size}, messages=${messages.length}`);
}, 30000);

http.createServer(app).listen(PORT, () => console.log(`Server running on ${PORT} (long polling only)`));


