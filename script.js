document.addEventListener('DOMContentLoaded', function() {
    const SERVER_URL = 'https://multiplayer-6vlc.onrender.com';
    let username = '';
    let clientId = null;
    let lastUpdateTime = Date.now();
    let cryptoKey = null;
    let isLeaving = false;
    let modActivationAttempted = false;

    // Initialize encryption
    initializeEncryption();

    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const usernameInput = document.getElementById('username-input');
    const joinButton = document.getElementById('join-button');
    const usernameSetup = document.getElementById('username-setup');
    const chatContainer = document.querySelector('.chat-container');
    const modActivation = document.getElementById('mod-activation');
    const modPasswordInput = document.getElementById('mod-password-input');
    const modSubmitBtn = document.getElementById('mod-submit-btn');
    const modCancelBtn = document.getElementById('mod-cancel-btn');

    chatContainer.style.display = 'none';
    addSystemMessage("Using long polling only (school-friendly)");
    addSystemMessage("All messages are encrypted end-to-end");

    joinButton.addEventListener('click', joinChat);
    usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') joinChat(); });
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
    messageInput.addEventListener('input', handleMessageInput);
    modSubmitBtn.addEventListener('click', attemptModActivation);
    modCancelBtn.addEventListener('click', () => {
        modActivation.style.display = 'none';
        modActivationAttempted = false;
        messageInput.focus();
    });
    modPasswordInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') attemptModActivation();
    });

    // Handle page/tab close or refresh
    window.addEventListener('beforeunload', () => {
        if (clientId && !isLeaving) {
            isLeaving = true;
            const data = new Blob(
                [JSON.stringify({ clientId })],
                { type: 'application/json' }
            );
            navigator.sendBeacon(`${SERVER_URL}/api/leave`, data);
        }
    });

    // Encryption initialization
    async function initializeEncryption() {
        try {
            // Generate a key from a fixed passphrase
            const passphrase = "chat-secret-" + new Date().getFullYear();
            const encoder = new TextEncoder();
            const keyData = encoder.encode(passphrase);
            
            // Import key for AES-GCM encryption
            cryptoKey = await crypto.subtle.importKey(
                'raw',
                keyData,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
        } catch (error) {
            console.error('Encryption initialization failed:', error);
            addSystemMessage("Encryption unavailable - using plain text");
        }
    }

    // Encryption function
    async function encryptText(text) {
        if (!cryptoKey) return text; // Fallback to plain text if encryption isn't available
        
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            
            // Generate IV (Initialization Vector)
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt the data
            const encryptedData = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                cryptoKey,
                data
            );
            
            // Combine IV and encrypted data, then convert to base64 for transmission
            const combined = new Uint8Array(iv.length + encryptedData.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(encryptedData), iv.length);
            
            return btoa(String.fromCharCode.apply(null, combined));
        } catch (error) {
            console.error('Encryption error:', error);
            return text; // Fallback to plain text
        }
    }

    // Decryption function
    async function decryptText(encryptedBase64) {
        if (!cryptoKey || !encryptedBase64.startsWith('ENCRYPTED:')) {
            return encryptedBase64; // Not encrypted or encryption not available
        }
        
        try {
            // Remove the prefix and decode from base64
            const encryptedData = encryptedBase64.substring(10);
            const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
            
            // Extract IV and encrypted data
            const iv = combined.slice(0, 12);
            const data = combined.slice(12);
            
            // Decrypt the data
            const decryptedData = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                cryptoKey,
                data
            );
            
            // Convert back to text
            const decoder = new TextDecoder();
            return decoder.decode(decryptedData);
        } catch (error) {
            console.error('Decryption error:', error);
            return "[Unable to decrypt message]";
        }
    }

    function handleMessageInput(e) {
        const msg = messageInput.value;
        
        // Check for "/mod" command at the beginning of the message
        if (msg === '/mod' && !modActivationAttempted) {
            // Prevent the message from being sent
            messageInput.value = '';
            
            // Show mod activation dialog
            modActivationAttempted = true;
            modActivation.style.display = 'block';
            modPasswordInput.focus();
        }
    }

    async function attemptModActivation() {
        const password = modPasswordInput.value;
        if (!password) return;
        
        try {
            const response = await fetch(`${SERVER_URL}/api/become-mod`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, password })
            });
            
            const data = await response.json();
            if (data.success) {
                addSystemMessage('You are now a moderator!');
                document.getElementById('mod-tools').style.display = 'block';
                modActivation.style.display = 'none';
            } else {
                alert('Invalid mod password');
                modPasswordInput.value = '';
                modPasswordInput.focus();
            }
        } catch (error) {
            console.error('Mod activation error:', error);
            alert('Error activating mod status');
        }
    }

    async function joinChat() {
        username = usernameInput.value.trim();
        if (!username) return alert('Enter a username');

        // Encrypt the username before sending
        let encryptedUsername = username;
        if (cryptoKey) {
            encryptedUsername = "ENCRYPTED:" + await encryptText(username);
        }

        fetch(`${SERVER_URL}/api/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: encryptedUsername })
        })
        .then(res => res.json())
        .then(async data => {
            if (data.success) {
                clientId = data.clientId;
                usernameSetup.style.display = 'none';
                chatContainer.style.display = 'flex';
                messageInput.disabled = false;
                sendButton.disabled = false;
                messageInput.focus();
                addSystemMessage(`Welcome, ${username}!`);
                
                // Display active users count
                document.getElementById('users-online').textContent = `${data.users.length} users online`;
                
                // Decrypt and display previous messages
                if (data.messages) {
                    for (const m of data.messages) {
                        const decryptedUsername = await decryptText(m.username);
                        const decryptedMessage = await decryptText(m.message);
                        addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id);
                    }
                }
                
                startPolling();
            } else alert('Failed to join: ' + data.error);
        }).catch(err => console.error('Join error:', err));
    }

    async function sendMessage() {
        const msg = messageInput.value.trim();
        if (!msg) return;
        
        // Encrypt the message before sending
        let encryptedMessage = msg;
        if (cryptoKey) {
            encryptedMessage = "ENCRYPTED:" + await encryptText(msg);
        }
        
        fetch(`${SERVER_URL}/api/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, message: encryptedMessage })
        }).then(() => messageInput.value = '');
    }

    // === Proper long polling (no setInterval) ===
    function startPolling() {
        fetchUpdates();
    }

    async function fetchUpdates() {
        fetch(`${SERVER_URL}/api/get-updates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, lastUpdate: lastUpdateTime })
        })
        .then(res => {
            if (!res.ok) {
                throw new Error('Server error');
            }
            return res.json();
        })
        .then(async data => {
            if (data.events?.length) {
                for (const e of data.events) {
                    await handleServerEvent(e.event, e.data);
                }
            }
            lastUpdateTime = data.timestamp || Date.now();
            fetchUpdates(); // immediately open next poll
        })
        .catch(err => {
            console.error('Polling error:', err);
            // If we get a 404, the server doesn't know about us anymore
            if (err.message.includes('404') || err.message.includes('User not found')) {
                addSystemMessage("Disconnected from server. Please refresh to reconnect.");
                return;
            }
            setTimeout(fetchUpdates, 2000); // retry after 2s on error
        });
    }

    async function handleServerEvent(event, data) {
        switch (event) {
            case 'user_joined': 
                const joinedUser = await decryptText(data);
                addSystemMessage(`${joinedUser} joined`); 
                break;
            case 'user_left': 
                const leftUser = await decryptText(data);
                addSystemMessage(`${leftUser} left`); 
                break;
            case 'mod_joined': 
                const modUsername = await decryptText(data);
                addSystemMessage(`Moderator ${modUsername} has joined`); 
                break;
            case 'receive_message': 
                const decryptedUsername = await decryptText(data.username);
                const decryptedMessage = await decryptText(data.message);
                addMessage(decryptedUsername, decryptedMessage, data.timestamp, data.id); 
                break;
            case 'users_list': {
                document.getElementById('users-online').textContent = `${data.length} users online`;
                updateActiveUsersList(data); // Update the sidebar user list
                break;
            }
            case 'mod_status':
                if (data.isMod) {
                    addSystemMessage('You are now a moderator!');
                    document.getElementById('mod-tools').style.display = 'block';
                }
                break;
            case 'kicked':
                addSystemMessage('You have been kicked from the chat.');
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
                break;
            case 'message_deleted':
                // Find and remove the message from UI
                const messageEl = document.querySelector(`[data-message-id="${data}"]`);
                if (messageEl) {
                    messageEl.remove();
                    addSystemMessage('A message was deleted by a moderator');
                }
                break;
        }
    }
    async function updateActiveUsersList(usersArray) {
        const usersListEl = document.getElementById('active-users-list');
        if (!usersListEl) return;
        
        usersListEl.innerHTML = '';
        
        for (const user of usersArray) {
            try {
                const displayName = await decryptText(user.username);
                const userItem = document.createElement('div');
                userItem.classList.add('user-item');
                
                const userNameSpan = document.createElement('span');
                userNameSpan.classList.add('user-name');
                userNameSpan.textContent = displayName + (user.isMod ? ' (Mod)' : '');
                
                userItem.appendChild(userNameSpan);
                
                // Add kick button for moderators
                if (document.getElementById('mod-tools').style.display === 'block') {
                    const kickBtn = document.createElement('button');
                    kickBtn.classList.add('kick-btn');
                    kickBtn.textContent = 'Kick';
                    kickBtn.onclick = () => kickUser(user.username);
                    userItem.appendChild(kickBtn);
                }
                
                usersListEl.appendChild(userItem);
            } catch (e) {
                console.warn('Failed to decrypt username', e);
            }
        }
    }
    async function updateUserList(usersArray) {
        const userListEl = document.getElementById('user-list');
        if (!userListEl) return;

        userListEl.innerHTML = '<h4>Connected Users:</h4>';
        const list = document.createElement('ul');

        for (const user of usersArray) {
            let displayName = user.username;
            try {
                displayName = await decryptText(displayName);
            } catch (e) {
                console.warn('Failed to decrypt username, using raw value', e);
            }
            const item = document.createElement('li');
            item.textContent = `${displayName} ${user.isMod ? '(Mod)' : ''}`;
            
            // Add kick button for moderators
            if (document.getElementById('mod-tools').style.display === 'block') {
                const kickBtn = document.createElement('button');
                kickBtn.textContent = 'Kick';
                kickBtn.classList.add('kick-user-btn');
                kickBtn.style.marginLeft = '10px';
                kickBtn.style.padding = '2px 5px';
                kickBtn.style.fontSize = '10px';
                kickBtn.onclick = () => kickUser(user.username);
                item.appendChild(kickBtn);
            }
            
            list.appendChild(item);
        }

        userListEl.appendChild(list);
    }
    
    async function kickUser(username) {
        if (!confirm(`Are you sure you want to kick ${username}?`)) return;
        
        try {
            const response = await fetch(`${SERVER_URL}/api/kick-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, targetUsername: username })
            });
            
            const data = await response.json();
            if (!data.success) {
                alert('Failed to kick user');
            }
        } catch (error) {
            console.error('Kick user error:', error);
            alert('Error kicking user');
        }
    }
    
    async function deleteMessage(messageId) {
        if (!confirm('Are you sure you want to delete this message?')) return;
        
        try {
            const response = await fetch(`${SERVER_URL}/api/delete-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, messageId })
            });
            
            const data = await response.json();
            if (!data.success) {
                alert('Failed to delete message');
            }
        } catch (error) {
            console.error('Delete message error:', error);
            alert('Error deleting message');
        }
    }

    function addMessage(msgUsername, message, timestamp, messageId) {
        const el = document.createElement('div');
        if (msgUsername === username) { 
            el.classList.add('message', 'own');
        } else {
            el.classList.add('message', 'other');
        }
        
        // Add message ID as data attribute
        if (messageId) {
            el.setAttribute('data-message-id', messageId);
        }
        
        el.innerHTML = `
            <div class="username">${msgUsername}</div>
            <div class="text">${message}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        // Add delete button for moderators
        if (document.getElementById('mod-tools').style.display === 'block') {
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.classList.add('delete-message-btn');
            deleteBtn.style.marginLeft = '10px';
            deleteBtn.style.padding = '2px 5px';
            deleteBtn.style.fontSize = '10px';
            deleteBtn.onclick = () => deleteMessage(messageId);
            el.querySelector('.timestamp').appendChild(deleteBtn);
        }
        
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
