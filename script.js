document.addEventListener('DOMContentLoaded', function() {
    const SERVER_URL = 'https://multiplayer-6vlc.onrender.com';
    let username = '';
    let clientId = null;
    let lastUpdateTime = Date.now();
    let cryptoKey = null;
    let isLeaving = false;
    let modActivationAttempted = false;
    let isModerator = false; // Track if current user is a moderator
    let serverActivationAttempted = false;

    // DM functionality variables
    let currentChannel = 'global';
    let dmChannels = new Map(); // Map of DM channels: key = otherUserId, value = { messages: [], username: '' }
    let globalMessages = []; // Store global messages separately

    // Initialize encryption
    initializeEncryption();

    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const usernameInput = document.getElementById('username-input');
    const joinButton = document.getElementById('join-button');
    const usernameSetup = document.getElementById('username-setup');
    const chatContainer = document.querySelector('.chat-container');
    const serverActivation = document.getElementById('server-activation');
    const serverPasswordInput = document.getElementById('server-password-input');
    const serverActivateBtn = document.getElementById('server-activate-btn');
    const serverCancelBtn = document.getElementById('server-cancel-btn');
    const serverStatus = document.getElementById('server-status');

    // Channel toggle buttons for mobile
    const channelToggle = document.createElement('button');
    channelToggle.classList.add('channel-toggle');
    channelToggle.innerHTML = '≡';
    channelToggle.style.display = 'none';
    
    const usersToggle = document.createElement('button');
    usersToggle.classList.add('users-toggle');
    usersToggle.innerHTML = '👥';
    usersToggle.style.display = 'none';
    
    document.body.appendChild(channelToggle);
    document.body.appendChild(usersToggle);

    chatContainer.style.display = 'none';
    addSystemMessage("All messages are encrypted end-to-end");

    joinButton.addEventListener('click', joinChat);
    usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') joinChat(); });
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
    messageInput.addEventListener('input', handleMessageInput);

    serverActivateBtn.addEventListener('click', activateServer);
    serverCancelBtn.addEventListener('click', () => {
        serverActivation.style.display = 'none';
        serverActivationAttempted = false;
    });
    serverPasswordInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') activateServer();
    });

    // Channel toggle functionality
    const channelsSidebar = document.querySelector('.channels-sidebar');
    const usersSidebar = document.querySelector('.users-sidebar');
    
    channelToggle.addEventListener('click', () => {
        channelsSidebar.classList.toggle('visible');
    });
    
    usersToggle.addEventListener('click', () => {
        usersSidebar.classList.toggle('visible');
    });
    
    // Global channel click handler
    document.querySelector('[data-channel="global"]').addEventListener('click', () => {
        switchChannel('global', 'Global Chat', false);
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
    
    // Check screen size for mobile view
    function checkScreenSize() {
        if (window.innerWidth <= 900) {
            channelToggle.style.display = 'flex';
            usersToggle.style.display = 'flex';
        } else {
            channelToggle.style.display = 'none';
            usersToggle.style.display = 'none';
            channelsSidebar.classList.remove('visible');
            usersSidebar.classList.remove('visible');
        }
    }
    
    // Initial check and resize listener
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);

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
        
        // Check for moderator commands
        if (isModerator && msg.startsWith('/')) {
            if (msg.startsWith('/clear')) {
                e.preventDefault();
                messageInput.value = '';
                clearAllMessages();
            } else if (msg.startsWith('/kickall')) {
                e.preventDefault();
                messageInput.value = '';
                kickAllUsers();
            } else if (msg.startsWith('/s ')) {
                // Don't prevent default here - let the Enter key send the message
                // We'll handle this in the sendMessage function instead
            }
        }
    }
    async function clearAllMessages() {
        try {
            const response = await fetch(`${SERVER_URL}/api/clear-messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId })
            });
            
            const data = await response.json();
            if (data.success) {
                // Clear messages from UI
                messagesContainer.innerHTML = '';
                globalMessages = [];
                // Don't show any system message (silent cleanup)
            } else {
                alert('Failed to clear messages');
            }
        } catch (error) {
            console.error('Clear messages error:', error);
            alert('Error clearing messages');
        }
    }

    async function kickAllUsers() {
        if (!confirm('Are you sure you want to kick ALL users?')) return;
        
        try {
            const response = await fetch(`${SERVER_URL}/api/kick-all-users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId })
            });
            
            const data = await response.json();
            if (data.success) {
                addSystemMessage('All users have been kicked');
            } else {
                alert('Failed to kick all users');
            }
        } catch (error) {
            console.error('Kick all users error:', error);
            alert('Error kicking all users');
        }
    }

    async function sendServerMessage(message) {
        console.log('Sending server message:', { clientId, message, isModerator });
        
        // Double check that we have a valid clientId and moderator status
        if (!clientId) {
            alert('Not connected to server. Please refresh and try again.');
            return;
        }
        
        if (!isModerator) {
            alert('You are not a moderator. Cannot send server messages.');
            return;
        }

        try {
            const response = await fetch(`${SERVER_URL}/api/server-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    clientId: clientId, 
                    message: message 
                })
            });
            
            console.log('Server response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                
                if (response.status === 403) {
                    alert('You are no longer a moderator. Please refresh the page.');
                } else if (response.status === 400) {
                    alert('Invalid request. Please check your connection and try again.');
                } else {
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
                return;
            }
            
            const data = await response.json();
            console.log('Server response data:', data);
            
            if (!data.success) {
                alert('Failed to send server message: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Server message error:', error);
            alert('Error sending server message: ' + error.message);
        }
    }

    async function joinChat() {
        username = usernameInput.value.trim();
        if (!username) return alert('Enter a username');
        
        // First check server status
        try {
            const statusResponse = await fetch(`${SERVER_URL}/api/status`);
            const statusData = await statusResponse.json();
            
            // Show server status to all users regardless of activation state
            updateServerStatusDisplay(statusData.active);
            
            if (!statusData.active) {
                showServerActivation();
                return;
            } else {
                // SERVER IS ACTIVE! Proceed to join.
                await proceedWithJoin();
            }
        } catch (error) {
            console.error('Status check error:', error);
            addSystemMessage("Unable to connect to server");
            // Show server as inactive on error
            updateServerStatusDisplay(false);
            return;
        }
    }

    // Add function to update server status display for all users
    function updateServerStatusDisplay(isActive) {
        serverStatus.style.display = 'block';
        if (isActive) {
            serverStatus.textContent = 'Server Active';
            serverStatus.style.background = '#48bb78';
        } else {
            serverStatus.textContent = 'Server Inactive';
            serverStatus.style.background = '#e53e3e';
        }
    }
    // Extract the joining logic from joinChat into a separate function
    async function proceedWithJoin() {
        // If we already became mod during activation, don’t call /api/join again
        if (isModerator && clientId) {
            usernameSetup.style.display = 'none';
            chatContainer.style.display = 'flex';
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.focus();
            addSystemMessage(`Moderator session active`);

            // Fetch active users + recent messages so the mod sees context
            try {
                const statusRes = await fetch(`${SERVER_URL}/api/active-users`);
                const statusData = await statusRes.json();
                updateUserList(statusData.users);
                document.getElementById('users-online').textContent = `${statusData.users.length} users online`;
            } catch (e) {
                console.error("Failed to fetch active users:", e);
            }

            try {
                const msgsRes = await fetch(`${SERVER_URL}/api/status`);
                const msgsData = await msgsRes.json();
                if (msgsData && msgsData.messages) {
                    globalMessages = msgsData.messages;
                    for (const m of msgsData.messages) {
                        const decryptedUsername = await decryptText(m.username);
                        const decryptedMessage = await decryptText(m.message);
                        addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id, false);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch messages:", e);
            }

            startPolling();
            startUserListRefresh();
            return;
        }

        // --- Normal join flow for regular users ---
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
                
                document.getElementById('users-online').textContent = `${data.users.length} users online`;
                updateUserList(data.users);

                if (data.messages) {
                    globalMessages = data.messages;
                    for (const m of data.messages) {
                        const decryptedUsername = await decryptText(m.username);
                        const decryptedMessage = await decryptText(m.message);
                        addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id, false);
                    }
                }

                startPolling();
                startUserListRefresh();
            } else {
                alert('Failed to join: ' + data.error);
            }
        })
        .catch(err => console.error('Join error:', err));
    }

    async function activateServer() {
    const password = serverPasswordInput.value;
    if (!password) return;

    try {
        const response = await fetch(`${SERVER_URL}/api/activate-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        if (data.success) {
        serverActivation.style.display = 'none';
        updateServerStatusDisplay(true); // Use the new function
        
        // If we got a clientId, store it and proceed with join
        if (data.clientId) {
            clientId = data.clientId;
            isModerator = data.isMod;
            proceedWithJoin();
        }
        } else {
        alert('Invalid activation password');
        serverPasswordInput.value = '';
        serverPasswordInput.focus();
        }
    } catch (error) {
        console.error('Server activation error:', error);
        alert('Error activating server');
    }
    }

    function showServerActivation() {
        serverActivationAttempted = true;
        serverActivation.style.display = 'block';
        serverPasswordInput.focus();
    }

    async function sendMessage() {
        const msg = messageInput.value.trim();
        if (!msg) return;
        
        // Check if this is a server message command
        if (isModerator && msg.startsWith('/s ')) {
            const serverMessage = msg.substring(3).trim();
            if (serverMessage) {
                messageInput.value = '';
                sendServerMessage(serverMessage);
            } else {
                addSystemMessage('Server message cannot be empty');
            }
            return;
        }
        
        // Encrypt the message before sending for normal messages
        let encryptedMessage = msg;
        if (cryptoKey) {
            encryptedMessage = "ENCRYPTED:" + await encryptText(msg);
        }
        
        if (currentChannel === 'global') {
            // Send to global chat
            fetch(`${SERVER_URL}/api/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, message: encryptedMessage })
            }).then(() => messageInput.value = '');
        } else if (dmChannels.has(currentChannel)) {
            // Send DM
            fetch(`${SERVER_URL}/api/send-dm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    clientId, 
                    targetClientId: currentChannel, 
                    message: encryptedMessage 
                })
            }).then(() => messageInput.value = '');
        }
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
            case 'server_activated':
                updateServerStatusDisplay(true); // Use the new function
                addSystemMessage('Server has been activated');
                break;
            case 'server_deactivated':
                updateServerStatusDisplay(false); // Use the new function
                addSystemMessage('Server has been deactivated. Please refresh.');
                // Disable chat functionality
                messageInput.disabled = true;
                sendButton.disabled = true;
                break;
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
                // Server messages don't need decryption
                let decryptedUsername, decryptedMessage;
                
                if (data.username === "SERVER") {
                    decryptedUsername = "SERVER";
                    decryptedMessage = data.message; // Server messages aren't encrypted
                } else {
                    decryptedUsername = await decryptText(data.username);
                    decryptedMessage = await decryptText(data.message);
                }
                
                // Store in global messages
                globalMessages.push(data);
                addMessage(decryptedUsername, decryptedMessage, data.timestamp, data.id, false); 
                break;
            case 'receive_dm':
                const dmSenderUsername = await decryptText(data.senderUsername);
                const dmMessage = await decryptText(data.message);
                
                // Store the DM message
                if (!dmChannels.has(data.senderId)) {
                    createDMChannel(data.senderId, dmSenderUsername);
                }
                
                const dmChannel = dmChannels.get(data.senderId);
                dmChannel.messages.push({
                    id: data.id,
                    username: dmSenderUsername,
                    message: dmMessage,
                    timestamp: data.timestamp
                });
                
                // If we're currently viewing this DM channel, display the message
                if (currentChannel === data.senderId) {
                    addMessage(dmSenderUsername, dmMessage, data.timestamp, data.id, true);
                } else {
                    // Show notification for new DM
                    const channelItem = document.querySelector(`[data-channel="${data.senderId}"]`);
                    if (channelItem) {
                        channelItem.classList.add('has-notification');
                    }
                }
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
            case "kicked":
                addSystemMessage("You have been kicked from the chat.");
                setTimeout(() => {
                    window.location.href = "kicked.html"; // redirect
                }, 1500);
                break;

            case 'message_deleted':
                // Find and remove the message from UI
                const messageEl = document.querySelector(`[data-message-id="${data}"]`);
                if (messageEl) {
                    messageEl.remove();
                    addSystemMessage('A message was deleted by a moderator');
                }
                break;
            case 'messages_cleared':
                // Clear all messages from UI
                messagesContainer.innerHTML = '';
                globalMessages = [];
                // No system message (silent cleanup)
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
            
            // Add DM button for each user (except yourself)
            if (user.clientId !== clientId) {
                const dmBtn = document.createElement('button');
                dmBtn.classList.add('dm-btn');
                dmBtn.title = `Message ${displayName}`;
                dmBtn.innerHTML = '✉️';
                dmBtn.onclick = (e) => {
                    e.stopPropagation();
                    createDMChannel(user.clientId, displayName);
                    switchChannel(user.clientId, displayName, true);
                };
                userItem.appendChild(dmBtn);
            }
            
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
    
    // Channel switching function
    function switchChannel(channelId, channelName, isDM = false) {
        currentChannel = channelId;
        document.getElementById('current-channel').textContent = isDM ? `DM with ${channelName}` : 'Global Chat';
        
        // Update active channel in UI
        document.querySelectorAll('.channel-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-channel="${channelId}"]`).classList.add('active');
        
        // Clear notification if any
        document.querySelector(`[data-channel="${channelId}"]`).classList.remove('has-notification');
        
        // Clear messages and load appropriate ones
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';
        
        if (isDM) {
            // Load DM messages
            const dmChannel = dmChannels.get(channelId);
            if (dmChannel && dmChannel.messages) {
                dmChannel.messages.forEach(msg => {
                    addMessage(msg.username, msg.message, msg.timestamp, msg.id, true);
                });
            }
        } else {
            // Load global messages
            globalMessages.forEach(msg => {
                addMessage(msg.username, msg.message, msg.timestamp, msg.id, false);
            });
        }
    }
    
    // Function to create a DM channel
    function createDMChannel(userId, username) {
        if (!dmChannels.has(userId)) {
            dmChannels.set(userId, {
                username: username,
                messages: []
            });
            
            // Add to UI
            const dmChannelsContainer = document.getElementById('dm-channels');
            const dmChannelItem = document.createElement('div');
            dmChannelItem.classList.add('channel-item', 'dm-channel');
            dmChannelItem.dataset.channel = userId;
            dmChannelItem.dataset.isDm = 'true';
            dmChannelItem.innerHTML = `
                <span class="channel-icon">@</span>
                <span class="channel-name">${username}</span>
            `;
            
            dmChannelItem.addEventListener('click', () => {
                switchChannel(userId, username, true);
            });
            
            dmChannelsContainer.appendChild(dmChannelItem);
        }
    }

function addMessage(username, message, timestamp, messageId, isDM) {
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
    
    // Add DM indicator for direct messages
    if (isDM) {
        messageEl.classList.add('dm-message');
    }
    
    // Add special styling for server messages
    if (username === "SERVER") {
        messageEl.classList.add('server-message');
    }
    
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
