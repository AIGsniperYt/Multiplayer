const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for testing
    methods: ["GET", "POST"]
  }
});

app.use(cors());
// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

// Store connected users
const users = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Handle user joining
  socket.on('user_joined', (username) => {
    users.set(socket.id, username);
    socket.broadcast.emit('user_joined', username);
    io.emit('users_list', Array.from(users.values()));
    console.log(`${username} joined the chat`);
  });
  
  // Handle chat messages
  socket.on('send_message', (data) => {
    const username = users.get(socket.id);
    if (username) {
      io.emit('receive_message', {
        username: username,
        message: data.message,
        timestamp: new Date().toLocaleTimeString()
      });
      console.log(`${username}: ${data.message}`);
    }
  });
  
  // Handle user typing
  socket.on('typing', (data) => {
    const username = users.get(socket.id);
    if (username) {
      socket.broadcast.emit('user_typing', {
        username: username,
        isTyping: data.isTyping
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    const username = users.get(socket.id);
    if (username) {
      socket.broadcast.emit('user_left', username);
      users.delete(socket.id);
      io.emit('users_list', Array.from(users.values()));
      console.log(`${username} left the chat`);
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to test the chat`);
});