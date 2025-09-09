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
    const modTools = document.getElementById('mod-tools');
    
    // Initially hide the chat interface and mod tools
    chatContainer.style.display = 'none';
    if (modTools) modTools.style.display = 'none';
    
    // Connect to server - use your Render URL
    const socket = io('https://multiplayer-6vlc.onrender.com', {
        transports: ['websocket', 'polling']
    });
    
    let username = '';
    let isTyping = false;
    let typingTimer;
    let isModerator = false;
    let messageMap = new Map(); // Store messages for moderation
    
    // Show username prompt immediately
    usernameInput.focus();
    
    // Connection status monitoring
    socket.on('connect', () => {
        console.log('Connected to server successfully');
        addSystemMessage('Connected to chat server');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        addSystemMessage('Disconnected from server');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        addSystemMessage('Connection error. Please refresh the page.');
    });
    
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
            chatContainer.style.display = 'flex';
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.focus();
            
            addSystemMessage(`Welcome to the chat, ${username}!`);
            
            // Add mod promotion input
            const modPrompt = document.createElement('div');
            modPrompt.innerHTML = `
                <div style="margin: 10px 0; text-align: center;">
                    <input type="password" id="mod-password" placeholder="Mod password (optional)" style="padding: 8px; margin-right: 5px;">
                    <button id="become-mod">Become Mod</button>
                </div>
            `;
            usernameSetup.parentNode.insertBefore(modPrompt, usernameSetup.nextSibling);
            
            document.getElementById('become-mod').addEventListener('click', becomeModerator);
        } else {
            alert('Please enter a username to join the chat');
            usernameInput.focus();
        }
    }
    
    function becomeModerator() {
        const password = document.getElementById('mod-password').value;
        socket.emit('become_mod', password);
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
    socket.on('user_joined', (joinedUsername) => {
        if (joinedUsername !== username) {
            addSystemMessage(`${joinedUsername} joined the chat`);
        }
    });
    
    socket.on('user_left', (leftUsername) => {
        addSystemMessage(`${leftUsername} left the chat`);
    });
    
    socket.on('receive_message', (data) => {
        const messageElement = addMessage(data.username, data.message, data.timestamp, data.username !== username);
        messageMap.set(data.id, { element: messageElement, data: data });
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
        
        // Show mod tools if user is a moderator
        if (isModerator && modTools) {
            modTools.style.display = 'block';
            updateUserListForModeration(users);
        }
    });
    
    socket.on('mod_status', (data) => {
        isModerator = data.isMod;
        if (isModerator) {
            addSystemMessage('You are now a moderator! Mod tools enabled.');
            if (modTools) modTools.style.display = 'block';
            // Request updated user list
            socket.emit('get_users');
        }
    });
    
    socket.on('message_deleted', (data) => {
        const messageInfo = messageMap.get(data.messageId);
        if (messageInfo) {
            messageInfo.element.style.display = 'none';
            messageMap.delete(data.messageId);
        }
    });
    
    socket.on('kicked', (data) => {
        alert(`You have been kicked from the chat. Reason: ${data.reason}`);
        window.location.reload();
    });
    
    socket.on('system_message', (message) => {
        addSystemMessage(message);
    });
    
    // Helper functions
    function addMessage(username, message, timestamp, isOther = true) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.classList.add(isOther ? 'other' : 'own');
        
        messageEl.innerHTML = `
            <div class="username">${username} ${isModerator ? `<button class="kick-btn" data-username="${username}">Kick</button>` : ''}</div>
            <div class="text">${message}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add kick functionality for moderators
        if (isModerator) {
            const kickBtn = messageEl.querySelector('.kick-btn');
            if (kickBtn) {
                kickBtn.addEventListener('click', () => {
                    const usernameToKick = kickBtn.getAttribute('data-username');
                    const reason = prompt(`Reason for kicking ${usernameToKick}:`);
                    if (reason) {
                        socket.emit('mod_command', {
                            command: 'kick',
                            target: usernameToKick,
                            reason: reason
                        });
                    }
                });
            }
        }
        
        return messageEl;
    }
    
    function addSystemMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('system-message');
        messageEl.textContent = message;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function updateUserListForModeration(users) {
        if (!modTools) return;
        
        const userList = modTools.querySelector('#user-list');
        if (userList) {
            userList.innerHTML = '';
            users.forEach(user => {
                const userItem = document.createElement('div');
                userItem.innerHTML = `
                    ${user.username} ${user.isMod ? '(Mod)' : ''}
                    ${!user.isMod ? `<button class="kick-btn" data-username="${user.username}">Kick</button>` : ''}
                `;
                userList.appendChild(userItem);
                
                // Add kick functionality
                const kickBtn = userItem.querySelector('.kick-btn');
                if (kickBtn) {
                    kickBtn.addEventListener('click', () => {
                        const usernameToKick = kickBtn.getAttribute('data-username');
                        const reason = prompt(`Reason for kicking ${usernameToKick}:`);
                        if (reason) {
                            socket.emit('mod_command', {
                                command: 'kick',
                                target: usernameToKick,
                                reason: reason
                            });
                        }
                    });
                }
            });
        }
    }
});
