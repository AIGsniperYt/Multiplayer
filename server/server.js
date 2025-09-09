const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configure CORS properly
const io = socketIo(server, {
  cors: {
    origin: ["https://aigsniperyt.github.io", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'] // Prioritize polling first for school networks
});

// Enhanced CORS configuration
app.use(cors({
  origin: ["https://aigsniperyt.github.io", "http://localhost:3000"],
  credentials: true
}));

app.use(express.json()); // For parsing application/json

// Serve static files from the root directory (for testing)
app.use(express.static(path.join(__dirname, '..')));

// Store connected users and moderators
const users = new Map(); // socket.id -> {username, isMod}
const messages = []; // Store recent messages for moderation
const longPollingClients = new Map(); // Store long polling clients
const SECRET_MOD_PASSWORD = "esports2024";

// Long polling endpoints
app.post('/api/join', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  // Simulate socket ID for long polling clients
  const clientId = `longpoll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  users.set(clientId, { username, isMod: false, isLongPolling: true });
  
  // Add to long polling clients
  longPollingClients.set(clientId, { res, lastCheck: Date.now() });
  
  // Broadcast user joined
  broadcastToAll('user_joined', username);
  broadcastUsersList();
  
  console.log(`${username} joined via long polling`);
  
  // Send initial data
  res.json({
    success: true,
    clientId,
    messages: messages.slice(-20), // Last 20 messages
    users: Array.from(users.values()).map(user => ({
      username: user.username,
      isMod: user.isMod
    }))
  });
});

app.post('/api/send-message', (req, res) => {
  const { clientId, message } = req.body;
  
  if (!clientId || !message) {
    return res.status(400).json({ error: 'Client ID and message are required' });
  }
  
  const user = users.get(clientId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const messageData = {
    id: Date.now() + Math.random(),
    username: user.username,
    message: message,
    timestamp: new Date().toLocaleTimeString(),
    clientId: clientId
  };
  
  messages.push(messageData);
  if (messages.length > 100) messages.shift();
  
  // Broadcast to all clients
  broadcastToAll('receive_message', messageData);
  
  res.json({ success: true });
  console.log(`${user.username} (long polling): ${message}`);
});

app.post('/api/get-updates', (req, res) => {
  const { clientId, lastUpdate } = req.body;
  
  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required' });
  }
  
  if (!users.has(clientId)) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Store the response for long polling
  longPollingClients.set(clientId, { res, lastCheck: Date.now() });
  
  // Set timeout for long polling (25 seconds max)
  setTimeout(() => {
    const client = longPollingClients.get(clientId);
    if (client && client.res === res) {
      res.json({ events: [], timestamp: Date.now() });
      longPollingClients.delete(clientId);
    }
  }, 25000);
});

app.post('/api/become-mod', (req, res) => {
  const { clientId, password } = req.body;
  
  if (password === SECRET_MOD_PASSWORD) {
    const user = users.get(clientId);
    if (user) {
      user.isMod = true;
      broadcastToClient(clientId, 'mod_status', { isMod: true });
      broadcastUsersList();
      console.log(`${user.username} became a moderator (long polling)`);
      return res.json({ success: true });
    }
  }
  
  res.json({ success: false });
});

// Helper functions for broadcasting
function broadcastToAll(event, data) {
  // Broadcast to WebSocket clients
  io.emit(event, data);
  
  // Broadcast to long polling clients
  const eventData = { event, data, timestamp: Date.now() };
  
  longPollingClients.forEach((client, clientId) => {
    if (client.res && !client.res.finished) {
      client.res.json({ events: [eventData], timestamp: Date.now() });
      longPollingClients.delete(clientId);
    }
  });
}

function broadcastToClient(clientId, event, data) {
  const client = longPollingClients.get(clientId);
  if (client && client.res && !client.res.finished) {
    client.res.json({ 
      events: [{ event, data, timestamp: Date.now() }], 
      timestamp: Date.now() 
    });
    longPollingClients.delete(clientId);
  }
}

function broadcastUsersList() {
  const usersList = Array.from(users.values()).map(user => ({
    username: user.username,
    isMod: user.isMod
  }));
  
  io.emit('users_list', usersList);
  
  longPollingClients.forEach((client, clientId) => {
    if (client.res && !client.res.finished) {
      client.res.json({ 
        events: [{ event: 'users_list', data: usersList, timestamp: Date.now() }], 
        timestamp: Date.now() 
      });
      longPollingClients.delete(clientId);
    }
  });
}

// Clean up disconnected long polling clients every minute
setInterval(() => {
  const now = Date.now();
  longPollingClients.forEach((client, clientId) => {
    if (now - client.lastCheck > 30000) { // 30 seconds timeout
      if (client.res && !client.res.finished) {
        client.res.json({ events: [], timestamp: now });
      }
      longPollingClients.delete(clientId);
      
      // Remove user if they've been inactive
      const user = users.get(clientId);
      if (user) {
        users.delete(clientId);
        broadcastToAll('user_left', user.username);
        broadcastUsersList();
        console.log(`${user.username} disconnected (timeout)`);
      }
    }
  });
}, 60000);

// WebSocket events (for clients that can use WebSockets)
io.on('connection', (socket) => {
  console.log('User connected via WebSocket:', socket.id);
  
  socket.on('user_joined', (username) => {
    users.set(socket.id, { username, isMod: false });
    socket.broadcast.emit('user_joined', username);
    io.emit('users_list', Array.from(users.values()).map(user => ({
      username: user.username,
      isMod: user.isMod
    })));
    console.log(`${username} joined the chat (WebSocket)`);
  });
  
  socket.on('send_message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      const messageData = {
        id: Date.now() + Math.random(),
        username: user.username,
        message: data.message,
        timestamp: new Date().toLocaleTimeString(),
        socketId: socket.id
      };
      
      messages.push(messageData);
      if (messages.length > 100) messages.shift();
      
      io.emit('receive_message', messageData);
      console.log(`${user.username}: ${data.message}`);
    }
  });
  
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_left', user.username);
      users.delete(socket.id);
      io.emit('users_list', Array.from(users.values()).map(user => ({
        username: user.username,
        isMod: user.isMod
      })));
      console.log(`${user.username} left the chat (WebSocket)`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS enabled for GitHub Pages and localhost`);
  console.log(`Long polling API available at /api/ endpoints`);
});
