const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Asegurar carpeta uploads
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Configuración de Multer para archivos e imágenes de perfil
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// BASE DE DATOS EN MEMORIA
let users = {};       // { username: { password, avatar, follows: [] } }
let feedPosts = [];   // Publicaciones para el feed "Para Ti"
let playlists = {};   // { username: [ { id, name, coverColor, songs: [] } ] }
let messages = [];    // { from, to, text, date }

// Helper para ID de YouTube
function extractYoutubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// RUTAS DE AUTENTICACIÓN Y PERFIL (HTTP)
// ==========================================

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Campos incompletos' });
    const u = username.toLowerCase().trim();
    if (users[u]) return res.status(400).json({ error: 'El usuario ya existe' });

    users[u] = { password, avatar: '/uploads/default-avatar.png', follows: [] };
    playlists[u] = [];
    res.json({ success: true, username: u });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Campos incompletos' });
    const u = username.toLowerCase().trim();
    if (!users[u] || users[u].password !== password) {
        return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }
    res.json({ success: true, username: u, avatar: users[u].avatar });
});

// Cambiar foto de perfil (Soporta /api/user/avatar y /api/update-avatar)
const handleAvatarUpload = (req, res) => {
    const username = req.body.username;
    const u = username ? username.toLowerCase().trim() : null;
    if (!u || !users[u]) return res.status(404).json({ error: 'Usuario no encontrado', success: false });
    if (!req.file) return res.status(400).json({ error: 'No se subió archivo', success: false });

    const avatarUrl = `/uploads/${req.file.filename}`;
    users[u].avatar = avatarUrl;
    res.json({ success: true, avatar: avatarUrl, avatarUrl });
};

app.post('/api/user/avatar', upload.single('avatar'), handleAvatarUpload);
app.post('/api/update-avatar', upload.single('avatar'), handleAvatarUpload);

// Buscador de usuarios
app.get('/api/users/search', (req, res) => {
    const query = (req.query.q || '').toLowerCase().trim();
    const result = Object.keys(users)
        .filter(u => u.includes(query))
        .map(u => ({ username: u, avatar: users[u].avatar }));
    res.json(result);
});

// Seguir / Dejar de seguir
app.post('/api/user/follow', (req, res) => {
    const { currentUser, targetUser } = req.body;
    if (!currentUser || !targetUser) return res.status(400).json({ error: 'Parametros insuficientes' });
    const c = currentUser.toLowerCase().trim();
    const t = targetUser.toLowerCase().trim();

    if (!users[c] || !users[t]) return res.status(404).json({ error: 'Usuario no encontrado' });

    const idx = users[c].follows.indexOf(t);
    if (idx > -1) {
        users[c].follows.splice(idx, 1);
    } else {
        users[c].follows.push(t);
    }

    const isFollowing = users[c].follows.includes(t);
    const isMutual = isFollowing && users[t].follows.includes(c);

    res.json({ isFollowing, isMutual });
});

// ==========================================
// PLAYLISTS
// ==========================================

// Obtener playlists del usuario
app.get('/api/playlists/:username', (req, res) => {
    const u = req.params.username.toLowerCase().trim();
    res.json(playlists[u] || []);
});

// Crear Playlist
app.post('/api/playlists/create', (req, res) => {
    const { username, name, coverColor } = req.body;
    if (!username) return res.status(400).json({ error: 'Nombre de usuario requerido' });
    const u = username.toLowerCase().trim();
    if (!playlists[u]) playlists[u] = [];

    const newPl = {
        id: Date.now().toString(),
        name: name || 'Mi Playlist',
        coverColor: coverColor || '#e91e63',
        songs: []
    };
    playlists[u].push(newPl);
    res.json(newPl);
});

// Añadir canción a Playlist (Máximo 20 canciones)
app.post('/api/playlists/add-song', (req, res) => {
    const { username, playlistId, title, artist, url, coverColor } = req.body;
    if (!username) return res.status(400).json({ error: 'Nombre de usuario requerido' });
    const u = username.toLowerCase().trim();
    const userPlaylists = playlists[u] || [];
    const targetPl = userPlaylists.find(p => p.id === playlistId);

    if (!targetPl) return res.status(404).json({ error: 'Playlist no encontrada' });
    if (targetPl.songs.length >= 20) {
        return res.status(400).json({ error: 'Esta playlist alcanzó el límite máximo de 20 canciones.' });
    }

    const ytId = extractYoutubeId(url);
    const song = {
        id: Date.now().toString(),
        title: title || 'Canción sin título',
        artist: artist || u,
        url: url,
        youtubeId: ytId,
        coverColor: coverColor || targetPl.coverColor
    };

    targetPl.songs.push(song);
    res.json({ success: true, playlist: targetPl });
});

