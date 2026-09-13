const socket = io();
let currentUser = null;
let isPCMode = false;

const audioElement = document.getElementById('audio-element');

// Cargar Feed al Iniciar
async function loadFeed() {
    try {
        const res = await fetch('/api/tracks');
        const tracks = await res.json();
        const container = document.getElementById('feed-container');
        container.innerHTML = '';

        tracks.forEach(track => {
            const item = document.createElement('div');
            item.className = 'feed-item';
            item.innerHTML = `
                <div class="feed-content">
                    <div class="track-info">
                        <span class="tag">🔥 Creador</span>
                        <h2>${track.title}</h2>
                        <p>@${track.artist}</p>
                    </div>
                    <div class="actions">
                        <button class="btn-action" onclick="triggerPlay('${track.url}', '${track.title}', '${track.artist}')">▶ Reproducir en PC</button>
                        <button class="btn-action btn-like" onclick="likeTrack(this)">♥ <span>${track.likes || 0}</span></button>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    } catch (e) {
        console.error("Error al cargar el feed", e);
    }
}

// Autenticación (Login / Registro)
async function handleAuth(type) {
    const username = document.getElementById('username').value.trim();
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
        document.getElementById('user-display').innerText = `@${currentUser}`;
        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');

        // Unirse a la sala Socket.io
        socket.emit('join_room', { username: currentUser });

        // Cargar canciones en el Feed
        loadFeed();

    } catch (err) {
        errorMsg.innerText = "Error al conectar con el servidor";
    }
}

// Activar o desactivar recepción de audio en esta pestaña (PC)
function togglePCMode() {
    isPCMode = !isPCMode;
    const btn = document.getElementById('pc-mode-btn');
    btn.classList.toggle('active', isPCMode);
    btn.innerText = isPCMode ? "Modo PC: ON" : "Modo PC: OFF";
}

// Enviar canción desde el iPhone hacia la PC
function triggerPlay(trackUrl, title, artist) {
    socket.emit('remote_play_track', {
        username: currentUser,
        trackUrl,
        title,
        artist
    });
}

// Recibir orden de reproducción (En la PC)
socket.on('pc_play_track', (data) => {
    document.getElementById('player-title').innerText = data.title;
    document.getElementById('player-artist').innerText = data.artist;

    if (isPCMode) {
        audioElement.src = data.trackUrl;
        audioElement.play();
    }
});

// Modales de subida
function openUploadModal() { document.getElementById('upload-modal').style.display = 'flex'; }
function closeUploadModal() { document.getElementById('upload-modal').style.display = 'none'; }

// Subir nuevo clip al feed
async function submitTrack(e) {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', document.getElementById('track-title').value);
    formData.append('artist', document.getElementById('track-artist').value);
    formData.append('audio', document.getElementById('track-file').files[0]);

    const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
    });

    if (res.ok) {
        closeUploadModal();
        loadFeed();
    }
}

function likeTrack(btn) {
    const span = btn.querySelector('span');
    span.innerText = parseInt(span.innerText) + 1;
}

function controlMedia(action) {
    if (action === 'pause') {
        if (audioElement.paused) audioElement.play();
        else audioElement.pause();
    } else if (action === 'stop') {
        audioElement.pause();
        audioElement.currentTime = 0;
    }
}