const socket = io();

let currentUser = null;
let currentAuthMode = 'login';
let activePostForComments = null;
let loadedPosts = [];
let viewedUserProfile = null;

// Sincronización al iniciar
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('soundpulse_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    }
});

/* --- AUTENTICACIÓN Y CUENTAS --- */
function setAuthMode(mode) {
    currentAuthMode = mode;
    document.getElementById('btn-mode-login').classList.toggle('active', mode === 'login');
    document.getElementById('btn-mode-register').classList.toggle('active', mode === 'register');
    document.getElementById('auth-submit-btn').innerText = mode === 'login' ? 'Iniciar Sesión' : 'Registrarse';
    document.getElementById('auth-error').innerText = '';
}

function handleAuth() {
    const userVal = document.getElementById('auth-user').value.trim();
    const passVal = document.getElementById('auth-pass').value.trim();

    if (!userVal || !passVal) {
        document.getElementById('auth-error').innerText = 'Completa todos los campos';
        return;
    }

    // Validación de máximo 2 cuentas por dispositivo (localStorage tracking)
    let registeredAccounts = JSON.parse(localStorage.getItem('registered_accounts') || '[]');

    if (currentAuthMode === 'register') {
        if (!registeredAccounts.includes(userVal) && registeredAccounts.length >= 2) {
            document.getElementById('auth-error').innerText = 'Límite alcanzado: Máximo 2 cuentas por dispositivo.';
            return;
        }
    }

    socket.emit('auth-request', { mode: currentAuthMode, username: userVal, password: passVal }, (res) => {
        if (res.success) {
            currentUser = res.user;
            if (currentAuthMode === 'register' && !registeredAccounts.includes(userVal)) {
                registeredAccounts.push(userVal);
                localStorage.setItem('registered_accounts', JSON.stringify(registeredAccounts));
            }
            localStorage.setItem('soundpulse_user', JSON.stringify(currentUser));
            showApp();
        } else {
            document.getElementById('auth-error').innerText = res.message;
        }
    });
}

function logout() {
    localStorage.removeItem('soundpulse_user');
    currentUser = null;
    location.reload();
}

function showApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    loadProfileData(currentUser.username);
    loadFeed();
}

/* --- NAVEGACIÓN Y TABS --- */
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    const target = document.getElementById('tab-' + tabId);
    if(target) target.classList.add('active');
    
    document.getElementById('side-menu').classList.remove('open');

    if(tabId === 'profile') {
        loadProfileData(currentUser.username);
    } else if(tabId === 'feed') {
        loadFeed();
    }
}

function toggleSideMenu() {
    document.getElementById('side-menu').classList.toggle('open');
}

/* --- PUBLICAR (MP3 / MP4 + PORTADA) --- */
function checkFileType(e) {
    const file = e.target.files[0];
    const coverContainer = document.getElementById('mp3-cover-container');
    if (file && file.type.includes('audio')) {
        coverContainer.style.display = 'block';
    } else {
        coverContainer.style.display = 'none';
    }
}

function submitPost() {
    const title = document.getElementById('post-title-input').value;
    const desc = document.getElementById('post-desc-input').value;
    const mediaFile = document.getElementById('post-file-input').files[0];
    const coverFile = document.getElementById('post-cover-input').files[0];

    if (!mediaFile) return alert('Selecciona un archivo multimedia');

    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', desc);
    formData.append('username', currentUser.username);
    formData.append('media', mediaFile);
    if (coverFile) formData.append('cover', coverFile);

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    }).then(r => r.json()).then(data => {
        if(data.success) {
            closeModal('modal-upload');
            loadFeed();
            if(document.getElementById('tab-myposts').classList.contains('active')) {
                loadMyPosts();
            }
        }
    });
}

/* --- CARGA DE FEED ESTILO TIKTOK --- */
function loadFeed() {
    socket.emit('get-feed', {}, (posts) => {
        loadedPosts = posts;
        const container = document.getElementById('feed-container');
        container.innerHTML = '';

        posts.forEach(post => {
            const postEl = document.createElement('div');
            postEl.className = 'tiktok-post';

            let mediaHTML = '';
            if (post.type === 'video') {
                mediaHTML = `
                    <div class="media-frame">
                        <video class="tiktok-media" loop src="${post.mediaUrl}" onclick="toggleMediaPlay(this)"></video>
                    </div>`;
            } else {
                mediaHTML = `
                    <div class="media-frame">
                        <img src="${post.coverUrl || 'https://via.placeholder.com/300'}" class="mp3-cover-display">
                        <audio src="${post.mediaUrl}" loop></audio>
                    </div>`;
            }

            postEl.innerHTML = `
                ${mediaHTML}
                <div class="tiktok-sidebar">
                    <button class="side-action-btn" onclick="toggleLike('${post.id}', this)">
                        <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        <span class="like-count">${post.likes || 0}</span>
                    </button>
                    <button class="side-action-btn" onclick="openComments('${post.id}')">
                        <svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
                        <span>${post.commentsCount || 0}</span>
                    </button>
                    <div class="disc-icon">
                        <img src="${post.authorAvatar || 'https://via.placeholder.com/100'}">
                    </div>
                </div>
                <div class="tiktok-info">
                    <div class="username-tag" onclick="viewProfile('${post.username}')">@${post.username}</div>
                    <div class="description-text">${post.description || ''}</div>
                    <div class="sound-track">
                        <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        <span>${post.title || 'Sonido original'}</span>
                    </div>
                </div>
            `;

            container.appendChild(postEl);
        });
    });
}

