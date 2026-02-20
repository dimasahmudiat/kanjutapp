const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ========== BUAT POOL KONEKSI MYSQL (lebih stabil) ==========
const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST || 'i3wu4s.h.filess.io',
    user: process.env.DB_USER || 'dimas_luckytower',
    password: process.env.DB_PASSWORD || 'dimasahm12',
    database: process.env.DB_NAME || 'dimas_luckytower',
    port: process.env.DB_PORT || 61001,
    multipleStatements: true
});

// Test koneksi pool
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Gagal mendapatkan koneksi dari pool:', err);
    } else {
        console.log('✅ Pool MySQL siap digunakan');
        connection.release();
    }
});

// ========== MULTER (Upload file) ==========
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('File harus gambar'), false);
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
    pool.query('SELECT 1+1 AS result', (err, results) => {
        if (err) {
            console.error('Test query error:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
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
        pool.query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, email],
            async (err, results) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (results.length > 0) {
                    return res.status(400).json({ success: false, message: 'Username atau email sudah terdaftar' });
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                pool.query(
                    'INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)',
                    [username, email, hashedPassword, username],
                    (err, result) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, message: 'Registrasi berhasil' });
                    }
                );
            }
        );
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

    pool.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
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

// Upload foto
app.post('/api/upload', verifyToken, upload.single('image'), (req, res) => {
    const { caption } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: 'Pilih foto' });
    if (!caption) return res.status(400).json({ success: false, message: 'Tulis caption' });

    const imageBase64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

    pool.query(
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
    pool.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, posts: results });
    });
});

// Get user posts
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
    pool.query(query, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, posts: results });
    });
});

// Like/unlike
app.post('/api/like/:postId', verifyToken, (req, res) => {
    const postId = req.params.postId;
    pool.query('SELECT * FROM likes WHERE user_id = ? AND post_id = ?', [req.userId, postId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });

        if (results.length > 0) {
            // Unlike
            pool.query('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [req.userId, postId], (err) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                pool.query('UPDATE posts SET likes_count = likes_count - 1 WHERE id = ?', [postId]);
                res.json({ success: true, liked: false });
            });
        } else {
            // Like
            pool.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [req.userId, postId], (err) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                pool.query('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [postId]);
                res.json({ success: true, liked: true });
            });
        }
    });
});

// Delete post
app.delete('/api/post/:postId', verifyToken, (req, res) => {
    pool.query('DELETE FROM posts WHERE id = ? AND user_id = ?', [req.params.postId, req.userId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (result.affectedRows === 0) {
            return res.status(403).json({ success: false, message: 'Tidak berhak menghapus' });
        }
        res.json({ success: true, message: 'Post dihapus' });
    });
});

// ========== CHAT ENDPOINTS ==========

// Kirim pesan
app.post('/api/messages/send', verifyToken, (req, res) => {
    const { receiver_id, message } = req.body;
    if (!receiver_id || !message) {
        return res.status(400).json({ success: false, message: 'Receiver dan pesan harus diisi' });
    }

    pool.query(
        'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
        [req.userId, receiver_id, message],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Pesan terkirim', messageId: result.insertId });
        }
    );
});

// Dapatkan daftar percakapan (user yang pernah chat dengan current user)
app.get('/api/messages/conversations', verifyToken, (req, res) => {
    const query = `
        SELECT DISTINCT 
            u.id as user_id,
            u.username,
            u.full_name,
            u.avatar_url,
            (SELECT m.message FROM messages m 
             WHERE (m.sender_id = u.id AND m.receiver_id = ?) 
                OR (m.sender_id = ? AND m.receiver_id = u.id)
             ORDER BY m.created_at DESC LIMIT 1) as last_message,
            (SELECT m.created_at FROM messages m 
             WHERE (m.sender_id = u.id AND m.receiver_id = ?) 
                OR (m.sender_id = ? AND m.receiver_id = u.id)
             ORDER BY m.created_at DESC LIMIT 1) as last_time,
            (SELECT COUNT(*) FROM messages m 
             WHERE m.sender_id = u.id AND m.receiver_id = ? AND m.is_read = FALSE) as unread_count
        FROM users u
        WHERE u.id != ? AND EXISTS (
            SELECT 1 FROM messages 
            WHERE (sender_id = u.id AND receiver_id = ?) 
               OR (sender_id = ? AND receiver_id = u.id)
        )
        ORDER BY last_time DESC
    `;
    pool.query(query, [req.userId, req.userId, req.userId, req.userId, req.userId, req.userId, req.userId, req.userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, conversations: results });
    });
});

// Dapatkan pesan dengan user tertentu
app.get('/api/messages/with/:userId', verifyToken, (req, res) => {
    const otherUserId = req.params.userId;
    pool.query(
        `SELECT m.*, u_sender.username as sender_name, u_receiver.username as receiver_name
         FROM messages m
         JOIN users u_sender ON m.sender_id = u_sender.id
         JOIN users u_receiver ON m.receiver_id = u_receiver.id
         WHERE (m.sender_id = ? AND m.receiver_id = ?) 
            OR (m.sender_id = ? AND m.receiver_id = ?)
         ORDER BY m.created_at ASC`,
        [req.userId, otherUserId, otherUserId, req.userId],
        (err, results) => {
            if (err) return res.status(500).json({ success: false, message: err.message });

            // Tandai pesan yang diterima sebagai sudah dibaca
            pool.query(
                'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
                [otherUserId, req.userId],
                (err2) => {
                    if (err2) console.error('Error marking messages as read:', err2);
                }
            );

            res.json({ success: true, messages: results });
        }
    );
});

// Cari user untuk memulai chat (berdasarkan username)
app.get('/api/users/search', verifyToken, (req, res) => {
    const query = req.query.q || '';
    if (query.length < 1) return res.json({ success: true, users: [] });

    pool.query(
        'SELECT id, username, full_name, avatar_url FROM users WHERE username LIKE ? AND id != ? LIMIT 10',
        [`%${query}%`, req.userId],
        (err, results) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, users: results });
        }
    );
});

// ========== CHAT PUBLIK ==========

// Ambil semua pesan publik
app.get('/api/public-messages', (req, res) => {
    const query = `
        SELECT pm.*, u.username, u.avatar_url,
               (SELECT username FROM users WHERE id = u.id) as sender_name
        FROM public_messages pm
        JOIN users u ON pm.user_id = u.id
        ORDER BY pm.created_at ASC
    `;
    pool.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, messages: results });
    });
});

// Kirim pesan publik
app.post('/api/public-messages', verifyToken, (req, res) => {
    const { message, reply_to } = req.body;
    if (!message || message.trim() === '') {
        return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong' });
    }
    pool.query(
        'INSERT INTO public_messages (user_id, message, reply_to) VALUES (?, ?, ?)',
        [req.userId, message, reply_to || null],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Pesan terkirim', id: result.insertId });
        }
    );
});

// ========== JALANKAN SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server berjalan di port ${PORT}`);
});
