document.addEventListener('DOMContentLoaded', function() {
    const SERVER_URL = 'https://multiplayer-6vlc.onrender.com';
    let username = '';
    let clientId = null;
    let lastUpdateTime = Date.now();
    let cryptoKey = null;
    let isLeaving = false;
    let modActivationAttempted = false;
    let isModerator = false; // Track if current user is a moderator

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
                isModerator = true;
                addSystemMessage('You are now a moderator!');
                // Refresh the user list to show kick buttons
                fetch(`${SERVER_URL}/api/active-users`)
                    .then(res => res.json())
                    .then(data => updateUserList(data.users))
                    .catch(err => console.error('Error fetching users:', err));
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
                
                // Update user list in sidebar
                updateUserList(data.users);
                
                // Decrypt and display previous messages
                if (data.messages) {
                    for (const m of data.messages) {
                        const decryptedUsername = await decryptText(m.username);
                        const decryptedMessage = await decryptText(m.message);
                        addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id);
                    }
                }
                
                startPolling();
                startUserListRefresh();
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

    function startUserListRefresh() {
        setInterval(() => {
            if (clientId) {
                fetch(`${SERVER_URL}/api/active-users`)
                    .then(res => res.json())
                    .then(data => updateUserList(data.users))
                    .catch(err => console.error('Error fetching users:', err));
            }
        }, 10000); // Refresh every 10 seconds
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
                // data is an array of user objects from server
                document.getElementById('users-online').textContent = `${data.length} users online`;
                // update the sidebar user list
                updateUserList(data);
                break;
            }
            case 'mod_status':
                if (data.isMod) {
                    isModerator = true;
                    addSystemMessage('You are now a moderator!');
                    // Add delete buttons to all existing messages
                    addDeleteButtonsToAllMessages();
                    // Refresh the user list to show kick buttons
                    fetch(`${SERVER_URL}/api/active-users`)
                        .then(res => res.json())
                        .then(data => updateUserList(data.users))
                        .catch(err => console.error('Error fetching users:', err));
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
    
    async function updateUserList(usersArray) {
        const usersListEl = document.getElementById('users-list');
        const usersCountEl = document.getElementById('users-count');
        
        if (!usersListEl || !usersCountEl) return;

        // Update user count
        usersCountEl.textContent = usersArray.length;
        
        // Clear current list
        usersListEl.innerHTML = '';
        
        // Add each user to the list
        for (const user of usersArray) {
            let displayName = user.username;
            try {
                displayName = await decryptText(displayName);
            } catch (e) {
                console.warn('Failed to decrypt username, using raw value', e);
            }
            
            const userItem = document.createElement('div');
            userItem.classList.add('user-item');
            
            const nameContainer = document.createElement('div');
            nameContainer.classList.add('user-name');
            nameContainer.textContent = displayName;
            
            if (user.isMod) {
                const modBadge = document.createElement('span');
                modBadge.classList.add('user-mod');
                modBadge.textContent = ' (M)';
                nameContainer.appendChild(modBadge);
            }
            
            userItem.appendChild(nameContainer);
            
            // Add kick button for moderators only
            if (isModerator && displayName !== username) {
                const kickBtn = document.createElement('button');
                kickBtn.classList.add('kick-btn');
                kickBtn.title = `Kick ${displayName}`;
                kickBtn.innerHTML = '×';
                kickBtn.onclick = (e) => {
                    e.stopPropagation();
                    kickUser(user.username);
                };
                userItem.appendChild(kickBtn);
            }
            
            usersListEl.appendChild(userItem);
        }
    }
    
    async function kickUser(username) {
        if (!confirm(`Are you sure you want to kick this user?`)) return;
        
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

    function addMessage(username, message, timestamp, messageId) {
        // Check if message element already exists
        const existingMessage = document.querySelector(`[data-message-id="${messageId}"]`);
        if (existingMessage) {
            // If message already exists, just update the delete button if needed
            if (isModerator) {
                // Add delete button if it doesn't exist
                if (!existingMessage.querySelector('.delete-btn')) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.classList.add('delete-btn');
                    deleteBtn.title = 'Delete message';
                    deleteBtn.innerHTML = '×';
                    deleteBtn.onclick = () => deleteMessage(messageId);
                    
                    const messageHeader = existingMessage.querySelector('.message-header');
                    if (messageHeader) {
                        messageHeader.appendChild(deleteBtn);
                    }
                }
            }
            return; // Message already exists, no need to create a new one
        }
        
        const messageEl = document.createElement('div');
        messageEl.classList.add('message');
        messageEl.dataset.messageId = messageId;
        
        const time = new Date(timestamp).toLocaleTimeString();
        messageEl.innerHTML = `
            <div class="message-header">
                <span class="message-username">${escapeHtml(username)}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${escapeHtml(message)}</div>
        `;
        
        // Add delete button for moderators
        if (isModerator) {
            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('delete-btn');
            deleteBtn.title = 'Delete message';
            deleteBtn.innerHTML = '×';
            deleteBtn.onclick = () => deleteMessage(messageId);
            messageEl.querySelector('.message-header').appendChild(deleteBtn);
        }
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    function addDeleteButtonsToAllMessages() {
        const allMessages = document.querySelectorAll('.message');
        allMessages.forEach(messageEl => {
            const messageId = messageEl.dataset.messageId;
            // Only add delete button if it doesn't already exist
            if (messageId && !messageEl.querySelector('.delete-btn')) {
                const deleteBtn = document.createElement('button');
                deleteBtn.classList.add('delete-btn');
                deleteBtn.title = 'Delete message';
                deleteBtn.innerHTML = '×';
                deleteBtn.onclick = () => deleteMessage(messageId);
                
                const messageHeader = messageEl.querySelector('.message-header');
                if (messageHeader) {
                    messageHeader.appendChild(deleteBtn);
                }
            }
        });
    }
    function addSystemMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.classList.add('message', 'system-message');
        messageEl.innerHTML = `<div class="message-content">${escapeHtml(message)}</div>`;
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