/* --- PERFILES Y BÚSQUEDA --- */
function searchUsers() {
    const q = document.getElementById('search-input').value.trim();
    if(!q) {
        document.getElementById('search-results').innerHTML = '';
        return;
    }

    socket.emit('search-users', { query: q }, (results) => {
        const container = document.getElementById('search-results');
        container.innerHTML = '';

        results.forEach(user => {
            const isFollowing = currentUser.following && currentUser.following.includes(user.username);
            const div = document.createElement('div');
            div.className = 'user-search-result';
            div.innerHTML = `
                <div class="user-result-info" onclick="viewProfile('${user.username}')">
                    <img src="${user.avatar || 'https://via.placeholder.com/100'}">
                    <div>
                        <div style="font-weight: bold; font-size: 0.9rem;">@${user.username}</div>
                    </div>
                </div>
                <button class="btn-follow ${isFollowing ? 'following' : ''}" onclick="toggleFollow('${user.username}', this)">
                    ${isFollowing ? 'Following' : 'Follow'}
                </button>
            `;
            container.appendChild(div);
        });
    });
}

function viewProfile(username) {
    viewedUserProfile = username;
    switchTab('profile');
    loadProfileData(username);
}

function loadProfileData(username) {
    socket.emit('get-user-profile', { username }, (data) => {
        document.getElementById('profile-username').innerText = '@' + data.username;
        document.getElementById('profile-avatar-img').src = data.avatar || 'https://via.placeholder.com/150';
        document.getElementById('stat-followers').innerText = data.followersCount || 0;
        document.getElementById('stat-following').innerText = data.followingCount || 0;
        document.getElementById('stat-likes').innerText = data.likesCount || 0;

        const actionsBox = document.getElementById('profile-actions');
        if (username === currentUser.username) {
            actionsBox.innerHTML = `<button class="btn-primary" style="padding: 6px 20px; font-size: 0.8rem;" onclick="triggerAvatarUpload()">Cambiar Foto</button>`;
        } else {
            const isFollowing = currentUser.following && currentUser.following.includes(username);
            actionsBox.innerHTML = `
                <button class="btn-follow ${isFollowing ? 'following' : ''}" onclick="toggleFollow('${username}', this)">
                    ${isFollowing ? 'Following' : 'Follow'}
                </button>`;
        }

        // Render posts del usuario
        const grid = document.getElementById('user-posts-grid');
        grid.innerHTML = '';
        (data.posts || []).forEach(post => {
            const item = document.createElement('div');
            item.className = 'grid-item';
            if (post.type === 'video') {
                item.innerHTML = `<video src="${post.mediaUrl}#t=0.5" preload="metadata"></video>`;
            } else {
                item.innerHTML = `<img src="${post.coverUrl || 'https://via.placeholder.com/150'}">`;
            }
            grid.appendChild(item);
        });
    });
}

function toggleFollow(username, btn) {
    socket.emit('toggle-follow', { targetUser: username, currentUser: currentUser.username }, (res) => {
        if(res.success) {
            currentUser.following = res.following;
            localStorage.setItem('soundpulse_user', JSON.stringify(currentUser));
            if(btn) {
                btn.classList.toggle('following', res.isFollowing);
                btn.innerText = res.isFollowing ? 'Following' : 'Follow';
            }
            if(viewedUserProfile === username) {
                document.getElementById('stat-followers').innerText = res.targetFollowersCount;
            }
        }
    });
}

/* --- REPRODUCTOR FLOTANTE Y CONTROLES --- */
const audioPlayer = document.getElementById('global-audio-player');

function togglePlayPause() {
    if (audioPlayer.src) {
        if (audioPlayer.paused) {
            audioPlayer.play();
            updatePlayerIcon(true);
        } else {
            audioPlayer.pause();
            updatePlayerIcon(false);
        }
    }
}

function updatePlayerIcon(isPlaying) {
    document.getElementById('play-icon').style.display = isPlaying ? 'none' : 'block';
    document.getElementById('pause-icon').style.display = isPlaying ? 'block' : 'none';
}

function setVolume(val) {
    audioPlayer.volume = val;
    document.querySelectorAll('video').forEach(v => v.volume = val);
}

/* --- MODALES --- */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function openUploadModal() { openModal('modal-upload'); }
function openCreatePlaylistModal() { openModal('modal-playlist'); }

function triggerAvatarUpload() {
    if(viewedUserProfile === currentUser.username) {
        document.getElementById('avatar-file-input').click();
    }
}

function uploadAvatar(e) {
    const file = e.target.files[0];
    if(!file) return;

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', currentUser.username);

    fetch('/api/update-avatar', { method: 'POST', body: formData })
    .then(r => r.json()).then(data => {
        if(data.success) {
            currentUser.avatar = data.avatarUrl;
            localStorage.setItem('soundpulse_user', JSON.stringify(currentUser));
            loadProfileData(currentUser.username);
        }
    });
}

function toggleComments() {
    document.getElementById('comments-panel').classList.toggle('open');
}

function openComments(postId) {
    activePostForComments = postId;
    toggleComments();
    // Cargar comentarios via socket...
}