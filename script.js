document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const usernameInput = document.getElementById('username-input');
    const joinButton = document.getElementById('join-button');
    const usernameSetup = document.getElementById('username-setup');
    const typingIndicator = document.getElementById('typing-indicator');
    const usersOnline = document.getElementById('users-online');
    const chatContainer = document.querySelector('.chat-container');
    
    // Initially hide the chat interface
    chatContainer.style.display = 'none';
    
    // Connect to server - for local testing
    const socket = io('https://multiplayer-6vlc.onrender.com/');
    
    let username = '';
    let isTyping = false;
    let typingTimer;
    
    // Show username prompt immediately
    usernameInput.focus();
    
    // Join chat event
    joinButton.addEventListener('click', joinChat);
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinChat();
    });
    
    function joinChat() {
        username = usernameInput.value.trim();
        if (username) {
            socket.emit('user_joined', username);
            usernameSetup.style.display = 'none';
            chatContainer.style.display = 'flex'; // Show the chat interface
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.focus();
            
            // Add welcome message
            addSystemMessage(`Welcome to the chat, ${username}!`);
        } else {
            alert('Please enter a username to join the chat');
            usernameInput.focus();
        }
    }
    
    // Send message event
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            socket.emit('send_message', { message });
            messageInput.value = '';
            socket.emit('typing', { isTyping: false });
        }
    }
    
    // Typing events
    messageInput.addEventListener('input', () => {
        if (!isTyping) {
            isTyping = true;
            socket.emit('typing', { isTyping: true });
        }
        
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            isTyping = false;
            socket.emit('typing', { isTyping: false });
        }, 1000);
    });
    
    // Socket events
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        addSystemMessage('Disconnected from server');
    });
    
    socket.on('user_joined', (joinedUsername) => {
        if (joinedUsername !== username) {
            addSystemMessage(`${joinedUsername} joined the chat`);
        }
    });
    
    socket.on('user_left', (leftUsername) => {
        addSystemMessage(`${leftUsername} left the chat`);
    });
    
    socket.on('receive_message', (data) => {
        addMessage(data.username, data.message, data.timestamp, data.username !== username);
    });
    
    socket.on('user_typing', (data) => {
        if (data.isTyping && data.username !== username) {
            typingIndicator.textContent = `${data.username} is typing...`;
        } else {
            typingIndicator.textContent = '';
        }
    });
    
    socket.on('users_list', (users) => {
        usersOnline.textContent = `${users.length} users online`;
    });
    
    // Helper functions
    function addMessage(username, message, timestamp, isOther = true) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.classList.add(isOther ? 'other' : 'own');
        
        messageEl.innerHTML = `
            <div class="username">${username}</div>
            <div class="text">${message}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function addSystemMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('system-message');
        messageEl.textContent = message;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

});
