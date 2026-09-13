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
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// RUTAS DE AUTENTICACIÓN Y PERFIL
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
    const u = username.toLowerCase().trim();
    if (!users[u] || users[u].password !== password) {
        return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }
    res.json({ success: true, username: u, avatar: users[u].avatar });
});

// Cambiar foto de perfil
app.post('/api/user/avatar', upload.single('avatar'), (req, res) => {
    const { username } = req.body;
    const u = username ? username.toLowerCase().trim() : null;
    if (!u || !users[u]) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });

    const avatarUrl = `/uploads/${req.file.filename}`;
    users[u].avatar = avatarUrl;
    res.json({ success: true, avatar: avatarUrl });
});

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

// Subir Post (Video / Audio al Feed)
app.post('/api/posts/create', upload.single('media'), (req, res) => {
    const { username, title, description, youtubeUrl } = req.body;
    const u = username.toLowerCase().trim();

    let mediaUrl = '';
    let isYoutube = false;
    let ytId = null;

    if (youtubeUrl) {
        ytId = extractYoutubeId(youtubeUrl);
        if (ytId) {
            isYoutube = true;
            mediaUrl = youtubeUrl;
        }
    } else if (req.file) {
        mediaUrl = `/uploads/${req.file.filename}`;
    }

    if (!mediaUrl) return res.status(400).json({ error: 'Proporciona un archivo o URL válida' });

    const post = {
        id: Date.now().toString(),
        username: u,
        avatar: users[u] ? users[u].avatar : '',
        title: title || 'Nuevo Post',
        description: description || '',
        mediaUrl,
        isYoutube,
        youtubeId: ytId,
        likes: [],
        comments: []
    };

    feedPosts.unshift(post);
    res.json(post);
});

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
    res.json({ commentsCount: post.comments.length, comment: newComment });
});

// ==========================================
// INBOX Y CHAT MUTUO
// ==========================================

app.get('/api/inbox/friends/:username', (req, res) => {
    const u = req.params.username.toLowerCase().trim();
    if (!users[u]) return res.json([]);

    const myFollows = users[u].follows || [];
    // Filtrar solo seguimiento mutuo
    const mutualFriends = myFollows.filter(friend => {
        return users[friend] && users[friend].follows.includes(u);
    }).map(friend => ({
        username: friend,
        avatar: users[friend].avatar
    }));

    res.json(mutualFriends);
});

// Sockets
io.on('connection', (socket) => {
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