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
  users.set(clientId, { username, isMod: false, joinedAt: Date.now() });
  longPollingClients.set(clientId, { res: null, lastCheck: Date.now() });

  // Log encrypted username to console
  console.log(`User joined: ${username} (clientId: ${clientId})`);

  // Broadcast the encrypted username
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

  // Log encrypted message to console
  console.log(`Encrypted message from ${user.username}: ${message}`);

  // Store the message as-is (encrypted)
  const msgData = { 
    id: Date.now(), 
    username: user.username, 
    message,  // This is encrypted
    timestamp: Date.now(), // ← Use numeric timestamp instead
    clientId: clientId
  };
  
  messages.push(msgData);
  if (messages.length > 100) messages.shift();
  
  // Broadcast the encrypted message
  broadcastToAll('receive_message', msgData);
  res.json({ success: true });
});

app.post('/api/get-updates', (req, res) => {
  const { clientId } = req.body;
  if (!clientId || !users.has(clientId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Update last check time
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

// New endpoint to handle user leave events
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
      // Announce mod join to all users
      broadcastToAll('mod_joined', user.username);
      broadcastToClient(clientId, 'mod_status', { isMod: true });
      broadcastUsersList();
      return res.json({ success: true });
    }
  }
  res.json({ success: false });
});

// New endpoint to get active users
app.get('/api/active-users', (req, res) => {
  const activeUsers = Array.from(users.values()).map(u => ({
    username: u.username,
    isMod: u.isMod,
    joinedAt: u.joinedAt
  }));
  res.json({ users: activeUsers });
});

// New endpoint for mods to kick users
app.post('/api/kick-user', (req, res) => {
  const { clientId, targetUsername } = req.body;
  
  if (!clientId || !targetUsername) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) {
    return res.status(403).json({ error: 'Not a moderator' });
  }
  
  // Find the user to kick
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
    // Notify the user they've been kicked
    broadcastToClient(userClientId, 'kicked', {});
    
    // Remove the user
    users.delete(userClientId);
    longPollingClients.delete(userClientId);
    
    console.log(`User kicked: ${targetUsername} by ${moderator.username}`);
    broadcastToAll('user_left', userToKick.username);
    broadcastUsersList();
    
    return res.json({ success: true });
  }
  
  res.status(404).json({ error: 'User not found' });
});

// Add message deletion endpoint
app.post('/api/delete-message', (req, res) => {
  const { clientId, messageId } = req.body;
  
  if (!clientId || !messageId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  const moderator = users.get(clientId);
  if (!moderator || !moderator.isMod) {
    return res.status(403).json({ error: 'Not a moderator' });
  }
  
  // Find and remove the message
  const messageIndex = messages.findIndex(m => m.id === messageId);
  if (messageIndex !== -1) {
    messages.splice(messageIndex, 1);
    // Broadcast message deletion to all clients
    broadcastToAll('message_deleted', messageId);
    return res.json({ success: true });
  }
  
  res.status(404).json({ error: 'Message not found' });
});
// Add this to the server.js file after the existing endpoints

app.post('/api/send-dm', (req, res) => {
  const { clientId, targetClientId, message } = req.body;
  if (!clientId || !targetClientId || !message) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  
  const sender = users.get(clientId);
  const receiver = users.get(targetClientId);
  
  if (!sender || !receiver) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Log encrypted DM to console
  console.log(`Encrypted DM from ${sender.username} to ${receiver.username}: ${message}`);

  // Create DM message
  const dmData = { 
    id: Date.now(), 
    senderId: clientId,
    senderUsername: sender.username,
    receiverId: targetClientId,
    receiverUsername: receiver.username,
    message,  // This is encrypted
    timestamp: Date.now(),
    isDM: true
  };
  
  // Send to both participants
  broadcastToClient(clientId, 'receive_dm', dmData);
  broadcastToClient(targetClientId, 'receive_dm', dmData);
  
  res.json({ success: true });
});

// Add this to the broadcastToClient function to ensure it works for DMs
function broadcastToClient(clientId, event, data) {
  const client = longPollingClients.get(clientId);
  if (client && client.res && !client.res.finished) {
    client.res.json({ events: [{ event, data, timestamp: Date.now() }], timestamp: Date.now() });
    longPollingClients.delete(clientId);
  }
}
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

// === Cleanup (more forgiving) ===
setInterval(() => {
  const now = Date.now();
  longPollingClients.forEach((client, clientId) => {
    if (now - client.lastCheck > 30000) { // 30s grace period instead of 90s
      if (client.res && !client.res.finished) {
        try {
          client.res.json({ events: [], timestamp: now });
        } catch (e) {
          // Response might already be closed
        }
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
}, 10000); // Check every 10 seconds

// Log server status periodically
setInterval(() => {
  console.log(`Server status: ${users.size} active users, ${messages.length} messages stored`);
}, 30000);

http.createServer(app).listen(PORT, () => console.log(`Server running on ${PORT} (long polling only)`));
