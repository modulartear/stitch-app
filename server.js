require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');

// Firebase Admin Initialization
let db;
let bucket;

const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

if (serviceAccountEnv || fs.existsSync(serviceAccountPath)) {
    try {
        const serviceAccount = serviceAccountEnv
            ? JSON.parse(serviceAccountEnv)
            : require(serviceAccountPath);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET // e.g., your-project-id.appspot.com
        });

        db = admin.firestore();
        db.settings({ ignoreUndefinedProperties: true });
        bucket = admin.storage().bucket();

        console.log('✅ Firebase Admin & Storage Inicializado');
    } catch (err) {
        console.error('❌ Error inicializando Firebase:', err);
    }
} else {
    console.warn('⚠️ No se encontró FIREBASE_SERVICE_ACCOUNT ni archivo JSON local.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root route redirect
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Cloud Storage configuration
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper to upload to Firebase Storage
async function uploadFileToStorage(file, folder = 'media') {
    if (!bucket) throw new Error('Storage bucket not initialized');

    const fileName = `${folder}/${Date.now()}-${file.originalname}`;
    const fileRef = bucket.file(fileName);

    await fileRef.save(file.buffer, {
        metadata: { contentType: file.mimetype }
    });

    // In production, you might want to adjust access control
    await fileRef.makePublic();

    return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
}


// Auth Endpoints
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!db) return res.status(500).json({ message: 'Base de datos Firebase no inicializada' });

        const usersRef = db.collection('users');
        const querySnapshot = await usersRef.where('email', '==', email).get();

        if (!querySnapshot.empty) {
            return res.status(400).json({ message: 'El usuario ya existe' });
        }

        const newUser = {
            name,
            email,
            password,
            avatar_url: null,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await usersRef.add(newUser);

        res.status(201).json({
            message: 'Usuario registrado con éxito',
            id: docRef.id,
            ...newUser
        });
    } catch (err) {
        console.error('Error en /api/register:', err);
        res.status(500).json({ message: 'Error en el servidor al registrar usuario' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!db) return res.status(500).json({ message: 'Base de datos Firebase no inicializada' });

        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).where('password', '==', password).limit(1).get();

        if (snapshot.empty) {
            return res.status(401).json({ message: 'Correo o contraseña incorrectos' });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        res.json({
            message: 'Login exitoso',
            id: userDoc.id,
            name: userData.name,
            email: userData.email,
            avatar_url: userData.avatar_url,
            password: userData.password
        });
    } catch (err) {
        console.error('Error en /api/login:', err);
        res.status(500).json({ message: 'Error en el servidor' });
    }
});

// Avatar Upload Endpoint (Refactored for Cloud)
const avatarUpload = multer({ storage: multer.memoryStorage() });


app.post('/api/upload-avatar', avatarUpload.single('avatar'), async (req, res) => {
    try {
        console.log('--- INTENTO DE CARGA AVATAR (CLOUD) ---');
        if (!req.file) return res.status(400).send('No avatar uploaded.');
        const { userId } = req.body;

        if (!userId) return res.status(400).send('User ID is required.');

        // Upload to Cloud
        const avatarUrl = await uploadFileToStorage(req.file, 'avatars');

        const userRef = db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) return res.status(404).send('Usuario no encontrado');

        await userRef.update({ avatar_url: avatarUrl });
        console.log('Avatar actualizado con éxito en la nube:', avatarUrl);
        res.json({ avatar_url: avatarUrl });
    } catch (err) {
        console.error('Error en /api/upload-avatar:', err);
        res.status(500).send('Error al subir avatar');
    }
});

// Update Profile Endpoint
app.get('/api/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const userDoc = await db.collection('users').doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const userData = userDoc.data();
        delete userData.password;

        res.json({ id: userDoc.id, ...userData });
    } catch (err) {
        console.error('Error en GET /api/user/:userId:', err);
        res.status(500).json({ message: 'Error al obtener datos de usuario' });
    }
});

app.put('/api/update-profile', async (req, res) => {
    try {
        const { name, email, password, oldEmail } = req.body;
        if (!oldEmail) return res.status(400).json({ message: 'Email actual es necesario' });

        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', oldEmail).limit(1).get();

        if (snapshot.empty) return res.status(404).json({ message: 'Usuario no encontrado' });

        const updateData = { name, email };
        if (password) updateData.password = password;

        await snapshot.docs[0].ref.update(updateData);
        res.json({ message: 'Perfil actualizado con éxito', user: { name, email } });
    } catch (err) {
        console.error('Error en /api/update-profile:', err);
        res.status(500).json({ message: 'Error en el servidor' });
    }
});

