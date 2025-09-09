// server.js
const express = require('express');
const http = require('http'); // Use HTTP server — Render/Glitch terminates TLS for you
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow GitHub Pages frontend
app.use(cors({
  origin: ["https://aigsniperyt.github.io"],
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// === Long polling storage ===
const longPollingClients = new Map();
const users = new Map();
const messages = [];
const SECRET_MOD_PASSWORD = "esports2024";

// === HTTP endpoints for long polling ===
app.post('/api/join', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  users.set(clientId, { username, isMod: false, isLongPolling: true });
  longPollingClients.set(clientId, { res, lastCheck: Date.now() });

  broadcastToAll('user_joined', username);
  broadcastUsersList();

  res.json({
    success: true,
    clientId,
    messages: messages.slice(-20),
    users: Array.from(users.values()).map(u => ({ username: u.username, isMod: u.isMod }))
  });
});

app.post('/api/send-message', (req, res) => {
  const { clientId, message } = req.body;
  if (!clientId || !message) return res.status(400).json({ error: 'ClientId & message required' });

  const user = users.get(clientId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const msgData = { id: Date.now(), username: user.username, message, timestamp: new Date().toLocaleTimeString() };
  messages.push(msgData);
  if (messages.length > 100) messages.shift();

  broadcastToAll('receive_message', msgData);
  res.json({ success: true });
});

app.post('/api/get-updates', (req, res) => {
  const { clientId } = req.body;
  if (!clientId || !users.has(clientId)) return res.status(404).json({ error: 'User not found' });

  // store response for long polling
  longPollingClients.set(clientId, { res, lastCheck: Date.now() });

  // timeout fallback
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
      return res.json({ success: true });
    }
  }
  res.json({ success: false });
});

// === WebSocket server ===
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://aigsniperyt.github.io"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'] // first try websocket, fallback to polling
});

io.on('connection', (socket) => {
  console.log('User connected via WSS:', socket.id);

  socket.on('user_joined', (username) => {
    users.set(socket.id, { username, isMod: false, isLongPolling: false });
    socket.broadcast.emit('user_joined', username);
    broadcastUsersList();
  });

  socket.on('send_message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const msgData = { id: Date.now(), username: user.username, message: data.message, timestamp: new Date().toLocaleTimeString() };
    messages.push(msgData);
    if (messages.length > 100) messages.shift();
    io.emit('receive_message', msgData);
  });

  socket.on('become_mod', (password) => {
    const user = users.get(socket.id);
    if (password === SECRET_MOD_PASSWORD && user) {
      user.isMod = true;
      socket.emit('mod_status', { isMod: true });
      broadcastUsersList();
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_left', user.username);
      users.delete(socket.id);
      broadcastUsersList();
    }
  });
});

// === Helper functions ===
function broadcastToAll(event, data) {
  io.emit(event, data);
  const ev = { event, data, timestamp: Date.now() };
  longPollingClients.forEach((client, id) => {
    if (client.res && !client.res.finished) {
      client.res.json({ events: [ev], timestamp: Date.now() });
      longPollingClients.delete(id);
    }
  });
}

function broadcastToClient(clientId, event, data) {
  const client = longPollingClients.get(clientId);
  if (client && client.res && !client.res.finished) {
    client.res.json({ events: [{ event, data, timestamp: Date.now() }], timestamp: Date.now() });
    longPollingClients.delete(clientId);
  }
}

function broadcastUsersList() {
  const list = Array.from(users.values()).map(u => ({ username: u.username, isMod: u.isMod }));
  io.emit('users_list', list);
  longPollingClients.forEach((client, id) => {
    if (client.res && !client.res.finished) {
      client.res.json({ events: [{ event: 'users_list', data: list, timestamp: Date.now() }], timestamp: Date.now() });
      longPollingClients.delete(id);
    }
  });
}

// Clean up long polling clients every minute
setInterval(() => {
  const now = Date.now();
  longPollingClients.forEach((client, clientId) => {
    if (now - client.lastCheck > 30000) {
      if (client.res && !client.res.finished) client.res.json({ events: [], timestamp: now });
      longPollingClients.delete(clientId);
      const user = users.get(clientId);
      if (user) {
        users.delete(clientId);
        broadcastToAll('user_left', user.username);
        broadcastUsersList();
      }
    }
  });
}, 60000);

server.listen(PORT, () => console.log(`Server running on port ${PORT} (WSS enabled)`));
