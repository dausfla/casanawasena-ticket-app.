/**
 * CASANAWASENA - QR Scanner Helper
 */

let html5QrCode = null;
let isScanning = false;
let audioCtx = null;

// Audio Beep using Web Audio API
function playSound(type) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      // High double beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc.frequency.setValueAtTime(1174.66, audioCtx.currentTime + 0.1); // D6
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'error') {
      // Low saw/buzz sound
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.setValueAtTime(160, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.4);
    }
  } catch (e) {
    console.error('Audio playback error:', e);
  }
}

// Start Camera Scanning
async function startCameraScanner() {
  const readerElement = document.getElementById('qr-reader');
  if (!readerElement) return;

  if (isScanning) return;

  try {
    html5QrCode = new Html5Qrcode('qr-reader');
    const qrCodeSuccessCallback = (decodedText, decodedResult) => {
      if (isScanning) {
        // Debounce scan
        handleScannedCode(decodedText);
      }
    };

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    await html5QrCode.start(
      { facingMode: 'environment' },
      config,
      qrCodeSuccessCallback,
      (errorMessage) => {
        // Ignore frame error
      }
    );

    isScanning = true;
    document.getElementById('start-cam-btn')?.classList.add('hidden');
    document.getElementById('stop-cam-btn')?.classList.remove('hidden');
    document.getElementById('laser-anim')?.classList.remove('hidden');
    showScanStatus('Kamera Aktif. Arahkan QR Code ke dalam kotak.', 'info');
  } catch (err) {
    console.error('Camera access error:', err);
    showScanStatus('Gagal mengakses kamera: ' + (err.message || 'Izin ditolak atau kamera tidak ditemukan'), 'error');
  }
}

// Stop Camera Scanning
async function stopCameraScanner() {
  if (html5QrCode && isScanning) {
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) {
      console.error('Stop scanner error:', e);
    }
    isScanning = false;
    document.getElementById('start-cam-btn')?.classList.remove('hidden');
    document.getElementById('stop-cam-btn')?.classList.add('hidden');
    document.getElementById('laser-anim')?.classList.add('hidden');
    showScanStatus('Kamera Dinonaktifkan.', 'info');
  }
}

// Handle Scanned Result
let scanLock = false;
async function handleScannedCode(decodedText) {
  if (scanLock) return;
  scanLock = true;

  console.log('Decoded QR:', decodedText);

  // Payload format expected: "ticket_id|security_token" or "ticket_id"
  let ticketId = decodedText.trim();
  let securityToken = '';

  if (ticketId.includes('|')) {
    const parts = ticketId.split('|');
    ticketId = parts[0].trim();
    securityToken = parts[1] ? parts[1].trim() : '';
  }

  await processCheckIn(ticketId, securityToken);

  // Pause briefly before next scan
  setTimeout(() => {
    scanLock = false;
  }, 2500);
}

// Send Check-in API
async function processCheckIn(ticketId, securityToken) {
  try {
    const response = await fetch('/api/admin/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ticket_id: ticketId,
        security_token: securityToken
      })
    });

    const result = await response.json();

    if (result.success) {
      playSound('success');
      showResultModal(true, result.message, result.participant);
      if (typeof window.loadRecentCheckins === 'function') {
        window.loadRecentCheckins();
      }
    } else {
      playSound('error');
      showResultModal(false, result.message, result.participant || null);
    }
  } catch (err) {
    playSound('error');
    showResultModal(false, 'Terjadi kesalahan server/jaringan: ' + err.message);
  }
}

// Show Result Modal
function showResultModal(isSuccess, message, participant) {
  const modal = document.getElementById('scan-result-modal');
  const container = document.getElementById('modal-content-box');
  if (!modal || !container) return;

  if (isSuccess) {
    container.className = 'glass-card-light border-2 border-emerald-500 p-6 rounded-2xl max-w-md w-full mx-4 shadow-2xl transition-all scale-100';
    container.innerHTML = `
      <div class="text-center">
        <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
          <i class="bi bi-check-circle-fill"></i>
        </div>
        <h3 class="text-2xl font-bold text-emerald-700 mb-1">CHECK-IN BERHASIL</h3>
        <p class="text-slate-600 text-sm mb-4">${message}</p>
        
        ${participant ? `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2 mb-6">
          <div class="flex justify-between border-b pb-2">
            <span class="text-xs text-slate-500 font-medium">Nama Peserta</span>
            <span class="text-sm font-bold text-slate-800">${participant.nama_lengkap}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-xs text-slate-500 font-medium">Ticket ID</span>
            <span class="text-sm font-mono font-bold text-amber-600">${participant.ticket_id}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-xs text-slate-500 font-medium">Prodi / Fakultas</span>
            <span class="text-xs font-semibold text-slate-700">${participant.prodi || '-'} / ${participant.fakultas || '-'}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-xs text-slate-500 font-medium">Unit Properti</span>
            <span class="text-xs font-semibold text-slate-700">${participant.unit_rumah || '-'} (Kamar: ${participant.unit_kamar || '-'})</span>
          </div>
          <div class="flex justify-between">
            <span class="text-xs text-slate-500 font-medium">Waktu Check-in</span>
            <span class="text-xs font-mono font-bold text-slate-700">${participant.waktu_checkin || 'Baru saja'}</span>
          </div>
        </div>
        ` : ''}

        <button onclick="closeResultModal()" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl shadow-lg transition">
          Selesai & Lanjutkan Scan
        </button>
      </div>
    `;
  } else {
    container.className = 'glass-card-light border-2 border-rose-500 p-6 rounded-2xl max-w-md w-full mx-4 shadow-2xl transition-all scale-100';
    container.innerHTML = `
      <div class="text-center">
        <div class="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
          <i class="bi bi-x-circle-fill"></i>
        </div>
        <h3 class="text-2xl font-bold text-rose-700 mb-1">CHECK-IN GAGAL</h3>
        <p class="text-slate-700 text-sm font-semibold mb-4">${message}</p>
        
        ${participant ? `
        <div class="bg-rose-50 border border-rose-200 rounded-xl p-4 text-left space-y-2 mb-6">
          <div class="flex justify-between border-b border-rose-200 pb-2">
            <span class="text-xs text-slate-500 font-medium">Nama Peserta</span>
            <span class="text-sm font-bold text-slate-800">${participant.nama_lengkap}</span>
          </div>
          <div class="flex justify-between border-b border-rose-200 pb-2">
            <span class="text-xs text-slate-500 font-medium">Ticket ID</span>
            <span class="text-sm font-mono font-bold text-rose-600">${participant.ticket_id}</span>
          </div>
          <div class="flex justify-between border-b border-rose-200 pb-2">
            <span class="text-xs text-slate-500 font-medium">Status Sebelumnya</span>
            <span class="text-xs font-bold text-rose-700">${participant.status_kehadiran}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-xs text-slate-500 font-medium">Waktu Check-in Pertama</span>
            <span class="text-xs font-mono font-bold text-slate-700">${participant.waktu_checkin || '-'}</span>
          </div>
        </div>
        ` : ''}

        <button onclick="closeResultModal()" class="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-3 rounded-xl shadow-lg transition">
          Tutup & Coba Lagi
        </button>
      </div>
    `;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeResultModal() {
  const modal = document.getElementById('scan-result-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function showScanStatus(msg, type) {
  const el = document.getElementById('scan-status-text');
  if (el) {
    el.textContent = msg;
  }
}

window.startCameraScanner = startCameraScanner;
window.stopCameraScanner = stopCameraScanner;
window.processCheckIn = processCheckIn;
window.closeResultModal = closeResultModal;
