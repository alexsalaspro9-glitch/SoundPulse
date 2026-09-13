const socket = io();
let currentUser = null;
let isPCMode = false;
let currentUploadType = 'file';
let tracksData = [];
let playlistsData = {}; // playlistName -> array of tracks
let likedTracks = new Set();

const audioElement = document.getElementById('audio-element');

// AUTENTICACIÓN
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
            errorMsg.innerText = data.error || "Error de autenticación";
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
        errorMsg.innerText = "Error al conectar con el servidor";
    }
}

// NAVEGACIÓN ENTRE VISTAS
function navTo(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    document.getElementById(`view-${viewName}`).classList.add('active');
    event.currentTarget.classList.add('active');

    if (viewName === 'profile') {
        renderProfileGrid('playlists');
    }
}

function switchFeedTab(tab) {
    document.querySelectorAll('.top-tabs .tab-item').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
}

// CARGAR FEED
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
                    <button class="action-btn" onclick="openPlaylistModal('${track.id}')">
                        <div class="action-icon">+</div>
                        <span>Guardar</span>
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
        console.error("Error al cargar el feed", e);
    }
}

// LIKES ÚNICOS POR PERSONA
function likeTrack(trackId, btn) {
    if (likedTracks.has(trackId)) return; // Solo 1 like por persona
    likedTracks.add(trackId);
    
    btn.classList.add('liked');
    const span = btn.querySelector('span');
    span.innerText = parseInt(span.innerText) + 1;
}

// PLAYLISTS
let currentSelectedTrackForPL = null;

function openPlaylistModal(trackId) {
    currentSelectedTrackForPL = trackId;
    const list = document.getElementById('playlist-options');
    list.innerHTML = '';

    const keys = Object.keys(playlistsData);
    if (keys.length === 0) {
        list.innerHTML = '<p style="font-size:0.8rem; color:#aaa; margin-bottom:10px;">No tienes playlists. Crea una abajo:</p>';
    } else {
        keys.forEach(plName => {
            const b = document.createElement('button');
            b.className = 'btn-outline';
            b.style.width = '100%';
            b.style.marginBottom = '5px';
            b.innerText = plName;
            b.onclick = () => addToPlaylist(plName);
            list.appendChild(b);
        });
    }

    document.getElementById('playlist-modal').style.display = 'flex';
}

function createPlaylist() {
    const name = document.getElementById('new-playlist-name').value.trim();
    if (!name) return;
    if (!playlistsData[name]) playlistsData[name] = [];
    addToPlaylist(name);
}

function addToPlaylist(plName) {
    if (currentSelectedTrackForPL && !playlistsData[plName].includes(currentSelectedTrackForPL)) {
        playlistsData[plName].push(currentSelectedTrackForPL);
    }
    closePlaylistModal();
}

function closePlaylistModal() { document.getElementById('playlist-modal').style.display = 'none'; }

// PERFIL GRID
function switchProfileTab(type) {
    document.querySelectorAll('.p-tab').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderProfileGrid(type);
}

function renderProfileGrid(type) {
    const grid = document.getElementById('profile-grid');
    grid.innerHTML = '';

    if (type === 'playlists') {
        const keys = Object.keys(playlistsData);
        if (keys.length === 0) {
            grid.innerHTML = '<p style="grid-column: span 3; text-align:center; padding:20px; color:#888;">Sin Playlists</p>';
            return;
        }
        keys.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'grid-card';
            card.innerText = `📁 ${pl}`;
            grid.appendChild(card);
        });
    } else {
        grid.innerHTML = '<p style="grid-column: span 3; text-align:center; padding:20px; color:#888;">Sin Publicaciones</p>';
    }
}

// MODAL PUBLICACIÓN
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

// CONTROL PC
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