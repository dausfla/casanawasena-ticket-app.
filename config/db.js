process.env.TZ = 'Asia/Jakarta';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  writeBatch 
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

let firebaseApp = null;
let firestoreDb = null;

function getDb() {
  if (!firestoreDb) {
    let config = {};
    try {
      const configPath = path.resolve('firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (e) {
      console.error('[DB] Error reading firebase-applet-config.json:', e);
    }

    const firebaseConfig = {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId
    };

    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    firestoreDb = config.firestoreDatabaseId 
      ? getFirestore(firebaseApp, config.firestoreDatabaseId) 
      : getFirestore(firebaseApp);
  }
  return firestoreDb;
}

export const dbAsync = {
  async get(sql, params = []) {
    const db = getDb();

    // 1. SELECT * FROM admins WHERE username = ?
    if (sql.includes('FROM admins WHERE username = ?')) {
      const q = query(collection(db, 'admins'), where('username', '==', params[0]));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }

    // 2. SELECT id, username, nama_lengkap FROM admins WHERE username = ? OR username = ?
    if (sql.includes('FROM admins WHERE username = ? OR username = ?')) {
      const q1 = query(collection(db, 'admins'), where('username', '==', params[0] || 'daus'));
      const snap1 = await getDocs(q1);
      if (!snap1.empty) return { id: snap1.docs[0].id, ...snap1.docs[0].data() };
      const q2 = query(collection(db, 'admins'), where('username', '==', params[1] || 'admin'));
      const snap2 = await getDocs(q2);
      if (!snap2.empty) return { id: snap2.docs[0].id, ...snap2.docs[0].data() };
      return { id: 'default', username: 'daus', nama_lengkap: 'Administrator Casanawasena (Daus)' };
    }

    // 3. SELECT * FROM participants WHERE ticket_id = ?
    if (sql.includes('FROM participants') && sql.includes('WHERE ticket_id = ?')) {
      const q = query(collection(db, 'participants'), where('ticket_id', '==', params[0]));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }

    // 4. SELECT * FROM participants WHERE id = ?
    if (sql.includes('FROM participants') && sql.includes('WHERE id = ?')) {
      if (!params[0]) return null;
      const docRef = doc(db, 'participants', String(params[0]));
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        const q = query(collection(db, 'participants'), where('ticket_id', '==', String(params[0])));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        return { id: snap.docs[0].id, ...snap.docs[0].data() };
      }
      return { id: docSnap.id, ...docSnap.data() };
    }

    // 5. COUNT(*) from participants
    if (sql.includes('COUNT(*) as count FROM participants')) {
      const snap = await getDocs(collection(db, 'participants'));
      if (sql.includes("WHERE status_kehadiran = 'Hadir'")) {
        const hadirCount = snap.docs.filter(d => d.data().status_kehadiran === 'Hadir').length;
        return { count: hadirCount };
      }
      return { count: snap.docs.length };
    }

    return null;
  },

  async all(sql, params = []) {
    const db = getDb();
    const snap = await getDocs(collection(db, 'participants'));
    const allParticipants = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // SELECT * FROM participants ORDER BY id DESC / waktu_checkin
    if (sql.includes('FROM participants') && sql.includes('ORDER BY')) {
      if (sql.includes("status_kehadiran = 'Hadir'")) {
        const hadirList = allParticipants.filter(p => p.status_kehadiran === 'Hadir');
        hadirList.sort((a, b) => (b.waktu_checkin || '').localeCompare(a.waktu_checkin || ''));
        if (sql.includes('LIMIT 6')) {
          return hadirList.slice(0, 6);
        }
        return hadirList;
      }
      allParticipants.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return allParticipants;
    }

    // Grouping stats for dashboard
    if (sql.includes('GROUP BY prodi')) {
      const map = {};
      allParticipants.forEach(p => {
        const key = p.prodi || 'Tidak Diisi';
        if (!map[key]) map[key] = { prodi: key, count: 0, hadir_count: 0 };
        map[key].count++;
        if (p.status_kehadiran === 'Hadir') map[key].hadir_count++;
      });
      return Object.values(map).sort((a, b) => b.count - a.count);
    }

    if (sql.includes('GROUP BY unit_rumah')) {
      const map = {};
      allParticipants.forEach(p => {
        const key = p.unit_rumah || 'Tidak Diisi';
        if (!map[key]) map[key] = { unit_rumah: key, count: 0, hadir_count: 0 };
        map[key].count++;
        if (p.status_kehadiran === 'Hadir') map[key].hadir_count++;
      });
      return Object.values(map).sort((a, b) => b.count - a.count);
    }

    return allParticipants;
  },

  async run(sql, params = []) {
    const db = getDb();

    // INSERT INTO admins
    if (sql.includes('INSERT INTO admins')) {
      const newRef = doc(collection(db, 'admins'));
      await setDoc(newRef, {
        username: params[0],
        password: params[1],
        nama_lengkap: params[2],
        created_at: new Date().toISOString()
      });
      return { lastID: newRef.id, changes: 1 };
    }

    // UPDATE admins
    if (sql.includes('UPDATE admins')) {
      const q = query(collection(db, 'admins'), where('username', '==', params[2]));
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(doc(db, 'admins', snap.docs[0].id), {
          password: params[0],
          nama_lengkap: params[1]
        });
      }
      return { changes: 1 };
    }

    // INSERT INTO participants
    if (sql.includes('INSERT INTO participants')) {
      const participantRef = doc(collection(db, 'participants'));
      await setDoc(participantRef, {
        ticket_id: params[0],
        security_token: params[1],
        nama_lengkap: params[2],
        prodi: params[3],
        fakultas: params[4],
        unit_rumah: params[5],
        unit_kamar: params[6],
        no_telpon: params[7],
        status_kehadiran: 'Tidak Hadir',
        waktu_checkin: null,
        petugas_checkin: null,
        created_at: params[8] || new Date().toISOString()
      });
      return { lastID: participantRef.id, changes: 1 };
    }

    // UPDATE participants
    if (sql.includes('UPDATE participants')) {
      const targetId = String(params[params.length - 1]);
      let realRef = doc(db, 'participants', targetId);
      const docSnap = await getDoc(realRef);

      if (!docSnap.exists()) {
        const q = query(collection(db, 'participants'), where('ticket_id', '==', targetId));
        const snap = await getDocs(q);
        if (!snap.empty) {
          realRef = doc(db, 'participants', snap.docs[0].id);
        }
      }

      if (sql.includes("status_kehadiran = 'Hadir'") && params.length === 2) {
        await updateDoc(realRef, {
          status_kehadiran: 'Hadir',
          waktu_checkin: params[0],
          petugas_checkin: 'Admin CSN'
        });
      } else if (params.length === 4) {
        await updateDoc(realRef, {
          status_kehadiran: params[0],
          waktu_checkin: params[1],
          petugas_checkin: params[2]
        });
      }
      return { changes: 1 };
    }

    // DELETE FROM participants WHERE id = ?
    if (sql.includes('DELETE FROM participants WHERE id = ?')) {
      const targetId = String(params[0]);
      const docRef = doc(db, 'participants', targetId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        await deleteDoc(docRef);
      } else {
        const q = query(collection(db, 'participants'), where('ticket_id', '==', targetId));
        const snap = await getDocs(q);
        if (!snap.empty) {
          await deleteDoc(doc(db, 'participants', snap.docs[0].id));
        }
      }
      return { changes: 1 };
    }

    // DELETE FROM participants (Clear All)
    if (sql.includes('DELETE FROM participants')) {
      const snap = await getDocs(collection(db, 'participants'));
      const batch = writeBatch(db);
      snap.docs.forEach(d => {
        batch.delete(d.ref);
      });
      await batch.commit();
      return { changes: snap.docs.length };
    }

    return { changes: 0 };
  },

  async exec(sql) {
    if (sql.includes('DELETE FROM participants')) {
      await this.run('DELETE FROM participants');
    }
  }
};

export async function initDb() {
  const db = getDb();
  // Ensure default admin user 'daus' exists in Firestore
  const q = query(collection(db, 'admins'), where('username', '==', 'daus'));
  const snap = await getDocs(q);
  const hashedPassword = await bcrypt.hash('daus123', 10);

  if (snap.empty) {
    const adminRef = doc(collection(db, 'admins'));
    await setDoc(adminRef, {
      username: 'daus',
      password: hashedPassword,
      nama_lengkap: 'Administrator Casanawasena (Daus)',
      created_at: new Date().toISOString()
    });
    console.log('[Firestore] Seeded default admin user: username=daus, password=daus123');
  } else {
    await updateDoc(doc(db, 'admins', snap.docs[0].id), {
      password: hashedPassword,
      nama_lengkap: 'Administrator Casanawasena (Daus)'
    });
  }
}

export default dbAsync;
