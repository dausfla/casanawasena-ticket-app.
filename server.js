process.env.TZ = 'Asia/Jakarta';

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { dbAsync, initDb } from './config/db.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET_TOKEN = 'casanawasena-admin-authenticated-session-token-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('casanawasena-secret-key-2026'));

// Serve Static Files
app.use(express.static(path.resolve('public')));
app.use('/views', express.static(path.resolve('views')));

// Helper to format timestamps in WIB (Waktu Indonesia Barat - UTC+7)
function getFormattedDateTime() {
  const d = new Date();
  // Get UTC time and add 7 hours for WIB
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
  const wibDate = new Date(utcMs + (3600000 * 7));

  const year = wibDate.getFullYear();
  const month = String(wibDate.getMonth() + 1).padStart(2, '0');
  const day = String(wibDate.getDate()).padStart(2, '0');
  const hours = String(wibDate.getHours()).padStart(2, '0');
  const minutes = String(wibDate.getMinutes()).padStart(2, '0');
  const seconds = String(wibDate.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Helper to generate Random Alphanumeric String
function generateRandomCode(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Auth Verification Middleware
function requireAdminAuth(req, res, next) {
  const token = req.cookies.admin_token;
  if (token === ADMIN_SECRET_TOKEN) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Sesi admin berakhir atau tidak valid. Silakan login kembali.' });
}

// ================= PAGES ROUTES =================

app.get('/', (req, res) => {
  res.sendFile(path.resolve('views/index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.resolve('views/index.html'));
});

app.get('/success.html', (req, res) => {
  res.sendFile(path.resolve('views/success.html'));
});

app.get('/admin', (req, res) => {
  const token = req.cookies.admin_token;
  if (token === ADMIN_SECRET_TOKEN) {
    return res.redirect('/views/admin/dashboard.html');
  }
  return res.redirect('/views/admin/login.html');
});

// ================= PUBLIC API ENDPOINTS =================

// Register Participant
app.post('/api/register', async (req, res) => {
  try {
    const { nama_lengkap, prodi, fakultas, unit_rumah, unit_kamar, no_telpon } = req.body;

    if (!nama_lengkap || !nama_lengkap.trim()) {
      return res.status(400).json({ success: false, message: 'Nama lengkap wajib diisi!' });
    }

    // Generate unique ticket_id (CSN-2026-XXXX)
    let ticket_id = '';
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      ticket_id = `CSN-2026-${generateRandomCode(4)}`;
      const existing = await dbAsync.get('SELECT id FROM participants WHERE ticket_id = ?', [ticket_id]);
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    const security_token = generateRandomCode(8);
    const createdAt = getFormattedDateTime();

    await dbAsync.run(
      `INSERT INTO participants 
       (ticket_id, security_token, nama_lengkap, prodi, fakultas, unit_rumah, unit_kamar, no_telpon, status_kehadiran, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Tidak Hadir', ?)`,
      [
        ticket_id,
        security_token,
        nama_lengkap.trim(),
        prodi ? prodi.trim() : '',
        fakultas ? fakultas.trim() : '',
        unit_rumah ? unit_rumah.trim() : '',
        unit_kamar ? unit_kamar.trim() : '',
        no_telpon ? no_telpon.trim() : '',
        createdAt
      ]
    );

    return res.json({
      success: true,
      message: 'Pendaftaran berhasil!',
      ticket_id,
      security_token,
      redirectUrl: `/success.html?ticket_id=${ticket_id}&token=${security_token}`
    });
  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal memproses pendaftaran: ' + error.message });
  }
});

// Fetch Ticket Detail
app.get('/api/ticket', async (req, res) => {
  try {
    const { ticket_id, token } = req.query;

    if (!ticket_id) {
      return res.status(400).json({ success: false, message: 'Ticket ID diperlukan.' });
    }

    const participant = await dbAsync.get(
      'SELECT id, ticket_id, security_token, nama_lengkap, prodi, fakultas, unit_rumah, unit_kamar, no_telpon, status_kehadiran, waktu_checkin, created_at FROM participants WHERE ticket_id = ?',
      [ticket_id]
    );

    if (!participant) {
      return res.status(404).json({ success: false, message: 'E-Tiket tidak ditemukan dalam sistem.' });
    }

    return res.json({
      success: true,
      participant
    });
  } catch (error) {
    console.error('Fetch Ticket Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil data tiket.' });
  }
});

// ================= ADMIN API ENDPOINTS =================

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
    }

    const admin = await dbAsync.get('SELECT * FROM admins WHERE username = ?', [username]);

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Username atau password salah!' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Username atau password salah!' });
    }

    // Set cookie
    res.cookie('admin_token', ADMIN_SECRET_TOKEN, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 Hours
      path: '/'
    });

    return res.json({
      success: true,
      message: 'Login berhasil!',
      redirectUrl: '/views/admin/dashboard.html',
      admin: {
        username: admin.username,
        nama_lengkap: admin.nama_lengkap
      }
    });
  } catch (error) {
    console.error('Admin Login Error:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat login.' });
  }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token', { path: '/' });
  return res.json({ success: true, message: 'Logout berhasil.' });
});

// Check Admin Session
app.get('/api/admin/me', requireAdminAuth, async (req, res) => {
  const admin = await dbAsync.get('SELECT id, username, nama_lengkap FROM admins WHERE username = ? OR username = ? LIMIT 1', ['daus', 'admin']);
  return res.json({ success: true, admin: admin || { username: 'daus', nama_lengkap: 'Administrator Casanawasena (Daus)' } });
});

