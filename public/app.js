const socket = io();
let currentUser = null;
let isPCMode = false;
let currentUploadType = 'file';
let tracksData = [];
let playlistsData = {};
let likedTracks = new Set();
let currentActiveTrackForComments = null;

const audioElement = document.getElementById('audio-element');

// LOGIN Y REGISTRO
async function handleAuth(type) {
    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value.trim();
    const errorMsg = document.getElementById('auth-error');

    if (!username || !password) {
        errorMsg.innerText = "Ingresa usuario y contraseña";
        return;
    }

    try {
        const res = await fetch(`/api/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        if (!res.ok) {
            errorMsg.innerText = data.error || "Error al autenticar";
            return;
        }

        currentUser = data.username;
        document.getElementById('profile-username').innerText = `@${currentUser}`;
        document.getElementById('profile-initial').innerText = currentUser.charAt(0).toUpperCase();

        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');

        socket.emit('join_room', { username: currentUser });
        loadFeed();

    } catch (e) {
        errorMsg.innerText = "Error de conexión con el servidor";
    }
}

// NAVEGACIÓN VISTAS
function navTo(viewName, btn) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`view-${viewName}`).classList.add('active');
    if (btn) btn.classList.add('active');

    if (viewName === 'profile') renderProfileGrid('playlists');
}

// CARGAR FEED DE TRACKS
async function loadFeed() {
    try {
        const res = await fetch('/api/tracks');
        tracksData = await res.json();
        const container = document.getElementById('feed-container');

        if (tracksData.length === 0) {
            document.getElementById('empty-feed').style.display = 'flex';
            return;
        }

        document.getElementById('empty-feed').style.display = 'none';
        container.innerHTML = '';

        tracksData.forEach(track => {
            const item = document.createElement('div');
            item.className = 'feed-item';

            item.innerHTML = `
                <div class="feed-overlay">
                    <div class="feed-user">@${track.artist}</div>
                    <div class="feed-title">${track.title}</div>
                </div>
                <div class="feed-actions-right">
                    <button class="action-btn ${likedTracks.has(track.id) ? 'liked' : ''}" onclick="likeTrack('${track.id}', this)">
                        <div class="action-icon">♥</div>
                        <span>${track.likes || 0}</span>
                    </button>
                    <button class="action-btn" onclick="openCommentsModal('${track.id}')">
                        <div class="action-icon">💬</div>
                        <span>${(track.comments || []).length}</span>
                    </button>
                    <button class="action-btn" onclick="openPlaylistModal('${track.id}')">
                        <div class="action-icon">+</div>
                        <span>Playlist</span>
                    </button>
                    <button class="action-btn" onclick="triggerPlay('${track.url}', '${track.title}', '${track.artist}')">
                        <div class="action-icon">▶</div>
                        <span>Reproducir</span>
                    </button>
                </div>
            `;
            container.appendChild(item);
        });
    } catch (e) {
        console.error("Error al cargar feed", e);
    }
}

// BÚSQUEDA GLOBAL (HEADER)
function handleGlobalSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    if (e.key === 'Enter' && query) {
        navTo('discover');
        const results = document.getElementById('search-results');
        results.innerHTML = `<p style="padding:10px;">Buscando resultados para <strong>"${query}"</strong>...</p>`;
    }
}

// ANIMACIÓN Y SISTEMA DE LIKE ÚNICO
function likeTrack(trackId, btn) {
    if (likedTracks.has(trackId)) return;
    likedTracks.add(trackId);

    btn.classList.add('liked');
    const span = btn.querySelector('span');
    span.innerText = parseInt(span.innerText) + 1;
}

// PUBLICAR ARCHIVO / YOUTUBE
function openUploadModal() { document.getElementById('upload-modal').style.display = 'flex'; }
function closeUploadModal() { document.getElementById('upload-modal').style.display = 'none'; }

function switchUploadType(type) {
    currentUploadType = type;
    document.getElementById('tab-btn-file').classList.toggle('active', type === 'file');
    document.getElementById('tab-btn-url').classList.toggle('active', type === 'url');
    document.getElementById('input-file-group').style.display = type === 'file' ? 'block' : 'none';
    document.getElementById('input-url-group').style.display = type === 'url' ? 'block' : 'none';
}

async function handlePublish(e) {
    e.preventDefault();
    const title = document.getElementById('up-title').value;
    const artist = document.getElementById('up-artist').value;

    if (currentUploadType === 'file') {
        const formData = new FormData();
        formData.append('title', title);
        formData.append('artist', artist);
        formData.append('audio', document.getElementById('up-file').files[0]);

        await fetch('/api/upload', { method: 'POST', body: formData });
    } else {
        const url = document.getElementById('up-url').value;
        await fetch('/api/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, artist, url })
        });
    }

    closeUploadModal();
    loadFeed();
}

// COMENTARIOS
function openCommentsModal(trackId) {
    currentActiveTrackForComments = trackId;
    document.getElementById('comments-modal').style.display = 'flex';
    renderComments();
}

function closeCommentsModal() {
    document.getElementById('comments-modal').style.display = 'none';
}

function renderComments() {
    const list = document.getElementById('comments-list');
    const track = tracksData.find(t => t.id === currentActiveTrackForComments);
    list.innerHTML = '';

    if (!track || !track.comments || track.comments.length === 0) {
        list.innerHTML = '<p style="color:#666; text-align:center;">Sé el primero en comentar.</p>';
        return;
    }

    track.comments.forEach(c => {
        const div = document.createElement('div');
        div.style.marginBottom = '8px';
        div.innerHTML = `<strong style="color:var(--red-main)">@${c.user}:</strong> <span>${c.text}</span>`;
        list.appendChild(div);
    });
}

async function postComment() {
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text || !currentActiveTrackForComments) return;

    await fetch(`/api/tracks/${currentActiveTrackForComments}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: currentUser, text })
    });

    input.value = '';
    const track = tracksData.find(t => t.id === currentActiveTrackForComments);
    if (track) {
        if (!track.comments) track.comments = [];
        track.comments.push({ user: currentUser, text });
    }
    renderComments();
}