// Event Endpoints
app.post('/api/events', async (req, res) => {
    try {
        const { userId, name, date, time, category } = req.body;
        if (!db) return res.status(500).json({ message: 'Base de datos Firebase no inicializada' });
        if (!userId) return res.status(400).json({ message: 'User ID is required' });

        const eventData = {
            user_id: userId,
            name,
            date,
            time,
            category,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('events').add(eventData);
        res.status(201).json({ id: docRef.id, ...eventData });
    } catch (err) {
        console.error('Error en POST /api/events:', err);
        res.status(500).json({ message: 'Error al crear evento' });
    }
});

app.get('/api/events/:userId', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ message: 'Base de datos Firebase no inicializada' });
        const { userId } = req.params;
        const snapshot = await db.collection('events')
            .where('user_id', '==', userId)
            .orderBy('date', 'asc')
            .get();

        const events = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json(events);
    } catch (err) {
        console.error('Error en GET /api/events:', err);
        res.status(500).json({ message: 'Error al obtener eventos' });
    }
});

app.put('/api/events/:eventId', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ message: 'Base de datos Firebase no inicializada' });
        const { eventId } = req.params;
        const { userId, name, date, time, category } = req.body;

        if (!userId) return res.status(400).json({ message: 'User ID is required' });

        const ref = db.collection('events').doc(eventId);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ message: 'Evento no encontrado' });

        const current = doc.data();
        if (current.user_id !== userId) return res.status(403).json({ message: 'No autorizado' });

        const updateData = {
            name,
            date,
            time,
            category,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        };

        await ref.update(updateData);
        res.json({ id: eventId, ...current, ...updateData });
    } catch (err) {
        console.error('Error en PUT /api/events/:eventId:', err);
        res.status(500).json({ message: 'Error al actualizar evento' });
    }
});

app.delete('/api/events/:eventId', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ message: 'Base de datos Firebase no inicializada' });
        const { eventId } = req.params;
        const { userId } = req.body;

        if (!userId) return res.status(400).json({ message: 'User ID is required' });

        const ref = db.collection('events').doc(eventId);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ message: 'Evento no encontrado' });

        const current = doc.data();
        if (current.user_id !== userId) return res.status(403).json({ message: 'No autorizado' });

        await ref.delete();
        res.json({ message: 'Evento eliminado', id: eventId });
    } catch (err) {
        console.error('Error en DELETE /api/events/:eventId:', err);
        res.status(500).json({ message: 'Error al eliminar evento' });
    }
});

// Media Endpoints
app.post('/api/upload', upload.single('media'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');
        if (!db || !bucket) return res.status(500).send('Backend Services not initialized');

        // Upload to Cloud
        const mediaUrl = await uploadFileToStorage(req.file, 'media');

        const mediaData = {
            url: mediaUrl,
            author: req.body.author || 'Invitado',
            status: 'pending',
            created_at: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('media').add(mediaData);
        const savedItem = { id: docRef.id, ...mediaData };

        io.emit('new_pending_item', savedItem);
        res.status(201).json(savedItem);
    } catch (err) {
        console.error('Error en POST /api/upload:', err);
        res.status(500).send('Error al subir archivo');
    }
});

app.get('/api/media', async (req, res) => {
    try {
        if (!db) return res.status(500).send('DB not initialized');
        const status = req.query.status;
        let query = db.collection('media').orderBy('created_at', 'desc');

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query.get();
        const items = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json(items);
    } catch (err) {
        console.error('Error en GET /api/media:', err);
        res.status(500).send('Error al obtener media');
    }
});

app.post('/api/moderate/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).send('DB not initialized');
        const { id } = req.params;
        const { status } = req.body; // 'approved' or 'rejected'

        const docRef = db.collection('media').doc(id);
        const doc = await docRef.get();

        if (!doc.exists) return res.status(404).send('Item not found.');

        await docRef.update({ status });
        const item = { id: doc.id, ...doc.data(), status };

        if (status === 'approved') {
            io.emit('item_approved', item);
        } else {
            io.emit('item_rejected', id);
        }

        res.json(item);
    } catch (err) {
        console.error('Error en POST /api/moderate:', err);
        res.status(500).send('Error en moderación');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
