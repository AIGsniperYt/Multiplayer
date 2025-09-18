const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS at the very top
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
      "http://localhost:5500"          // Another common Live Server port
    ];

    // 3. Check if the origin is in the allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 4. Log the blocked origin for debugging (check your Render logs!)
      console.log('🚫 CORS: BLOCKING request from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true
}));

// Handle preflight globally
app.options("*", cors());

// JSON middleware
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
// Static files AFTER CORS
app.use(express.static(path.join(__dirname, '..')));

// === Long polling storage ===
const longPollingClients = new Map();
const users = new Map();
const messages = [];

// === Server Activation System ===
let isServerActive = false;
let activeModerator = null;
const SERVER_ACTIVATION_PASSWORD = "esports2024";
const SERVER_TIMEOUT = 120000; // 2 minutes

setInterval(() => {
  if (isServerActive && activeModerator) {
    const mod = users.get(activeModerator);
    if (!mod || Date.now() - mod.lastCheck > 30000) {
      console.log("Moderator disconnected - deactivating server");
      deactivateServer();
    }
  } else if (isServerActive && !activeModerator) {
    setTimeout(() => {
      if (!activeModerator) {
        console.log("Server timeout - no moderator present");
        deactivateServer();
      }
    }, SERVER_TIMEOUT);
  }
}, 30000);

function activateServer(modClientId) {
  isServerActive = true;
  activeModerator = modClientId;
  console.log(`Server activated by moderator: ${users.get(modClientId)?.username}`);
  broadcastToAll('server_activated', {});
}

function deactivateServer() {
  isServerActive = false;
  activeModerator = null;
  console.log("Server deactivated - requires moderator");
  users.clear();
  longPollingClients.forEach((client, clientId) => {
    if (client.res && !client.res.finished) {
      client.res.json({ error: 'Server deactivated. Please refresh.' });
    }
  });
  longPollingClients.clear();
  messages.length = 0;
  broadcastToAll('server_deactivated', {});
}

// === HTTP endpoints ===
app.post('/api/join', (req, res) => {
  if (!isServerActive) {
    return res.status(403).json({ error: 'Server not active. Requires moderator activation.' });
  }

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  users.set(clientId, { username, isMod: false, joinedAt: Date.now(), clientId, lastCheck: Date.now() });
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
      joinedAt: u.joinedAt,
      clientId: u.clientId
    }))
  });
});

app.post('/api/send-message', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, message } = req.body;
  if (!clientId || !message) return res.status(400).json({ error: 'Missing fields' });
  const user = users.get(clientId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  console.log(`Encrypted message from ${user.username}: ${message}`);

  const msgData = { 
    id: Date.now(), 
    username: user.username, 
    message,
    timestamp: Date.now(),
    clientId: clientId
  };
  
  messages.push(msgData);
  if (messages.length > 100) messages.shift();
  
  broadcastToAll('receive_message', msgData);
  res.json({ success: true });
});

app.post('/api/get-updates', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId } = req.body;
  if (!clientId || !users.has(clientId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userData = users.get(clientId);
  if (userData) userData.lastCheck = Date.now();
  
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
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

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

app.post('/api/activate-server', (req, res) => {
  const { password, clientId: providedClientId } = req.body;
  if (password === SERVER_ACTIVATION_PASSWORD) {
    if (!isServerActive) {
      let clientId = providedClientId;
      if (!clientId || !users.has(clientId)) {
        clientId = `lp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        users.set(clientId, {
          username: "Moderator",
          isMod: true,
          joinedAt: Date.now(),
          clientId,
          lastCheck: Date.now()
        });
      } else {
        const user = users.get(clientId);
        user.isMod = true;
      }
      activateServer(clientId);
      return res.json({ success: true, clientId, isMod: true });
    }
    return res.json({ success: true, message: 'Server already active' });
  }
  res.json({ success: false, error: 'Invalid activation password' });
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
  const activeUsers = Array.from(users.values()).map(u => ({
    username: u.username,
    isMod: u.isMod,
    joinedAt: u.joinedAt,
    clientId: u.clientId
  }));
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
    broadcastToAll('user_left', userToKick.username);
    broadcastUsersList();
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'User not found' });
});

app.post('/api/delete-message', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, messageId } = req.body;
  if (!clientId || !messageId) return res.status(400).json({ error: 'Missing parameters' });
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) return res.status(403).json({ error: 'Not a moderator' });

  const messageIndex = messages.findIndex(m => m.id === messageId);
  if (messageIndex !== -1) {
    messages.splice(messageIndex, 1);
    broadcastToAll('message_deleted', messageId);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Message not found' });
});

app.post('/api/send-dm', (req, res) => {
  if (!isServerActive) return res.status(403).json({ error: 'Server not active' });

  const { clientId, targetClientId, message } = req.body;
  if (!clientId || !targetClientId || !message) return res.status(400).json({ error: 'Missing fields' });
  const sender = users.get(clientId);
  const receiver = users.get(targetClientId);
  if (!sender || !receiver) return res.status(404).json({ error: 'User not found' });

  console.log(`Encrypted DM from ${sender.username} to ${receiver.username}: ${message}`);

  const dmData = { 
    id: Date.now(), 
    senderId: clientId,
    senderUsername: sender.username,
    receiverId: targetClientId,
    receiverUsername: receiver.username,
    message,
    timestamp: Date.now(),
    isDM: true
  };
  broadcastToClient(clientId, 'receive_dm', dmData);
  broadcastToClient(targetClientId, 'receive_dm', dmData);
  res.json({ success: true });
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
    joinedAt: u.joinedAt,
    clientId: u.clientId
  }));
  console.log(`Broadcasting users list: ${JSON.stringify(list)}`);
  broadcastToAll('users_list', list);
}

// === Cleanup ===
setInterval(() => {
  const now = Date.now();
  longPollingClients.forEach((client, clientId) => {
    if (now - client.lastCheck > 30000) {
      if (client.res && !client.res.finished) {
        try { client.res.json({ events: [], timestamp: now }); } catch {}
      }
      longPollingClients.delete(clientId);
      const user = users.get(clientId);
      if (user) {
        users.delete(clientId);
        console.log(`User cleaned up due to inactivity: ${user.username} (clientId: ${clientId})`);
        broadcastToAll('user_left', user.username);
        broadcastUsersList();
      }
    }
  });
}, 10000);

setInterval(() => {
  console.log(`Server status: active=${isServerActive}, users=${users.size}, messages=${messages.length}`);
}, 30000);

http.createServer(app).listen(PORT, () => console.log(`Server running on ${PORT} (long polling only)`));


