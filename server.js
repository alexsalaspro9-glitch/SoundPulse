const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_musicapp';

// Crear carpeta uploads si no existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuración de Multer para subir canciones
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Bases de datos temporales
const users = new Map();
const tracks = [
    {
        id: '1',
        title: 'Demo Track 01',
        artist: 'SoundPulse',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        likes: 12
    },
    {
        id: '2',
        title: 'Demo Track 02',
        artist: 'SoundPulse',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        likes: 45
    }
];

// ==========================================
// RUTAS DE AUTENTICACIÓN (Regla 60 Días)
// ==========================================
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const now = new Date();
    let existingUserKey = null;

    for (let [userKey, userData] of users.entries()) {
        if (userKey === username || userData.ip === clientIp) {
            existingUserKey = userKey;
            break;
        }
    }

    if (existingUserKey) {
        const previousUser = users.get(existingUserKey);
        const daysDiff = (now - new Date(previousUser.createdAt)) / (1000 * 60 * 60 * 24);

        if (daysDiff < 60) {
            users.delete(existingUserKey);
        } else {
            return res.status(400).json({ error: 'Ya tienes una cuenta activa.' });
        }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        username,
        password: hashedPassword,
        ip: clientIp,
        createdAt: now.toISOString()
    };

    users.set(username, newUser);
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({ token, username });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.get(username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, username });
});

// ==========================================
// SUBIDA Y OBTENCIÓN DE CANCIONES
// ==========================================
app.get('/api/tracks', (req, res) => {
    res.json(tracks);
});

app.post('/api/upload', upload.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Debes seleccionar un archivo de audio' });
    }

    const newTrack = {
        id: String(tracks.length + 1),
        title: req.body.title || 'Canción Sin Título',
        artist: req.body.artist || 'Anonimo',
        url: `/uploads/${req.file.filename}`,
        likes: 0
    };

    tracks.unshift(newTrack);
    io.emit('new_track_added', newTrack);
    res.status(201).json(newTrack);
});

// ==========================================
// WEBSOCKETS (Control Remoto)
// ==========================================
io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.join(data.username);
    });

    socket.on('remote_play_track', (data) => {
        io.to(data.username).emit('pc_play_track', data);
    });

    socket.on('remote_control', (data) => {
        io.to(data.username).emit('pc_control_action', data);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});