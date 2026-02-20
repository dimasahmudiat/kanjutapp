const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ========== KONEKSI MYSQL ==========
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'i3wu4s.h.filess.io',
    user: process.env.DB_USER || 'dimas_luckytower',
    password: process.env.DB_PASSWORD || 'dimasahm12',
    database: process.env.DB_NAME || 'dimas_luckytower',
    port: process.env.DB_PORT || 61001
});

db.connect((err) => {
    if (err) {
        console.error('❌ MySQL connection failed:', err);
    } else {
        console.log('✅ Connected to MySQL database!');
    }
});

// ========== MULTER UNTUK UPLOAD (Base64) ==========
// Karena Vercel tidak menyimpan file, kita akan simpan gambar sebagai base64 di database
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('File harus gambar!'), false);
        }
    }
});

// ========== MIDDLEWARE VERIFIKASI TOKEN ==========
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token tidak ada' });

    jwt.verify(token, process.env.JWT_SECRET || 'dimas_secret', (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: 'Token tidak valid' });
        req.userId = decoded.id;
        next();
    });
}

// ========== API ROUTES ==========

// Test koneksi
app.get('/api/test', (req, res) => {
    db.query('SELECT 1+1 AS result', (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, result: results[0].result });
    });
});

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Semua field harus diisi' });
    }

    try {
        // Cek user sudah ada
        db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email], async (err, results) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (results.length > 0) {
                return res.status(400).json({ success: false, message: 'Username atau email sudah terdaftar' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            db.query(
                'INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)',
                [username, email, hashedPassword, username],
                (err, result) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Registrasi berhasil' });
                }
            );
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username dan password harus diisi' });
    }

    db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Username tidak ditemukan' });
        }

        const user = results[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Password salah' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || 'dimas_secret',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name
            }
        });
    });
});

// Upload foto (dengan base64)
app.post('/api/upload', verifyToken, upload.single('image'), (req, res) => {
    const { caption } = req.body;
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Pilih foto' });
    }
    if (!caption) {
        return res.status(400).json({ success: false, message: 'Tulis caption' });
    }

    // Konversi file ke base64
    const imageBase64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

    db.query(
        'INSERT INTO posts (user_id, image_url, image_filename, caption) VALUES (?, ?, ?, ?)',
        [req.userId, imageUrl, req.file.originalname, caption],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Foto berhasil diupload' });
        }
    );
});

// Get all posts
app.get('/api/posts', (req, res) => {
    const query = `
        SELECT p.*, u.username, u.full_name,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, posts: results });
    });
});

// Get posts by user
app.get('/api/posts/user/:userId', (req, res) => {
    const query = `
        SELECT p.*, u.username,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
    `;
    db.query(query, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, posts: results });
    });
});

// Like/unlike
app.post('/api/like/:postId', verifyToken, (req, res) => {
    const postId = req.params.postId;
    db.query('SELECT * FROM likes WHERE user_id = ? AND post_id = ?', [req.userId, postId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });

        if (results.length > 0) {
            // Unlike
            db.query('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [req.userId, postId], (err) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                db.query('UPDATE posts SET likes_count = likes_count - 1 WHERE id = ?', [postId]);
                res.json({ success: true, liked: false });
            });
        } else {
            // Like
            db.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.userId, postId], (err) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                db.query('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [postId]);
                res.json({ success: true, liked: true });
            });
        }
    });
});

// Delete post
app.delete('/api/post/:postId', verifyToken, (req, res) => {
    db.query('DELETE FROM posts WHERE id = ? AND user_id = ?', [req.params.postId, req.userId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) {
            return res.status(403).json({ success: false, message: 'Tidak berhak menghapus' });
        }
        res.json({ success: true, message: 'Post dihapus' });
    });
});

// ========== JALANKAN SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
