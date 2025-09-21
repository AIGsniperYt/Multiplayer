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

    // Room functionality variables
    let currentRoom = 'global';
    let userRooms = []; // Array of room objects user is in

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
        } else if (msg.startsWith('/hide')) {
        e.preventDefault();
        messageInput.value = '';
        toggleVisibility(true);
        } else if (msg.startsWith('/show')) {
        e.preventDefault();
        messageInput.value = '';
        toggleVisibility(false);
        }
    }
    }

    async function toggleVisibility(isHidden) {
    try {
        const response = await fetch(`${SERVER_URL}/api/toggle-visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, isHidden })
        });
        
        const data = await response.json();
        if (data.success) {
        addSystemMessage(`Developer mode ${isHidden ? 'hidden' : 'visible'}`);
        } else {
        alert('Failed to toggle visibility');
        }
    } catch (error) {
        console.error('Toggle visibility error:', error);
        alert('Error toggling visibility');
    }
    }
    async function clearAllMessages() {
        try {
            console.log('Clearing messages for room:', currentRoom, 'clientId:', clientId);
            
            const response = await fetch(`${SERVER_URL}/api/clear-messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, roomId: currentRoom })
            });
            
            console.log('Clear response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Clear error response:', errorText);
                alert('Failed to clear messages: ' + errorText);
                return;
            }
            
            const data = await response.json();
            console.log('Clear response data:', data);
            
            if (data.success) {
                // Clear messages from UI
                messagesContainer.innerHTML = '';
                globalMessages = [];
                // Don't show any system message (silent cleanup)
            } else {
                alert('Failed to clear messages: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Clear messages error:', error);
            alert('Error clearing messages: ' + error.message);
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
        console.log('Sending server message:', { clientId, message, isModerator, currentRoom });
        
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
                    message: message,
                    roomId: currentRoom // Add current room ID
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
            const statusResponse = await fetch(`${SERVER_URL}/api/status`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!statusResponse.ok) {
                throw new Error(`Server returned ${statusResponse.status}`);
            }
            
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
            addSystemMessage("Unable to connect to server. Server may be offline.");
            // Show server as inactive on error
            updateServerStatusDisplay(false);
            return;
        }
    }

    // Add function to update server status display for all users
    function updateServerStatusDisplay(isActive) {
        if (isActive) {
            serverStatus.textContent = 'Server Active';
            serverStatus.style.background = '#48bb78';
        } else {
            serverStatus.textContent = 'Server Inactive';
            serverStatus.style.background = '#e53e3e';
        }
    }
    updateServerStatusDisplay(false);
    // Extract the joining logic from joinChat into a separate function
    async function proceedWithJoin() {
        // If we already became mod during activation, don't call /api/join again
        if (isModerator && clientId) {
            usernameSetup.style.display = 'none';
            chatContainer.style.display = 'flex';
            messageInput.disabled = false;
            sendButton.disabled = false;
            messageInput.focus();
            addSystemMessage(`Moderator session active`);

            // Load user's rooms
            await loadUserRooms();
            
            // Fetch active users + recent messages for current room
            try {
                const usersRes = await fetch(`${SERVER_URL}/api/active-users?roomId=${currentRoom}`);
                const usersData = await usersRes.json();
                updateUserList(usersData.users);
                document.getElementById('users-online').textContent = `${usersData.users.length} users online`;
            } catch (e) {
                console.error("Failed to fetch active users:", e);
            }

            try {
                // Join the current room to get messages
                const joinRes = await fetch(`${SERVER_URL}/api/join-room`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, roomId: currentRoom })
                });
                
                const joinData = await joinRes.json();
                if (joinData.success) {
                    for (const m of joinData.messages) {
                        const decryptedUsername = await decryptText(m.username);
                        const decryptedMessage = await decryptText(m.message);
                        addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id, m.roomId !== 'global');
                    }
                }
            } catch (e) {
                console.error("Failed to fetch messages:", e);
            }

            startPolling();
            startUserListRefresh();
            startRoomListRefresh();
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
                currentRoom = data.currentRoom || 'global';
                usernameSetup.style.display = 'none';
                chatContainer.style.display = 'flex';
                messageInput.disabled = false;
                sendButton.disabled = false;
                messageInput.focus();
                addSystemMessage(`Welcome, ${username}!`);
                
                // Load user's rooms
                await loadUserRooms();
                
                document.getElementById('users-online').textContent = `${data.users.length} users online`;
                updateUserList(data.users);

                if (data.messages) {
                    for (const m of data.messages) {
                        const decryptedUsername = await decryptText(m.username);
                        const decryptedMessage = await decryptText(m.message);
                        addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id, currentRoom !== 'global');
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
    // NEW: Load user's rooms
    async function loadUserRooms() {
        try {
            const response = await fetch(`${SERVER_URL}/api/user-rooms?clientId=${clientId}`);
            const data = await response.json();
            
            if (data.rooms) {
                userRooms = data.rooms;
                updateRoomList();
            }
        } catch (error) {
            console.error('Error loading rooms:', error);
        }
    }
    async function createDMRoom(targetClientId, targetUsername) {
        try {
            // Decrypt the target username if it's encrypted
            let displayName = targetUsername;
            if (targetUsername.startsWith('ENCRYPTED:')) {
                displayName = await decryptText(targetUsername);
            }
            
            const response = await fetch(`${SERVER_URL}/api/create-dm-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, targetClientId })
            });
            
            const data = await response.json();
            if (data.success) {
                // Join the new room using the decrypted name
                await joinRoom(data.room.id, `DM: ${displayName}`, true);
                
                // Reload rooms list
                await loadUserRooms();
            } else {
                alert('Failed to create DM room');
            }
        } catch (error) {
            console.error('Create DM room error:', error);
            alert('Error creating DM room');
        }
    }

    // NEW: Join room
    async function joinRoom(roomId, roomName, isDM = false) {
        try {
            const response = await fetch(`${SERVER_URL}/api/join-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, roomId })
            });
            
            const data = await response.json();
            if (data.success) {
                currentRoom = roomId;
                document.getElementById('current-channel').textContent = roomName;
                
                // Update active room in UI - safely
                document.querySelectorAll('.channel-item').forEach(item => {
                    item.classList.remove('active');
                });
                
                // Find the channel element or create it if it doesn't exist
                let channelElement = document.querySelector(`[data-channel="${roomId}"]`);
                if (channelElement) {
                    channelElement.classList.add('active');
                    channelElement.classList.remove('has-notification');
                }
                
                // Clear messages and load room messages
                const messagesContainer = document.getElementById('messages');
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                }
                
                for (const m of data.messages) {
                    const decryptedUsername = await decryptText(m.username);
                    const decryptedMessage = await decryptText(m.message);
                    addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id, isDM);
                }
                
                // Update user list for this room
                updateUserList(data.users);
                if (document.getElementById('users-online')) {
                    document.getElementById('users-online').textContent = `${data.users.length} users online`;
                }
            }
        } catch (error) {
            console.error('Join room error:', error);
        }
    }

    async function updateRoomList() {
        const dmChannels = document.getElementById('dm-channels');
        if (!dmChannels) return;
        
        dmChannels.innerHTML = '';
        
        for (const room of userRooms) {
            if (room.isDM) {
                try {
                    // Get appropriate display name from server
                    const response = await fetch(`${SERVER_URL}/api/room-display-name?roomId=${room.id}&clientId=${clientId}`);
                    const data = await response.json();
                    
                    let displayName = data.displayName;
                    
                    // Decrypt the display name if it's encrypted
                    if (displayName.startsWith('ENCRYPTED:')) {
                        displayName = await decryptText(displayName);
                    }
                    
                    // Remove "DM: " prefix if present
                    if (displayName.startsWith('DM: ')) {
                        displayName = displayName.substring(4);
                    }
                    
                    const dmChannelItem = document.createElement('div');
                    dmChannelItem.classList.add('channel-item', 'dm-channel');
                    dmChannelItem.dataset.channel = room.id;
                    dmChannelItem.dataset.isDm = 'true';
                    dmChannelItem.innerHTML = `
                        <span class="channel-icon">@</span>
                        <span class="channel-name">${displayName}</span>
                    `;
                    
                    dmChannelItem.addEventListener('click', () => {
                        switchChannel(room.id, `DM: ${displayName}`, true);
                    });
                    
                    dmChannels.appendChild(dmChannelItem);
                    
                } catch (error) {
                    console.error('Error getting room display name:', error);
                    // Fallback to basic display
                    const fallbackName = room.name.replace('DM: ', '');
                    const dmChannelItem = document.createElement('div');
                    dmChannelItem.classList.add('channel-item', 'dm-channel');
                    dmChannelItem.dataset.channel = room.id;
                    dmChannelItem.dataset.isDm = 'true';
                    dmChannelItem.innerHTML = `
                        <span class="channel-icon">@</span>
                        <span class="channel-name">${fallbackName}</span>
                    `;
                    
                    dmChannelItem.addEventListener('click', () => {
                        switchChannel(room.id, `DM: ${fallbackName}`, true);
                    });
                    
                    dmChannels.appendChild(dmChannelItem);
                }
            }
        }
    }

    // Add this function to periodically refresh room list
    function startRoomListRefresh() {
        setInterval(async () => {
            if (clientId) {
                await loadUserRooms();
            }
        }, 3000); // Refresh every 3 seconds
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
        
        // Check for moderator room commands - REMOVE THE 'e' PARAMETER
        if (isModerator && msg.startsWith('/clear')) {
            messageInput.value = '';
            clearAllMessages();
            return;
        } else if (isModerator && msg.startsWith('/kickall')) {
            messageInput.value = '';
            kickAllUsers();
            return;
        }
        
        // Encrypt the message before sending for normal messages
        let encryptedMessage = msg;
        if (cryptoKey) {
            encryptedMessage = "ENCRYPTED:" + await encryptText(msg);
        }
        
        fetch(`${SERVER_URL}/api/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                clientId, 
                message: encryptedMessage, 
                roomId: currentRoom 
            })
        }).then(() => messageInput.value = '');
    }

    // === Proper long polling (no setInterval) ===
    function startPolling() {
        fetchUpdates();
    }

    async function fetchUpdates() {
        try {
            const response = await fetch(`${SERVER_URL}/api/get-updates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, lastUpdate: lastUpdateTime })
            });
            
            if (!response.ok) {
                if (response.status === 403) {
                    // Server not active or user not found
                    addSystemMessage("Disconnected from server. Please refresh.");
                    return;
                }
                throw new Error('Server error');
            }
            
            const data = await response.json();
            if (data.events?.length) {
                for (const e of data.events) {
                    await handleServerEvent(e.event, e.data);
                }
            }
            lastUpdateTime = data.timestamp || Date.now();
            fetchUpdates(); // immediately open next poll
        } catch (err) {
            console.error('Polling error:', err);
            // If we get a network error, retry after delay
            setTimeout(fetchUpdates, 5000); // retry after 5s on error
        }
    }

    function startUserListRefresh() {
        setInterval(async () => {
            if (clientId) {
                try {
                    const response = await fetch(`${SERVER_URL}/api/active-users?roomId=${currentRoom}`);
                    if (!response.ok) {
                        console.error('Failed to fetch users:', response.status);
                        return;
                    }
                    const data = await response.json();
                    updateUserList(data.users);
                } catch (err) {
                    console.error('Error fetching users:', err);
                }
            }
        }, 5000); 
    }
    
    async function handleServerEvent(event, data) {
        switch (event) {
            case 'server_activated':
                updateServerStatusDisplay(true);
                addSystemMessage('Server has been activated');
                break;
            case 'server_deactivated':
                updateServerStatusDisplay(false);
                addSystemMessage('Server has been deactivated. Please refresh.');
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
                // Only show messages for current room
                if (data.roomId === currentRoom) {
                    let decryptedUsername, decryptedMessage;
                    
                    if (data.username === "SERVER") {
                        decryptedUsername = "SERVER";
                        decryptedMessage = data.message;
                    } else {
                        decryptedUsername = await decryptText(data.username);
                        decryptedMessage = await decryptText(data.message);
                    }
                    
                    addMessage(decryptedUsername, decryptedMessage, data.timestamp, data.id, data.roomId !== 'global'); 
                } else {
                    // Mark room as having notifications
                    const channelElement = document.querySelector(`[data-channel="${data.roomId}"]`);
                    if (channelElement && !channelElement.classList.contains('active')) {
                        channelElement.classList.add('has-notification');
                    }
                }
                break;
            case 'users_list': {
                document.getElementById('users-online').textContent = `${data.length} users online`;
                updateUserList(data);
                break;
            }
            case 'mod_status':
                if (data.isMod) {
                    isModerator = true;
                    addSystemMessage('You are now a moderator!');
                    addDeleteButtonsToAllMessages();
                    fetch(`${SERVER_URL}/api/active-users?roomId=${currentRoom}`)
                        .then(res => res.json())
                        .then(data => updateUserList(data.users))
                        .catch(err => console.error('Error fetching users:', err));
                }
                break;
            case "kicked":
                addSystemMessage("You have been kicked from the chat.");
                setTimeout(() => {
                    window.location.href = "kicked.html";
                }, 1500);
                break;
            case 'message_deleted':
                const messageEl = document.querySelector(`[data-message-id="${data}"]`);
                if (messageEl) {
                    messageEl.remove();
                    addSystemMessage('A message was deleted by a moderator');
                }
                break;
            case 'messages_cleared':
                messagesContainer.innerHTML = '';
                break;
            case 'room_created':
                // Reload rooms when a new one is created
                await loadUserRooms();
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
                    createDMRoom(user.clientId, displayName);
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
                body: JSON.stringify({ 
                    clientId, 
                    messageId,
                    roomId: currentRoom // Add current room ID
                })
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
    async function switchChannel(roomId, roomName, isDM = false) {
        try {
            // Decrypt the room name if it's encrypted
            let displayName = roomName;
            if (roomName.startsWith('ENCRYPTED:')) {
                displayName = await decryptText(roomName);
            }
            
            // Remove "DM: " prefix if present
            if (isDM && displayName.startsWith('DM: ')) {
                displayName = displayName.substring(4);
            }
            
            // Update UI to show we're switching channels
            document.getElementById('current-channel').textContent = isDM ? `DM: ${displayName}` : displayName;
            
            // Rest of the function remains the same...
            document.querySelectorAll('.channel-item').forEach(item => {
                item.classList.remove('active');
            });
            
            const channelElement = document.querySelector(`[data-channel="${roomId}"]`);
            if (channelElement) {
                channelElement.classList.add('active');
                channelElement.classList.remove('has-notification');
            }
            
            // Clear messages and load room messages
            const messagesContainer = document.getElementById('messages');
            messagesContainer.innerHTML = '';
            
            // Get messages for this room from the server
            const response = await fetch(`${SERVER_URL}/api/join-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, roomId })
            });
            
            const data = await response.json();
            if (data.success) {
                currentRoom = roomId;
                
                // Display messages for this room
                for (const m of data.messages) {
                    const decryptedUsername = await decryptText(m.username);
                    const decryptedMessage = await decryptText(m.message);
                    addMessage(decryptedUsername, decryptedMessage, m.timestamp, m.id, isDM);
                }
                
                // Update user list for this room
                updateUserList(data.users);
                document.getElementById('users-online').textContent = `${data.users.length} users online`;
            }
        } catch (error) {
            console.error('Switch channel error:', error);
            addSystemMessage('Error switching channel');
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

    function addMessage(username, message, timestamp, messageId, isDM, roomId = currentRoom) {
        // Don't add messages that aren't for the current room
        if (roomId !== currentRoom) {
            // If this message is for a different room, mark that room as having notifications
            if (roomId) {
                const channelElement = document.querySelector(`[data-channel="${roomId}"]`);
                if (channelElement && !channelElement.classList.contains('active')) {
                    channelElement.classList.add('has-notification');
                }
            }
            return; // Skip adding this message to the current view
        }
        
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
