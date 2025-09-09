document.addEventListener('DOMContentLoaded', function() {
    const SERVER_URL = 'https://multiplayer-6vlc.onrender.com'; // HTTPS for WSS
    let username = '';
    let clientId = null;
    let usingLongPolling = false;
    let pollingInterval = null;
    let lastUpdateTime = Date.now();

    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const usernameInput = document.getElementById('username-input');
    const joinButton = document.getElementById('join-button');
    const usernameSetup = document.getElementById('username-setup');
    const chatContainer = document.querySelector('.chat-container');

    chatContainer.style.display = 'none';

    initializeConnection();

    function initializeConnection() {
        console.log('Trying WSS connection...');
        try {
            const socket = io(SERVER_URL, {
                transports: ['websocket'],
                timeout: 5000
            });

            socket.on('connect', () => {
                console.log('✅ Connected via WSS');
                setupSocketEvents(socket);
            });

            socket.on('connect_error', (err) => {
                console.warn('WSS failed, falling back to long polling:', err);
                socket.disconnect();
                setupLongPolling();
            });

            // Timeout fallback
            setTimeout(() => {
                if (!socket.connected) {
                    console.warn('WSS timeout, switching to long polling');
                    socket.disconnect();
                    setupLongPolling();
                }
            }, 5000);

        } catch (err) {
            console.warn('WSS not available, using long polling:', err);
            setupLongPolling();
        }
    }

    function setupLongPolling() {
        usingLongPolling = true;
        addSystemMessage('Using long polling connection (school-friendly)');
    }

    function startPolling() {
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(() => {
            if (clientId) fetchUpdates();
        }, 3000);
    }

    function fetchUpdates() {
        fetch(`${SERVER_URL}/api/get-updates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, lastUpdate: lastUpdateTime })
        })
        .then(res => res.json())
        .then(data => {
            if (data.events?.length) {
                data.events.forEach(e => handleServerEvent(e.event, e.data));
            }
            lastUpdateTime = data.timestamp || Date.now();
        })
        .catch(err => console.error('Polling error:', err));
    }

    function setupSocketEvents(socket) {
        window.chatSocket = socket;

        socket.on('disconnect', (reason) => {
            console.warn('Disconnected from WSS:', reason);
            addSystemMessage('Disconnected from server');
        });

        socket.on('connect_error', (err) => {
            console.warn('WSS connection error:', err);
            addSystemMessage('Connection error. Refresh page.');
        });

        socket.onAny((event, data) => {
            handleServerEvent(event, data);
        });
    }

    function handleServerEvent(event, data) {
        switch (event) {
            case 'user_joined': addSystemMessage(`${data} joined`); break;
            case 'user_left': addSystemMessage(`${data} left`); break;
            case 'receive_message': addMessage(data.username, data.message, data.timestamp); break;
            case 'users_list':
                document.getElementById('users-online').textContent = `${data.length} users online`;
                break;
            case 'mod_status':
                if (data.isMod) addSystemMessage('You are now a moderator!');
                break;
        }
    }

    joinButton.addEventListener('click', joinChat);
    usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') joinChat(); });

    function joinChat() {
        username = usernameInput.value.trim();
        if (!username) return alert('Enter a username');

        if (usingLongPolling) {
            fetch(`${SERVER_URL}/api/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    clientId = data.clientId;
                    usernameSetup.style.display = 'none';
                    chatContainer.style.display = 'flex';
                    messageInput.disabled = false; sendButton.disabled = false; messageInput.focus();
                    addSystemMessage(`Welcome, ${username}!`);
                    if (data.messages) data.messages.forEach(m => addMessage(m.username, m.message, m.timestamp));
                    startPolling();
                } else alert('Failed to join: ' + data.error);
            }).catch(err => console.error('Join error:', err));
        } else {
            window.chatSocket.emit('user_joined', username);
            usernameSetup.style.display = 'none';
            chatContainer.style.display = 'flex';
            messageInput.disabled = false; sendButton.disabled = false; messageInput.focus();
            addSystemMessage(`Welcome, ${username}!`);
        }
    }

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    function sendMessage() {
        const msg = messageInput.value.trim();
        if (!msg) return;

        if (usingLongPolling) {
            fetch(`${SERVER_URL}/api/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, message: msg })
            }).then(res => res.json()).then(() => messageInput.value = '');
        } else {
            window.chatSocket.emit('send_message', { message: msg });
            messageInput.value = '';
        }
    }

    function addMessage(username, message, timestamp) {
        const el = document.createElement('div');
        el.classList.add('message');
        el.innerHTML = `<div class="username">${username}</div><div class="text">${message}</div><div class="timestamp">${timestamp}</div>`;
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function addSystemMessage(msg) {
        const el = document.createElement('div');
        el.classList.add('system-message');
        el.textContent = msg;
        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});
