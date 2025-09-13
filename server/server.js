const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ["https://aigsniperyt.github.io"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true
}));
app.options('*', cors()); // handle preflight
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// === Storage ===
const longPollingClients = new Map();
const users = new Map();
const messages = [];
const SECRET_MOD_PASSWORD = "esports2024";

// === Endpoints ===
app.post('/api/join', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  users.set(clientId, { username, isMod: false, joinedAt: Date.now(), lastCheck: Date.now() });
  longPollingClients.set(clientId, { res: null, lastCheck: Date.now() });

  console.log(`User joined: ${username} (clientId: ${clientId})`);
  broadcastToAll('user_joined', username);
  broadcastUsersList();

  res.json({
    success: true,
    clientId,
    messages: messages.slice(-20),
    users: Array.from(users.values()).map(u => ({
      username: u.username,
      isMod: u.isMod,
      joinedAt: u.joinedAt
    }))
  });
});

app.post('/api/send-message', (req, res) => {
  const { clientId, message } = req.body;
  if (!clientId || !message) return res.status(400).json({ error: 'Missing fields' });
  const user = users.get(clientId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  console.log(`Encrypted message from ${user.username}: ${message}`);

  const msgData = {
    id: Date.now(),
    username: user.username,
    message,
    timestamp: new Date().toLocaleTimeString(),
    clientId
  };

  messages.push(msgData);
  if (messages.length > 100) messages.shift();

  broadcastToAll('receive_message', msgData);
  res.json({ success: true });
});

app.post('/api/get-updates', (req, res) => {
  const { clientId } = req.body;
  if (!clientId || !users.has(clientId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userData = users.get(clientId);
  if (userData) {
    userData.lastCheck = Date.now();
  }

  longPollingClients.set(clientId, { res, lastCheck: Date.now() });
  setTimeout(() => {
    const client = longPollingClients.get(clientId);
    if (client && client.res === res) {
      res.json({ events: [], timestamp: Date.now() });
      longPollingClients.delete(clientId);
    }
  }, 25000);
});

app.post('/api/leave', (req, res) => {
  const { clientId } = req.body;
  if (clientId && users.has(clientId)) {
    const user = users.get(clientId);
    users.delete(clientId);
    longPollingClients.delete(clientId);

    console.log(`User left via leave API: ${user.username} (clientId: ${clientId})`);
    broadcastToAll('user_left', user.username);
    broadcastUsersList();
  }
  res.json({ success: true });
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

app.get('/api/active-users', (req, res) => {
  const activeUsers = Array.from(users.values()).map(u => ({
    username: u.username,
    isMod: u.isMod,
    joinedAt: u.joinedAt
  }));
  res.json({ users: activeUsers });
});

app.post('/api/kick-user', (req, res) => {
  const { clientId, targetUsername } = req.body;
  if (!clientId || !targetUsername) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) {
    return res.status(403).json({ error: 'Not a moderator' });
  }

  let userToKick = null;
  let userClientId = null;
  for (const [id, user] of users.entries()) {
    if (user.username === targetUsername) {
      userToKick = user;
      userClientId = id;
      break;
    }
  }

  if (userToKick && userClientId) {
    broadcastToClient(userClientId, 'kicked', {});
    users.delete(userClientId);
    longPollingClients.delete(userClientId);

    console.log(`User kicked: ${targetUsername} by ${moderator.username}`);
    broadcastToAll('user_left', userToKick.username);
    broadcastUsersList();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'User not found' });
});

// === Broadcast helpers ===
function broadcastToAll(event, data) {
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
  const list = Array.from(users.values()).map(u => ({
    username: u.username,
    isMod: u.isMod,
    joinedAt: u.joinedAt
  }));
  console.log(`Broadcasting users list: ${JSON.stringify(list)}`);
  broadcastToAll('users_list', list);
}

// === Cleanup ===
setInterval(() => {
  const now = Date.now();

  // cleanup polling clients
  longPollingClients.forEach((client, clientId) => {
    if (now - client.lastCheck > 30000) {
      if (client.res && !client.res.finished) {
        try { client.res.json({ events: [], timestamp: now }); } catch {}
      }
      longPollingClients.delete(clientId);
    }
  });

  // cleanup users
  users.forEach((user, clientId) => {
    if (now - user.lastCheck > 30000) {
      users.delete(clientId);
      longPollingClients.delete(clientId);
      console.log(`User cleaned up due to inactivity: ${user.username} (clientId: ${clientId})`);
      broadcastToAll('user_left', user.username);
      broadcastUsersList();
    }
  });
}, 10000);

setInterval(() => {
  console.log(`Server status: ${users.size} active users, ${messages.length} messages stored`);
}, 30000);

http.createServer(app).listen(PORT, () =>
  console.log(`Server running on ${PORT} (long polling only)`)
);
