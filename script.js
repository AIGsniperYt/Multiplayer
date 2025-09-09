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
    
    // Connection variables
    let username = '';
    let isTyping = false;
    let typingTimer;
    let isModerator = false;
    let messageMap = new Map();
    let clientId = null;
    let lastUpdateTime = Date.now();
    let usingLongPolling = false;
    let pollingInterval = null;
    
    // Server base URL
    const SERVER_URL = 'https://multiplayer-6vlc.onrender.com';
    
    // Try WebSocket connection first, fall back to long polling
    initializeConnection();
    
    function initializeConnection() {
        // Try WebSocket first
        try {
            const socket = io(SERVER_URL, {
                transports: ['websocket', 'polling'],
                timeout: 5000
            });
            
            socket.on('connect', () => {
                console.log('Connected via WebSocket');
                setupSocketEvents(socket);
            });
            
            socket.on('connect_error', (error) => {
                console.log('WebSocket failed, trying long polling:', error);
                socket.disconnect();
                setupLongPolling();
            });
            
            // Timeout for WebSocket connection
            setTimeout(() => {
                if (!socket.connected) {
                    console.log('WebSocket connection timeout, trying long polling');
                    socket.disconnect();
                    setupLongPolling();
                }
            }, 5000);
        } catch (error) {
            console.log('WebSocket not available, using long polling:', error);
            setupLongPolling();
        }
    }
    
    function setupLongPolling() {
        usingLongPolling = true;
        addSystemMessage('Using long polling connection (school-friendly)');
        
        // Start polling for updates after joining
        if (username) {
            startPolling();
        }
    }
    
    function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        
        pollingInterval = setInterval(() => {
            if (clientId) {
                fetchUpdates();
            }
        }, 3000);
    }
    
    function fetchUpdates() {
        fetch(`${SERVER_URL}/api/get-updates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                clientId: clientId,
                lastUpdate: lastUpdateTime
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.events && data.events.length > 0) {
                data.events.forEach(event => {
                    handleServerEvent(event.event, event.data);
                });
            }
            lastUpdateTime = data.timestamp || Date.now();
        })
        .catch(error => {
            console.error('Polling error:', error);
        });
    }
    
    function handleServerEvent(event, data) {
        switch (event) {
            case 'user_joined':
                if (data !== username) {
                    addSystemMessage(`${data} joined the chat`);
                }
                break;
                
            case 'user_left':
                addSystemMessage(`${data} left the chat`);
                break;
                
            case 'receive_message':
                addMessage(data.username, data.message, data.timestamp, data.username !== username);
                break;
                
            case 'users_list':
                usersOnline.textContent = `${data.length} users online`;
                break;
                
            case 'mod_status':
                isModerator = data.isMod;
                if (isModerator) {
                    addSystemMessage('You are now a moderator!');
                }
                break;
        }
    }
    
    function setupSocketEvents(socket) {
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
        
        socket.on('mod_status', (data) => {
            isModerator = data.isMod;
            if (isModerator) {
                addSystemMessage('You are now a moderator!');
            }
        });
        
        // Store socket for later use
        window.chatSocket = socket;
    }
    
    // Join chat event
    joinButton.addEventListener('click', joinChat);
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinChat();
    });
    
    function joinChat() {
        username = usernameInput.value.trim();
        if (username) {
            if (usingLongPolling) {
                // Join via long polling
                fetch(`${SERVER_URL}/api/join`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        clientId = data.clientId;
                        usernameSetup.style.display = 'none';
                        chatContainer.style.display = 'flex';
                        messageInput.disabled = false;
                        sendButton.disabled = false;
                        messageInput.focus();
                        
                        addSystemMessage(`Welcome to the chat, ${username}!`);
                        
                        // Load previous messages
                        if (data.messages) {
                            data.messages.forEach(msg => {
                                addMessage(msg.username, msg.message, msg.timestamp, msg.username !== username);
                            });
                        }
                        
                        // Start polling for updates
                        startPolling();
                        
                        // Add mod promotion input
                        addModPrompt();
                    } else {
                        alert('Failed to join chat: ' + data.error);
                    }
                })
                .catch(error => {
                    console.error('Join error:', error);
                    alert('Failed to connect to server');
                });
            } else {
                // Join via WebSocket
                window.chatSocket.emit('user_joined', username);
                usernameSetup.style.display = 'none';
                chatContainer.style.display = 'flex';
                messageInput.disabled = false;
                sendButton.disabled = false;
                messageInput.focus();
                
                addSystemMessage(`Welcome to the chat, ${username}!`);
                addModPrompt();
            }
        } else {
            alert('Please enter a username to join the chat');
            usernameInput.focus();
        }
    }
    
    function addModPrompt() {
        const modPrompt = document.createElement('div');
        modPrompt.innerHTML = `
            <div style="margin: 10px 0; text-align: center;">
                <input type="password" id="mod-password" placeholder="Mod password (optional)" style="padding: 8px; margin-right: 5px;">
                <button id="become-mod">Become Mod</button>
            </div>
        `;
        usernameSetup.parentNode.insertBefore(modPrompt, usernameSetup.nextSibling);
        
        document.getElementById('become-mod').addEventListener('click', becomeModerator);
    }
    
    function becomeModerator() {
        const password = document.getElementById('mod-password').value;
        
        if (usingLongPolling) {
            fetch(`${SERVER_URL}/api/become-mod`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ clientId, password })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    isModerator = true;
                    addSystemMessage('You are now a moderator!');
                } else {
                    alert('Invalid mod password');
                }
            });
        } else {
            window.chatSocket.emit('become_mod', password);
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
            if (usingLongPolling) {
                fetch(`${SERVER_URL}/api/send-message`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ clientId, message })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        messageInput.value = '';
                    }
                })
                .catch(error => {
                    console.error('Send message error:', error);
                });
            } else {
                window.chatSocket.emit('send_message', { message });
                messageInput.value = '';
            }
        }
    }
    
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
        
        return messageEl;
    }
    
    function addSystemMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('system-message');
        messageEl.textContent = message;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});