// Admin Stats for Dashboard
app.get('/api/admin/stats', requireAdminAuth, async (req, res) => {
  try {
    const totalRow = await dbAsync.get('SELECT COUNT(*) as count FROM participants');
    const hadirRow = await dbAsync.get("SELECT COUNT(*) as count FROM participants WHERE status_kehadiran = 'Hadir'");

    const total = totalRow ? totalRow.count : 0;
    const hadir = hadirRow ? hadirRow.count : 0;
    const tidak_hadir = total - hadir;
    const persentase = total > 0 ? Math.round((hadir / total) * 100) : 0;

    const recent_checkins = await dbAsync.all(
      "SELECT id, ticket_id, nama_lengkap, prodi, unit_rumah, status_kehadiran, waktu_checkin FROM participants WHERE status_kehadiran = 'Hadir' ORDER BY waktu_checkin DESC LIMIT 6"
    );

    const prodi_breakdown = await dbAsync.all(
      "SELECT prodi, COUNT(*) as count, SUM(CASE WHEN status_kehadiran = 'Hadir' THEN 1 ELSE 0 END) as hadir_count FROM participants GROUP BY prodi ORDER BY count DESC"
    );

    const unit_breakdown = await dbAsync.all(
      "SELECT unit_rumah, COUNT(*) as count, SUM(CASE WHEN status_kehadiran = 'Hadir' THEN 1 ELSE 0 END) as hadir_count FROM participants GROUP BY unit_rumah ORDER BY count DESC"
    );

    return res.json({
      success: true,
      stats: {
        total,
        hadir,
        tidak_hadir,
        persentase,
        recent_checkins,
        prodi_breakdown,
        unit_breakdown
      }
    });
  } catch (error) {
    console.error('Stats Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal memuat statistik.' });
  }
});

// Admin Scan / Check-in QR
app.post('/api/admin/scan', requireAdminAuth, async (req, res) => {
  try {
    const { ticket_id, security_token } = req.body;

    if (!ticket_id || !ticket_id.trim()) {
      return res.status(400).json({ success: false, message: 'Ticket ID tidak boleh kosong.' });
    }

    const participant = await dbAsync.get('SELECT * FROM participants WHERE ticket_id = ?', [ticket_id.trim()]);

    if (!participant) {
      return res.status(404).json({ success: false, message: 'Tiket ID tidak terdaftar dalam sistem!' });
    }

    // Security token check (if provided in QR scan)
    if (security_token && security_token.trim() && participant.security_token !== security_token.trim()) {
      return res.status(400).json({ success: false, message: 'Token Keamanan Tiket Tidak Valid (Palsu/Duplikat)!' });
    }

    // Check if already checked in
    if (participant.status_kehadiran === 'Hadir') {
      return res.status(400).json({
        success: false,
        message: 'PERINGATAN: Peserta ini sudah melakukan Check-In sebelumnya!',
        participant
      });
    }

    const checkinTime = getFormattedDateTime();
    await dbAsync.run(
      "UPDATE participants SET status_kehadiran = 'Hadir', waktu_checkin = ?, petugas_checkin = 'Admin CSN' WHERE id = ?",
      [checkinTime, participant.id]
    );

    const updatedParticipant = await dbAsync.get('SELECT * FROM participants WHERE id = ?', [participant.id]);

    return res.json({
      success: true,
      message: 'Selamat Datang! Check-In Berhasil.',
      participant: updatedParticipant
    });
  } catch (error) {
    console.error('Scan Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal memproses check-in.' });
  }
});

// Admin Get Participants List
app.get('/api/admin/participants', requireAdminAuth, async (req, res) => {
  try {
    const participants = await dbAsync.all('SELECT * FROM participants ORDER BY id DESC');
    return res.json({ success: true, participants });
  } catch (error) {
    console.error('Get Participants Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengambil data peserta.' });
  }
});

// Admin Toggle Check-in Status
app.post('/api/admin/participants/toggle-checkin', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    const participant = await dbAsync.get('SELECT * FROM participants WHERE id = ?', [id]);

    if (!participant) {
      return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
    }

    let newStatus = 'Hadir';
    let newTime = getFormattedDateTime();

    if (participant.status_kehadiran === 'Hadir') {
      newStatus = 'Tidak Hadir';
      newTime = null;
    }

    await dbAsync.run(
      'UPDATE participants SET status_kehadiran = ?, waktu_checkin = ?, petugas_checkin = ? WHERE id = ?',
      [newStatus, newTime, newStatus === 'Hadir' ? 'Admin CSN' : null, id]
    );

    return res.json({
      success: true,
      message: `Status kehadiran berhasil diubah menjadi ${newStatus}.`
    });
  } catch (error) {
    console.error('Toggle Checkin Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal mengubah status.' });
  }
});

// Admin Delete Participant
app.post('/api/admin/participants/delete', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.body;
    await dbAsync.run('DELETE FROM participants WHERE id = ?', [id]);
    return res.json({ success: true, message: 'Data peserta berhasil dihapus.' });
  } catch (error) {
    console.error('Delete Participant Error:', error);
    return res.status(500).json({ success: false, message: 'Gagal menghapus data peserta.' });
  }
});

// Export for Vercel Serverless Function & Local Execution
export async function ensureDbInit() {
  await initDb();
}

export default app;

if (!process.env.VERCEL) {
  ensureDbInit().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`=================================================`);
      console.log(` CASANAWASENA Server Running on http://localhost:${PORT}`);
      console.log(`=================================================`);
    });
  }).catch((err) => {
    console.error('Failed to initialize database:', err);
  });
}
