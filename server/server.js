const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ["https://aigsniperyt.github.io"], credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// === Long polling storage ===
const longPollingClients = new Map();
const users = new Map();
const messages = [];
const SECRET_MOD_PASSWORD = "esports2024";

// === HTTP endpoints ===
app.post('/api/join', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Store the username as-is (encrypted)
  users.set(clientId, { username, isMod: false });
  longPollingClients.set(clientId, { res: null, lastCheck: Date.now() });

  // Broadcast the encrypted username
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
  if (!clientId || !message) return res.status(400).json({ error: 'Missing fields' });
  const user = users.get(clientId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Store the message as-is (encrypted)
  const msgData = { 
    id: Date.now(), 
    username: user.username, 
    message,  // This is encrypted
    timestamp: new Date().toLocaleTimeString() 
  };
  
  messages.push(msgData);
  if (messages.length > 100) messages.shift();
  
  // Broadcast the encrypted message
  broadcastToAll('receive_message', msgData);
  res.json({ success: true });
});

app.post('/api/get-updates', (req, res) => {
  const { clientId } = req.body;
  if (!clientId || !users.has(clientId)) return res.status(404).json({
error: 'User not found' });

  longPollingClients.set(clientId, { res, lastCheck: Date.now() });
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
    client.res.json({ events: [{ event, data, timestamp: Date.now()
}], timestamp: Date.now() });
    longPollingClients.delete(clientId);
  }
}

function broadcastUsersList() {
  const list = Array.from(users.values()).map(u => ({ username:
u.username, isMod: u.isMod }));
  broadcastToAll('users_list', list);
}

// === Cleanup (more forgiving) ===
setInterval(() => {
  const now = Date.now();
  longPollingClients.forEach((client, clientId) => {
    if (now - client.lastCheck > 90000) { // 90s grace
      if (client.res && !client.res.finished) client.res.json({
events: [], timestamp: now });
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

http.createServer(app).listen(PORT, () => console.log(`Server running
on ${PORT} (long polling only)`));
