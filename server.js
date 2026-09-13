const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Almacenamiento local
let users = {}; // { username: password }
let tracks = [];

const upload = multer({ dest: 'uploads/' });

// ==========================================
// RUTAS DE AUTENTICACIÓN (FALTABAN ESTAS DOS)
// ==========================================

// Registrar cuenta
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Completa todos los campos' });
    }
    
    const cleanUser = username.toLowerCase().trim();
    
    if (users[cleanUser]) {
        return res.status(400).json({ error: 'El usuario ya existe' });
    }

    users[cleanUser] = password;
    res.json({ success: true, username: cleanUser });
});

// Iniciar sesión
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Completa todos los campos' });
    }

    const cleanUser = username.toLowerCase().trim();

    if (!users[cleanUser] || users[cleanUser] !== password) {
        return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }

    res.json({ success: true, username: cleanUser });
});

// ==========================================
// RUTAS DE MULTIMEDIA Y CONTENIDO
// ==========================================

// Subir archivo local
app.post('/api/upload', upload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió archivo' });
    
    const newTrack = {
        id: Date.now().toString(),
        title: req.body.title || 'Sin Título',
        artist: req.body.artist || 'Desconocido',
        url: `/uploads/${req.file.filename}`,
        type: 'file',
        likes: 0,
        comments: []
    };
    tracks.unshift(newTrack);
    res.json(newTrack);
});

// Subir vía URL / YouTube
app.post('/api/upload-url', (req, res) => {
    const { title, artist, url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const newTrack = {
        id: Date.now().toString(),
        title: title || 'Música de YouTube',
        artist: artist || 'YouTube Link',
        url: url,
        type: 'url',
        likes: 0,
        comments: []
    };
    tracks.unshift(newTrack);
    res.json(newTrack);
});

// Obtener todas las canciones
app.get('/api/tracks', (req, res) => {
    res.json(tracks);
});

// Comentar en una canción
app.post('/api/tracks/:id/comment', (req, res) => {
    const track = tracks.find(t => t.id === req.params.id);
    if (!track) return res.status(404).json({ error: 'Pista no encontrada' });
    
    const { user, text } = req.body;
    const commentObj = { user, text, date: new Date().toLocaleTimeString() };
    if (!track.comments) track.comments = [];
    track.comments.push(commentObj);
    res.json(commentObj);
});

// Sockets
io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.join(data.username);
    });

    socket.on('remote_play_track', (data) => {
        io.emit('pc_play_track', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});