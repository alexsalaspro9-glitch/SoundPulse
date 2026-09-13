let currentUser = null;
let socket = io();
let activePlaylistId = null;
let currentChatFriend = null;

// FORMATEADOR DE NÚMEROS (12 -> 12, 1200 -> 1.2k, 1000000 -> 1M)
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

// AUTENTICACIÓN
async function handleAuth(type) {
    const username = document.getElementById('auth-user').value;
    const password = document.getElementById('auth-pass').value;
    const errorEl = document.getElementById('auth-error');

    if (!username || !password) {
        errorEl.innerText = "Completa todos los campos";
        return;
    }

    try {
        const res = await fetch(`/api/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
            currentUser = data.username;
            document.getElementById('auth-screen').classList.remove('active');
            document.getElementById('app-screen').classList.add('active');
            document.getElementById('profile-username').innerText = `@${currentUser}`;
            if(data.avatar) document.getElementById('profile-avatar-img').src = data.avatar;

            socket.emit('join_chat', { username: currentUser });
            loadPlaylists();
            loadFeed();
        } else {
            errorEl.innerText = data.error || 'Error en la solicitud';
        }
    } catch (err) {
        errorEl.innerText = "Error de conexión con el servidor";
    }
}

function logout() {
    location.reload();
}

// NAVEGACIÓN DE PESTAÑAS
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    const titles = {
        playlists: 'PLAYLISTS',
        feed: 'PARA TI',
        myposts: 'MIS POSTS',
        search: 'BUSCADOR',
        inbox: 'INBOX',
        profile: 'MI PERFIL'
    };
    document.getElementById('top-title').innerText = titles[tabId] || 'SOUNDPULSE';
    document.getElementById('side-menu').classList.remove('open');

    if (tabId === 'playlists') loadPlaylists();
    if (tabId === 'feed') loadFeed();
    if (tabId === 'myposts') loadMyPosts();
    if (tabId === 'inbox') loadInbox();
}

function toggleSideMenu() {
    document.getElementById('side-menu').classList.toggle('open');
}

// ==========================================
// SECCIÓN PLAYLISTS Y REPRODUCCIÓN
// ==========================================

async function loadPlaylists() {
    const res = await fetch(`/api/playlists/${currentUser}`);
    const data = await res.json();
    const container = document.getElementById('playlists-list');
    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<p style="color:#888; text-align:center; margin-top:20px;">No tienes playlists. ¡Crea una con el botón 🎵+ arriba!</p>';
        return;
    }

    data.forEach(pl => {
        const div = document.createElement('div');
        div.className = 'playlist-card';
        div.innerHTML = `
            <div class="playlist-cover-square" style="background-color: ${pl.coverColor}">${pl.name.substring(0, 2).toUpperCase()}</div>
            <div class="playlist-info">
                <h4>${pl.name}</h4>
                <p>by ${currentUser} • ${pl.songs.length}/20 canciones</p>
            </div>
        `;
        div.onclick = () => openPlaylistDetail(pl);
        container.appendChild(div);
    });
}

function openPlaylistDetail(pl) {
    activePlaylistId = pl.id;
    const container = document.getElementById('playlists-list');
    
    let html = `
        <button class="btn-secondary" onclick="loadPlaylists()">← Volver a Playlists</button>
        <div style="margin: 15px 0; display:flex; align-items:center;">
            <div class="playlist-cover-square" style="background-color:${pl.coverColor}">${pl.name.substring(0, 2).toUpperCase()}</div>
            <div>
                <h3>${pl.name}</h3>
                <p style="color:#aaa;">${pl.songs.length} / 20 canciones guardadas</p>
            </div>
        </div>
        <button class="btn-primary" onclick="openAddSongModal()" style="margin-bottom:15px;">+ Añadir Canción (URL YouTube/MP3)</button>
    `;

    pl.songs.forEach(song => {
        html += `
            <div class="song-list-item" onclick="playSong('${song.title}', '${song.artist}', '${song.url}', '${song.youtubeId}', '${song.coverColor}')">
                <div class="playlist-cover-square" style="background-color:${song.coverColor}; width:40px; height:40px; font-size:0.8em; margin-right:10px;">♪</div>
                <div>
                    <strong>${song.title}</strong>
                    <div style="font-size:0.8em; color:#aaa;">${song.artist}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function playSong(title, artist, url, youtubeId, coverColor) {
    document.getElementById('player-title').innerText = title;
    document.getElementById('player-artist').innerText = artist;
    document.getElementById('player-cover').style.backgroundColor = coverColor || '#ff2a5f';

    const engine = document.getElementById('media-engine');
    if (youtubeId) {
        engine.innerHTML = `<iframe width="100" height="100" src="https://www.youtube.com/embed/${youtubeId}?autoplay=1" allow="autoplay"></iframe>`;
    } else {
        engine.innerHTML = `<audio src="${url}" autoplay controls></audio>`;
    }
}

// ==========================================
// FEED Y MIS POSTS
// ==========================================

async function loadFeed() {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    renderPosts(posts, 'feed-container');
}

async function loadMyPosts() {
    const res = await fetch(`/api/posts/user/${currentUser}`);
    const posts = await res.json();
    renderPosts(posts, 'myposts-container');
}

function renderPosts(posts, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    posts.forEach(p => {
        const countText = formatNumber(p.comments ? p.comments.length : 0);
        const card = document.createElement('div');
        card.className = 'post-card';
        card.innerHTML = `
            <div class="post-header">
                <img src="${p.avatar || '/uploads/default-avatar.png'}" class="post-avatar">
                <strong>@${p.username}</strong>
            </div>
            <h4>${p.title}</h4>
            <p style="font-size:0.9em; color:#ccc; margin-bottom:10px;">${p.description}</p>
            ${p.isYoutube ? `<iframe width="100%" height="200" src="https://www.youtube.com/embed/${p.youtubeId}"></iframe>` : `<video src="${p.mediaUrl}" controls width="100%"></video>`}
            <div class="comments-count" id="comment-count-${p.id}">💬 ${countText} comentarios</div>
            <div style="margin-top:10px; display:flex;">
                <input type="text" id="input-comment-${p.id}" placeholder="Escribe un comentario..." style="padding:6px; flex:1; background:#222; border:1px solid #333; color:#fff; border-radius:4px;">
                <button onclick="sendComment('${p.id}')" style="padding:6px 12px; background:#ff2a5f; border:none; color:#fff; border-radius:4px; margin-left:5px;">Publicar</button>
            </div>
        `;
        container.appendChild(card);
    });
}

async function sendComment(postId) {
    const input = document.getElementById(`input-comment-${postId}`);
    const text = input.value.trim();
    if (!text) return;

    const res = await fetch(`/api/posts/${postId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, text })
    });
    const data = await res.json();
    if (res.ok) {
        document.getElementById(`comment-count-${postId}`).innerText = `💬 ${formatNumber(data.commentsCount)} comentarios`;
        input.value = '';
    }
}

// ==========================================
// BUSCADOR Y SEGUIMIENTO MUTUO
// ==========================================

async function searchUsers() {
    const query = document.getElementById('search-input').value;
    if (!query) {
        document.getElementById('search-results').innerHTML = '';
        return;
    }

    const res = await fetch(`/api/users/search?q=${query}`);
    const usersList = await res.json();
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    usersList.forEach(u => {
        const item = document.createElement('div');
        item.style = "display:flex; align-items:center; justify-content:space-between; padding:10px; background:#181818; margin-bottom:5px; border-radius:6px;";
        item.innerHTML = `
            <div style="display:flex; align-items:center;">
                <img src="${u.avatar}" style="width:40px; height:40px; border-radius:50%; margin-right:10px; object-fit:cover;">
                <strong>@${u.username} ${u.username === currentUser ? '(Tú)' : ''}</strong>
            </div>
            ${u.username !== currentUser ? `<button onclick="followUser('${u.username}')" class="btn-primary" style="width:auto; padding:6px 12px;">Seguir</button>` : ''}
        `;
        container.appendChild(item);
    });
}

async function followUser(targetUser) {
    const res = await fetch('/api/user/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentUser, targetUser })
    });
    const data = await res.json();
    alert(data.isFollowing ? `Ahora sigues a @${targetUser}` : `Dejaste de seguir a @${targetUser}`);
}

// ==========================================
// INBOX Y CHAT
// ==========================================

async function loadInbox() {
    const res = await fetch(`/api/inbox/friends/${currentUser}`);
    const friends = await res.json();
    const list = document.getElementById('friends-list');
    list.innerHTML = '';

    if (friends.length === 0) {
        list.innerHTML = '<p style="color:#888;">Para chatear, ambos usuarios deben seguirse mutuamente.</p>';
        return;
    }

    friends.forEach(f => {
        const div = document.createElement('div');
        div.style = "display:flex; align-items:center; padding:10px; background:#181818; margin-bottom:8px; border-radius:6px; cursor:pointer;";
        div.innerHTML = `
            <img src="${f.avatar}" style="width:35px; height:35px; border-radius:50%; margin-right:10px; object-fit:cover;">
            <strong>@${f.username}</strong>
        `;
        div.onclick = () => openChat(f.username);
        list.appendChild(div);
    });
}

function openChat(username) {
    currentChatFriend = username;
    document.getElementById('chat-with-user').innerText = `@${username}`;
    document.getElementById('chat-box').classList.remove('hidden');
}

function closeChat() {
    document.getElementById('chat-box').classList.add('hidden');
    currentChatFriend = null;
}

function sendPrivateMsg() {
    const input = document.getElementById('chat-msg-input');
    const text = input.value.trim();
    if (!text || !currentChatFriend) return;

    socket.emit('send_private_msg', { from: currentUser, to: currentChatFriend, text });
    appendChatMsg(currentUser, text);
    input.value = '';
}

socket.on('receive_private_msg', (data) => {
    if (data.from === currentChatFriend) {
        appendChatMsg(data.from, data.text);
    }
});

function appendChatMsg(sender, text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.style = `margin: 5px 0; text-align: ${sender === currentUser ? 'right' : 'left'};`;
    div.innerHTML = `<span style="background:${sender === currentUser ? '#ff2a5f' : '#333'}; padding:6px 10px; border-radius:10px; display:inline-block;">${text}</span>`;
    container.appendChild(div);
}

// ==========================================
// FOTO DE PERFIL
// ==========================================

function triggerAvatarUpload() {
    document.getElementById('avatar-file-input').click();
}

async function uploadAvatar(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', currentUser);

    const res = await fetch('/api/user/avatar', {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (res.ok) {
        document.getElementById('profile-avatar-img').src = data.avatar;
    }
}

// ==========================================
// MODALES Y ACCIONES
// ==========================================

function openCreatePlaylistModal() { document.getElementById('modal-playlist').style.display = 'flex'; }
function openAddSongModal() { document.getElementById('modal-add-song').style.display = 'flex'; }
function openUploadModal() { document.getElementById('modal-upload').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function createPlaylist() {
    const name = document.getElementById('pl-name-input').value;
    const coverColor = document.getElementById('pl-color-input').value;

    const res = await fetch('/api/playlists/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, name, coverColor })
    });

    if (res.ok) {
        closeModal('modal-playlist');
        loadPlaylists();
    }
}

async function addSongToPlaylist() {
    const title = document.getElementById('song-title-input').value;
    const artist = document.getElementById('song-artist-input').value;
    const url = document.getElementById('song-url-input').value;
    const coverColor = document.getElementById('song-color-input').value;

    const res = await fetch('/api/playlists/add-song', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, playlistId: activePlaylistId, title, artist, url, coverColor })
    });
    const data = await res.json();

    if (res.ok) {
        closeModal('modal-add-song');
        openPlaylistDetail(data.playlist);
    } else {
        alert(data.error);
    }
}

async function submitPost() {
    const title = document.getElementById('post-title-input').value;
    const description = document.getElementById('post-desc-input').value;
    const youtubeUrl = document.getElementById('post-yt-input').value;
    const file = document.getElementById('post-file-input').files[0];

    const formData = new FormData();
    formData.append('username', currentUser);
    formData.append('title', title);
    formData.append('description', description);
    if (youtubeUrl) formData.append('youtubeUrl', youtubeUrl);
    if (file) formData.append('media', file);

    const res = await fetch('/api/posts/create', {
        method: 'POST',
        body: formData
    });

    if (res.ok) {
        closeModal('modal-upload');
        loadMyPosts();
    }
}