// PLAYLISTS EN PERFIL
function promptCreatePlaylist() {
    const name = prompt("Escribe el nombre de tu nueva Playlist:");
    if (name && name.trim()) {
        playlistsData[name.trim()] = [];
        renderProfileGrid('playlists');
    }
}

function renderProfileGrid(type) {
    const grid = document.getElementById('profile-grid');
    grid.innerHTML = '';

    if (type === 'playlists') {
        const keys = Object.keys(playlistsData);
        if (keys.length === 0) {
            grid.innerHTML = '<p style="grid-column: span 3; text-align:center; padding:20px; color:#666;">Sin Playlists creadas</p>';
            return;
        }
        keys.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'grid-card';
            card.innerText = `📁 ${pl}`;
            grid.appendChild(card);
        });
    }
}

// CONTROLES PC Y SOCKETS
function togglePCMode() {
    isPCMode = !isPCMode;
    const btn = document.getElementById('pc-mode-btn');
    btn.classList.toggle('active', isPCMode);
    btn.innerText = isPCMode ? "PC Mode: ON" : "PC Mode: OFF";
}

function triggerPlay(trackUrl, title, artist) {
    socket.emit('remote_play_track', { username: currentUser, trackUrl, title, artist });
}

socket.on('pc_play_track', (data) => {
    document.getElementById('player-title').innerText = data.title;
    document.getElementById('player-artist').innerText = data.artist;

    if (isPCMode) {
        audioElement.src = data.trackUrl;
        audioElement.play();
    }
});

function controlMedia(action) {
    if (action === 'pause') {
        if (audioElement.paused) audioElement.play();
        else audioElement.pause();
    } else if (action === 'stop') {
        audioElement.pause();
        audioElement.currentTime = 0;
    }
}