const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Buat folder uploads jika belum ada
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Konfigurasi multer untuk upload file
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('File harus berupa gambar!'));
        }
    }
});

// ================== KONEKSI MYSQL ==================
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// Koneksi ke database
db.connect((err) => {
    if (err) {
        console.error('❌ Gagal konek ke MySQL:', err);
        process.exit(1);
    }
    console.log('✅ Connected to MySQL database!');
    
    // Buat tabel jika belum ada
    createTables();
});

// Fungsi membuat tabel
function createTables() {
    // Tabel users
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            full_name VARCHAR(100),
            avatar_url VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `;

    // Tabel posts
    const createPostsTable = `
        CREATE TABLE IF NOT EXISTS posts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            image_url VARCHAR(500) NOT NULL,
            image_filename VARCHAR(255),
            caption TEXT,
            likes_count INT DEFAULT 0,
            comments_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `;

    // Tabel likes
    const createLikesTable = `
        CREATE TABLE IF NOT EXISTS likes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            post_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            UNIQUE KEY unique_like (user_id, post_id)
        )
    `;

    // Tabel comments
    const createCommentsTable = `
        CREATE TABLE IF NOT EXISTS comments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            post_id INT NOT NULL,
            user_id INT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `;

    // Jalankan query
    db.query(createUsersTable, (err) => {
        if (err) console.error('Error creating users table:', err);
        else console.log('✅ Users table ready');
    });

    db.query(createPostsTable, (err) => {
        if (err) console.error('Error creating posts table:', err);
        else console.log('✅ Posts table ready');
    });

    db.query(createLikesTable, (err) => {
        if (err) console.error('Error creating likes table:', err);
        else console.log('✅ Likes table ready');
    });

    db.query(createCommentsTable, (err) => {
        if (err) console.error('Error creating comments table:', err);
        else console.log('✅ Comments table ready');
    });

    // Buat user test jika belum ada
    createTestUser();
}

// Fungsi membuat user test
async function createTestUser() {
    const hashedPassword = bcrypt.hashSync('123', 10);
    
    const checkUser = 'SELECT * FROM users WHERE username = ?';
    db.query(checkUser, ['123'], (err, results) => {
        if (err) {
            console.error('Error checking user:', err);
            return;
        }

        if (results.length === 0) {
            const insertUser = 'INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)';
            db.query(insertUser, ['123', '123@gmail.com', hashedPassword, 'Test User'], (err) => {
                if (err) console.error('Error creating test user:', err);
                else console.log('✅ Test user created: 123 / 123');
            });
        } else {
            console.log('✅ Test user already exists');
        }
    });
}

// ================== API ROUTES ==================

// Test koneksi
app.get('/api/test', (req, res) => {
    db.query('SELECT 1+1 AS result', (err, results) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                message: 'Database connection failed',
                error: err.message 
            });
        }
        res.json({ 
            success: true, 
            message: 'Database connected!',
            result: results[0].result 
        });
    });
});

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Semua field harus diisi!' 
        });
    }

    try {
        // Cek username sudah ada
        const checkUser = 'SELECT * FROM users WHERE username = ? OR email = ?';
        db.query(checkUser, [username, email], async (err, results) => {
            if (err) {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Database error',
                    error: err.message 
                });
            }

            if (results.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Username atau email sudah digunakan!' 
                });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Insert user
            const insertUser = 'INSERT INTO users (username, email, password, full_name) VALUES (?, ?, ?, ?)';
            db.query(insertUser, [username, email, hashedPassword, username], (err, result) => {
                if (err) {
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Gagal insert user',
                        error: err.message 
                    });
                }

                res.json({ 
                    success: true, 
                    message: 'Registrasi berhasil!',
                    userId: result.insertId 
                });
            });
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Username dan password harus diisi!' 
        });
    }

    // Cari user
    const findUser = 'SELECT * FROM users WHERE username = ?';
    db.query(findUser, [username], async (err, results) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                message: 'Database error',
                error: err.message 
            });
        }

        if (results.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Username tidak ditemukan!' 
            });
        }

        const user = results[0];

        // Cek password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Password salah!' 
            });
        }

        // Buat token JWT
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Login berhasil!',
            token: token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name
            }
        });
    });
});

// Verify token middleware
function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'No token provided' 
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ 
                success: false, 
                message: 'Invalid token' 
            });
        }
        req.userId = decoded.id;
        req.username = decoded.username;
        next();
    });
}

// Upload foto
app.post('/api/upload', verifyToken, upload.single('image'), (req, res) => {
    const { caption } = req.body;

    if (!req.file) {
        return res.status(400).json({ 
            success: false, 
            message: 'Pilih foto terlebih dahulu!' 
        });
    }

    if (!caption) {
        return res.status(400).json({ 
            success: false, 
            message: 'Tulis caption!' 
        });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    const insertPost = 'INSERT INTO posts (user_id, image_url, image_filename, caption) VALUES (?, ?, ?, ?)';
    db.query(insertPost, [req.userId, imageUrl, req.file.filename, caption], (err, result) => {
        if (err) {
            return res.status(500).json({ 
                success
