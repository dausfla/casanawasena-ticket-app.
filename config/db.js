process.env.TZ = 'Asia/Jakarta';

import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

let db = null;
let dbInitPromise = null;

function getWibTimeString(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
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

function getDbPath() {
  if (process.env.VERCEL) {
    const tmpPath = '/tmp/database.db';
    const rootPath = path.resolve('database.db');
    if (!fs.existsSync(tmpPath) && fs.existsSync(rootPath)) {
      try {
        fs.copyFileSync(rootPath, tmpPath);
        console.log('[DB] Copied root database.db to /tmp/database.db for Vercel execution.');
      } catch (err) {
        console.error('[DB] Error copying database.db to /tmp:', err);
      }
    }
    return tmpPath;
  }
  return path.resolve('database.db');
}

function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    db = new sqlite3.Database(dbPath);
  }
  return db;
}

export const dbAsync = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      getDb().run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      getDb().get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  exec(sql) {
    return new Promise((resolve, reject) => {
      getDb().exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

export async function initDb() {
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    // 1. Create admins table
    await dbAsync.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nama_lengkap TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create participants table
    await dbAsync.exec(`
      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT UNIQUE NOT NULL,
        security_token TEXT NOT NULL,
        nama_lengkap TEXT NOT NULL,
        prodi TEXT,
        fakultas TEXT,
        unit_rumah TEXT,
        unit_kamar TEXT,
        no_telpon TEXT,
        status_kehadiran TEXT DEFAULT 'Tidak Hadir',
        waktu_checkin DATETIME,
        petugas_checkin TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Seed default Admin if not exists
    const existingDaus = await dbAsync.get('SELECT * FROM admins WHERE username = ?', ['daus']);
    const hashedPassword = await bcrypt.hash('daus123', 10);
    if (!existingDaus) {
      await dbAsync.run(
        'INSERT INTO admins (username, password, nama_lengkap) VALUES (?, ?, ?)',
        ['daus', hashedPassword, 'Administrator Casanawasena (Daus)']
      );
      console.log('[DB] Seeded default admin user: username=daus, password=daus123');
    } else {
      await dbAsync.run(
        'UPDATE admins SET password = ?, nama_lengkap = ? WHERE username = ?',
        [hashedPassword, 'Administrator Casanawasena (Daus)', 'daus']
      );
      console.log('[DB] Updated admin user daus password');
    }

    // 4. Seed sample participants if participants table is empty
    const countRow = await dbAsync.get('SELECT COUNT(*) as count FROM participants');
    if (countRow && countRow.count === 0) {
      const sampleData = [
        {
          ticket_id: 'CSN-2026-8812',
          security_token: 'XK92M7A1',
          nama_lengkap: 'Budi Santoso',
          prodi: 'Arsitektur',
          fakultas: 'Teknik & Perencanaan',
          unit_rumah: 'Cluster Emerald',
          unit_kamar: 'A-12',
          no_telpon: '081234567890',
          status_kehadiran: 'Hadir',
          waktu_checkin: getWibTimeString(-1000 * 60 * 45),
          petugas_checkin: 'Admin CSN'
        },
        {
          ticket_id: 'CSN-2026-9043',
          security_token: 'PL48B2Q9',
          nama_lengkap: 'Siti Rahmawati',
          prodi: 'Teknik Sipil',
          fakultas: 'Teknik & Perencanaan',
          unit_rumah: 'Cluster Sapphire',
          unit_kamar: 'B-05',
          no_telpon: '082198765432',
          status_kehadiran: 'Hadir',
          waktu_checkin: getWibTimeString(-1000 * 60 * 15),
          petugas_checkin: 'Admin CSN'
        },
        {
          ticket_id: 'CSN-2026-3108',
          security_token: 'MN77R3T4',
          nama_lengkap: 'Ahmad Rizky Pratama',
          prodi: 'Desain Interior',
          fakultas: 'Seni & Desain',
          unit_rumah: 'Cluster Diamond',
          unit_kamar: 'C-08',
          no_telpon: '085711223344',
          status_kehadiran: 'Tidak Hadir',
          waktu_checkin: null,
          petugas_checkin: null
        },
        {
          ticket_id: 'CSN-2026-5541',
          security_token: 'WK19C5E8',
          nama_lengkap: 'Dian Permata',
          prodi: 'Manajemen Properti',
          fakultas: 'Ekonomi & Bisnis',
          unit_rumah: 'Cluster Ruby',
          unit_kamar: 'R-02',
          no_telpon: '081399887766',
          status_kehadiran: 'Tidak Hadir',
          waktu_checkin: null,
          petugas_checkin: null
        }
      ];

      for (const item of sampleData) {
        await dbAsync.run(
          `INSERT INTO participants 
           (ticket_id, security_token, nama_lengkap, prodi, fakultas, unit_rumah, unit_kamar, no_telpon, status_kehadiran, waktu_checkin, petugas_checkin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.ticket_id,
            item.security_token,
            item.nama_lengkap,
            item.prodi,
            item.fakultas,
            item.unit_rumah,
            item.unit_kamar,
            item.no_telpon,
            item.status_kehadiran,
            item.waktu_checkin,
            item.petugas_checkin
          ]
        );
      }
      console.log('[DB] Seeded sample participants');
    }
  })();

  return dbInitPromise;
}

export default dbAsync;