// ==========================================
// FEED GLOBAL / PARA TI Y POSTS
// ==========================================

// Subir Post (Audio / Video al Feed)
const handlePostUpload = (req, res) => {
    const { username, title, description, youtubeUrl } = req.body;
    if (!username) return res.status(400).json({ error: 'Usuario es requerido', success: false });
    const u = username.toLowerCase().trim();

    let mediaUrl = '';
    let coverUrl = '';
    let isYoutube = false;
    let ytId = null;
    let type = 'audio';

    if (youtubeUrl) {
        ytId = extractYoutubeId(youtubeUrl);
        if (ytId) {
            isYoutube = true;
            mediaUrl = youtubeUrl;
        }
    } else if (req.files) {
        if (req.files.media && req.files.media[0]) {
            mediaUrl = `/uploads/${req.files.media[0].filename}`;
            if (req.files.media[0].mimetype.includes('video')) {
                type = 'video';
            }
        }
        if (req.files.cover && req.files.cover[0]) {
            coverUrl = `/uploads/${req.files.cover[0].filename}`;
        }
    } else if (req.file) {
        mediaUrl = `/uploads/${req.file.filename}`;
        if (req.file.mimetype.includes('video')) type = 'video';
    }

    if (!mediaUrl) return res.status(400).json({ error: 'Proporciona un archivo o URL válida', success: false });

    const post = {
        id: Date.now().toString(),
        username: u,
        authorAvatar: users[u] ? users[u].avatar : '',
        avatar: users[u] ? users[u].avatar : '',
        title: title || 'Nuevo Post',
        description: description || '',
        mediaUrl,
        coverUrl,
        type,
        isYoutube,
        youtubeId: ytId,
        likes: 0,
        likedBy: [],
        comments: [],
        commentsCount: 0
    };

    feedPosts.unshift(post);
    res.json({ success: true, post });
};

