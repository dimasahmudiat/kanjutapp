const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Buat folder uploads jika belum ada (di Vercel tidak bisa menyimpan file, jadi kita gunakan base64 atau hosting lain)
// Untuk Vercel, kita simpan gambar sebagai base64 di database atau gunakan service seperti Cloudinary.
// Tapi untuk sementara, kita akan simpan di memory dan kirim sebagai base64.

// ================== KONEKSI MYSQL ==================
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'i3wu4s.h.filess.io',
    user: process.env.DB_USER || 'dimas_luckytower',
    password: process.env.DB_PASSWORD || 'dimasahm12',
    database: process.env.DB_NAME || 'dimas_luckytower',
    port: process.env.DB_PORT || 61001
});

db.connect((err) => {
    if (err) {
        console.error('❌ Gagal konek ke MySQL:', err);
    } else {
        console.log('✅ Connected to MySQL database!');
    }
});

// API Routes
app.get('/api/test', (req, res) => {
    db.query('SELECT 1+1 AS result', (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, result: results[0].result });
    });
});

// Register
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    // ... (isi lengkapnya sama seperti sebelumnya)
});

// Login
app.post('/api/login', (req, res) => {
    // ... 
});

// Upload (dengan base64 untuk Vercel)
app.post('/api/upload', (req, res) => {
    // ...
});

// Get posts
app.get('/api/posts', (req, res) => {
    // ...
});

// Like, unlike, delete, dll.

// Jalankan server
module.exports = app;
