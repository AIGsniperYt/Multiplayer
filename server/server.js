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
  }
});

// Enhanced CORS configuration
app.use(cors({
  origin: ["https://aigsniperyt.github.io", "http://localhost:3000"],
  credentials: true
}));

// Serve static files from the root directory (for testing)
app.use(express.static(path.join(__dirname, '..')));

// Store connected users and moderators
const users = new Map(); // socket.id -> {username, isMod}
const messages = []; // Store recent messages for moderation
const SECRET_MOD_PASSWORD = "plum_rain88"; // Change this to whatever you want

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Handle user joining
  socket.on('user_joined', (username) => {
    users.set(socket.id, { username, isMod: false });
    socket.broadcast.emit('user_joined', username);
    io.emit('users_list', Array.from(users.values()).map(user => ({
      username: user.username,
      isMod: user.isMod
    })));
    console.log(`${username} joined the chat`);
  });
  
  // Handle chat messages
  socket.on('send_message', (data) => {
    const user = users.get(socket.id);
    if (user) {
      const messageData = {
        id: Date.now() + Math.random(), // Unique ID for moderation
        username: user.username,
        message: data.message,
        timestamp: new Date().toLocaleTimeString(),
        socketId: socket.id
      };
      
      messages.push(messageData);
      // Keep only last 100 messages
      if (messages.length > 100) messages.shift();
      
      io.emit('receive_message', messageData);
      console.log(`${user.username}: ${data.message}`);
    }
  });
  
  // Handle moderation commands
  socket.on('mod_command', (data) => {
    const user = users.get(socket.id);
    if (user && user.isMod) {
      handleModCommand(socket, data);
    }
  });
  
  // Handle becoming a moderator
  socket.on('become_mod', (password) => {
    if (password === SECRET_MOD_PASSWORD) {
      const user = users.get(socket.id);
      if (user) {
        user.isMod = true;
        socket.emit('mod_status', { isMod: true });
        io.emit('users_list', Array.from(users.values()).map(user => ({
          username: user.username,
          isMod: user.isMod
        })));
        console.log(`${user.username} became a moderator`);
      }
    }
  });
  
  // Handle user typing
  socket.on('typing', (data) => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_typing', {
        username: user.username,
        isTyping: data.isTyping
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_left', user.username);
      users.delete(socket.id);
      io.emit('users_list', Array.from(users.values()).map(user => ({
        username: user.username,
        isMod: user.isMod
      })));
      console.log(`${user.username} left the chat`);
    }
    console.log('User disconnected:', socket.id);
  });
  
  // Handle moderation commands
  function handleModCommand(socket, data) {
    const user = users.get(socket.id);
    if (!user || !user.isMod) return;
    
    switch (data.command) {
      case 'kick':
        const userToKick = Array.from(users.entries()).find(
          ([id, u]) => u.username === data.target
        );
        if (userToKick) {
          io.to(userToKick[0]).emit('kicked', { reason: data.reason });
          userToKick[1].socketId = userToKick[0]; // Store socket ID for disconnection
          setTimeout(() => {
            io.sockets.sockets.get(userToKick[0])?.disconnect();
          }, 1000);
          io.emit('system_message', `${data.target} was kicked by ${user.username}`);
          console.log(`${user.username} kicked ${data.target}`);
        }
        break;
        
      case 'delete':
        const messageIndex = messages.findIndex(m => m.id === data.messageId);
        if (messageIndex !== -1) {
          io.emit('message_deleted', { messageId: data.messageId });
          messages.splice(messageIndex, 1);
          console.log(`${user.username} deleted a message`);
        }
        break;
        
      case 'ban':
        // Similar to kick but you might want to store banned users
        io.emit('system_message', `${data.target} was banned by ${user.username}`);
        console.log(`${user.username} banned ${data.target}`);
        break;
    }
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS enabled for GitHub Pages and localhost`);
  console.log(`Moderator password: ${SECRET_MOD_PASSWORD}`);
});