const cpUpload = upload.fields([{ name: 'media', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);
app.post('/api/posts/create', cpUpload, handlePostUpload);
app.post('/api/upload', cpUpload, handlePostUpload);

// Obtener Feed Global
app.get('/api/posts', (req, res) => {
    res.json(feedPosts);
});

// Obtener mis posts
app.get('/api/posts/user/:username', (req, res) => {
    const u = req.params.username.toLowerCase().trim();
    const myPosts = feedPosts.filter(p => p.username === u);
    res.json(myPosts);
});

// Comentar en Post
app.post('/api/posts/:id/comment', (req, res) => {
    const { username, text } = req.body;
    const post = feedPosts.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });

    const newComment = {
        id: Date.now().toString(),
        username,
        text,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    post.comments.push(newComment);
    post.commentsCount = post.comments.length;
    res.json({ commentsCount: post.comments.length, comment: newComment });
});

// ==========================================
// INBOX Y CHAT MUTUO
// ==========================================

app.get('/api/inbox/friends/:username', (req, res) => {
    const u = req.params.username.toLowerCase().trim();
    if (!users[u]) return res.json([]);

    const myFollows = users[u].follows || [];
    const mutualFriends = myFollows.filter(friend => {
        return users[friend] && users[friend].follows.includes(u);
    }).map(friend => ({
        username: friend,
        avatar: users[friend].avatar
    }));

    res.json(mutualFriends);
});

// ==========================================
// SOCKET.IO REALTIME EVENTS
// ==========================================

io.on('connection', (socket) => {
    let socketUser = null;

    // Manejo unificado de Autenticación por Sockets
    socket.on('auth-request', (data, cb) => {
        const { mode, username, password } = data;
        const u = (username || '').toLowerCase().trim();

        if (!u || !password) {
            return cb({ success: false, message: 'Completa todos los campos.' });
        }

        if (mode === 'register') {
            if (users[u]) return cb({ success: false, message: 'El usuario ya existe.' });
            users[u] = { password, avatar: 'https://via.placeholder.com/150', follows: [] };
            playlists[u] = [];
            socketUser = u;
            return cb({ success: true, user: { username: u, avatar: users[u].avatar, following: users[u].follows, followers: [] } });
        } else {
            if (!users[u] || users[u].password !== password) {
                return cb({ success: false, message: 'Usuario o contraseña incorrectos.' });
            }
            socketUser = u;
            return cb({ success: true, user: { username: u, avatar: users[u].avatar, following: users[u].follows, followers: [] } });
        }
    });

    socket.on('register', (data, cb) => {
        const u = (data.username || '').toLowerCase().trim();
        if (!u || !data.password) return cb && cb({ success: false, message: 'Datos incompletos' });
        if (users[u]) return cb && cb({ success: false, message: 'El usuario ya existe' });

        users[u] = { password: data.password, avatar: 'https://via.placeholder.com/150', follows: [] };
        playlists[u] = [];
        socketUser = u;
        cb && cb({ success: true, user: { username: u, avatar: users[u].avatar } });
    });

    socket.on('login', (data, cb) => {
        const u = (data.username || '').toLowerCase().trim();
        if (!users[u] || users[u].password !== data.password) {
            return cb && cb({ success: false, message: 'Usuario o contraseña incorrectos' });
        }
        socketUser = u;
        cb && cb({ success: true, user: { username: u, avatar: users[u].avatar } });
    });

    socket.on('get-feed', (data, cb) => {
        if (typeof cb === 'function') cb(feedPosts);
        else socket.emit('render-feed', feedPosts);
    });

    socket.on('get-playlists', () => {
        if (socketUser) {
            socket.emit('render-playlists', playlists[socketUser] || []);
        }
    });

    socket.on('search-users', (data, cb) => {
        const query = (data.query || '').toLowerCase().trim();
        const results = Object.keys(users)
            .filter(u => u.includes(query))
            .map(u => ({ username: u, avatar: users[u].avatar }));
        
        if (typeof cb === 'function') cb(results);
        else socket.emit('search-results', results);
    });

    socket.on('get-user-profile', (data, cb) => {
        const u = (data.username || '').toLowerCase().trim();
        if (!users[u]) return cb && cb({ error: 'Usuario no encontrado' });

        const userPosts = feedPosts.filter(p => p.username === u);
        const followersCount = Object.keys(users).filter(k => users[k].follows.includes(u)).length;

        const profileData = {
            username: u,
            avatar: users[u].avatar,
            followingCount: users[u].follows.length,
            followersCount: followersCount,
            likesCount: userPosts.reduce((acc, p) => acc + (p.likes || 0), 0),
            posts: userPosts
        };

        if (typeof cb === 'function') cb(profileData);
    });

    socket.on('toggle-follow', (data, cb) => {
        const c = (data.currentUser || '').toLowerCase().trim();
        const t = (data.targetUser || '').toLowerCase().trim();

        if (users[c] && users[t]) {
            const idx = users[c].follows.indexOf(t);
            if (idx > -1) users[c].follows.splice(idx, 1);
            else users[c].follows.push(t);

            const isFollowing = users[c].follows.includes(t);
            const targetFollowersCount = Object.keys(users).filter(k => users[k].follows.includes(t)).length;

            if (typeof cb === 'function') {
                cb({ success: true, isFollowing, following: users[c].follows, targetFollowersCount });
            }
        }
    });

    socket.on('create-playlist', (data, cb) => {
        if (!socketUser) return cb && cb({ success: false });
        if (!playlists[socketUser]) playlists[socketUser] = [];

        const newPl = {
            id: Date.now().toString(),
            name: data.name || 'Nueva Playlist',
            coverColor: '#e91e63',
            songs: []
        };
        playlists[socketUser].push(newPl);
        if (typeof cb === 'function') cb({ success: true, playlist: newPl });
    });

    socket.on('get-comments', (data) => {
        const post = feedPosts.find(p => p.id === data.postId);
        socket.emit('render-comments', post ? post.comments : []);
    });

    socket.on('add-comment', (data, cb) => {
        const post = feedPosts.find(p => p.id === data.postId);
        if (post && socketUser) {
            const newComment = {
                id: Date.now().toString(),
                username: socketUser,
                text: data.text,
                date: new Date().toLocaleTimeString()
            };
            post.comments.push(newComment);
            post.commentsCount = post.comments.length;
            if (typeof cb === 'function') cb({ success: true, comment: newComment });
        }
    });

    socket.on('update-avatar', (data) => {
        if (socketUser && data.avatar) {
            users[socketUser].avatar = data.avatar;
        }
    });

    socket.on('join_chat', (data) => {
        socket.join(data.username);
    });

    socket.on('send_private_msg', (data) => {
        const { from, to, text } = data;
        io.to(to).emit('receive_private_msg', { from, text, date: new Date().toLocaleTimeString() });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`SoundPulse v2 Servidor ejecutándose en el puerto ${PORT}`);
});