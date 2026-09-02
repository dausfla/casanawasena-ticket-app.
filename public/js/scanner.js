/**
 * CASANAWASENA - QR Scanner Helper
 * - Pilihan kategori kamera bersih: Hanya Kamera Belakang & Kamera Depan
 * - Tampilan video normal / tidak terbalik (Non-Mirrored)
 * - Kamera belakang stabil tanpa crash / mati mendadak
 * - Dukungan scan dari file gambar QR & input manual
 */

let html5QrCode = null;
let isScanning = false;
let isStartingScanner = false;
let isPaused = false;
let currentFacingMode = 'environment'; // 'environment' (Belakang) atau 'user' (Depan)
let isTorchOn = false;
let audioCtx = null;
let autoContinueTimer = null;
let scanLock = false;

// Audio Beep menggunakan Web Audio API
function playSound(type) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(1174.66, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.setValueAtTime(160, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.4);
    }
  } catch (e) {
    console.warn('Audio playback note:', e);
  }
}

// Cek ketersediaan library Html5Qrcode
function isHtml5QrcodeLoaded() {
  return typeof Html5Qrcode !== 'undefined';
}

// Menyiapkan opsi kamera yang sederhana: Kamera Belakang & Kamera Depan
function initCameraSelect() {
  const selectEl = document.getElementById('camera-select');
  const containerEl = document.getElementById('camera-select-container');
  if (!selectEl || !containerEl) return;

  selectEl.innerHTML = `
    <option value="environment" ${currentFacingMode === 'environment' ? 'selected' : ''}>📷 Kamera Belakang</option>
    <option value="user" ${currentFacingMode === 'user' ? 'selected' : ''}>🤳 Kamera Depan</option>
  `;
  containerEl.classList.remove('hidden');
}

// Ganti kamera saat dropdown berubah
async function onCameraSelectChange() {
  const selectEl = document.getElementById('camera-select');
  if (!selectEl) return;

  const newMode = selectEl.value === 'user' ? 'user' : 'environment';
  if (newMode !== currentFacingMode) {
    currentFacingMode = newMode;
    if (isScanning) {
      await stopCameraScanner();
      await startCameraScanner();
    }
  }
}

// Membersihkan instance Html5Qrcode secara tuntas
async function cleanupScannerInstance() {
  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
    } catch (e) {
      console.warn('Scanner stop note:', e);
    }
    try {
      await html5QrCode.clear();
    } catch (e) {
      console.warn('Scanner clear note:', e);
    }
    html5QrCode = null;
  }

  const readerElement = document.getElementById('qr-reader');
  if (readerElement) {
    readerElement.innerHTML = '';
  }
}

// Memulai Kamera Scanner
async function startCameraScanner() {
  if (isScanning || isStartingScanner) return;
  isStartingScanner = true;

  const readerElement = document.getElementById('qr-reader');
  const placeholderEl = document.getElementById('scanner-placeholder');
  const startBtn = document.getElementById('start-cam-btn');
  const stopBtn = document.getElementById('stop-cam-btn');
  const laserEl = document.getElementById('laser-anim');

  if (!readerElement) {
    isStartingScanner = false;
    return;
  }

  // Indikator loading
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="bi bi-arrow-repeat animate-spin"></i> <span>Membuka Kamera...</span>';
  }
  showScanStatus('Meminta izin dan membuka kamera...', 'info');

  if (!isHtml5QrcodeLoaded()) {
    showScanStatus('Library pemindai QR belum siap. Periksa koneksi internet Anda.', 'error');
    resetStartButton();
    isStartingScanner = false;
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScanStatus('Akses kamera tidak didukung di peramban ini atau membutuhkan koneksi aman (HTTPS).', 'error');
    resetStartButton();
    isStartingScanner = false;
    return;
  }

  try {
    // 1. Bersihkan scanner lama
    await cleanupScannerInstance();

    // 2. Baca mode dari dropdown jika ada
    const selectEl = document.getElementById('camera-select');
    if (selectEl && selectEl.value) {
      currentFacingMode = selectEl.value === 'user' ? 'user' : 'environment';
    }

    // 3. Tampilkan kontainer sebelum start agar Html5Qrcode dapat mengukur dimensi dengan benar
    if (placeholderEl) placeholderEl.classList.add('hidden');
    if (readerElement) {
      readerElement.classList.remove('hidden');
      readerElement.style.display = 'block';
      readerElement.innerHTML = '';
    }

    const qrCodeSuccessCallback = (decodedText) => {
      if (isScanning && !isPaused) {
        handleScannedCode(decodedText);
      }
    };

    const qrCodeErrorCallback = () => {
      // Abaikan frame tanpa kode QR
    };

    // Konfigurasi dinamis & aman agar tidak crash pada sensor resolusi tinggi / orientasi potret
    const scanConfig = {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const edgeSize = Math.max(160, Math.floor(minEdge * 0.72));
        return { width: edgeSize, height: edgeSize };
      },
      disableFlip: true // Non-mirrored
    };

    const scannerInstance = new Html5Qrcode('qr-reader', {
      verbose: false
    });

    // Jalankan start dengan facingMode yang dipilih
    try {
      await scannerInstance.start(
        { facingMode: currentFacingMode },
        scanConfig,
        qrCodeSuccessCallback,
        qrCodeErrorCallback
      );
    } catch (startErr) {
      console.warn(`Gagal start dengan { facingMode: '${currentFacingMode}' }, mencoba fallback...`, startErr);
      // Fallback jika facingMode ditolak browser: coba tanpa facing constraint
      await scannerInstance.start(
        {},
        scanConfig,
        qrCodeSuccessCallback,
        qrCodeErrorCallback
      );
    }

    html5QrCode = scannerInstance;
    isScanning = true;
    isPaused = false;
    isStartingScanner = false;

    // Pastikan video tampil pas dan un-mirrored
    const videoEl = readerElement.querySelector('video');
    if (videoEl) {
      videoEl.style.width = '100%';
      videoEl.style.height = '100%';
      videoEl.style.maxHeight = '380px';
      videoEl.style.objectFit = 'cover';
      videoEl.style.display = 'block';
      videoEl.style.borderRadius = '0.875rem';
      videoEl.style.transform = 'none';
      videoEl.style.webkitTransform = 'none';
    }

    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    if (laserEl) laserEl.classList.remove('hidden');

    checkTorchSupport();

    const activeLabel = currentFacingMode === 'environment' ? 'Kamera Belakang' : 'Kamera Depan';
    showScanStatus(`${activeLabel} aktif. Arahkan QR Code peserta ke dalam kotak.`, 'info');

  } catch (err) {
    console.error('Camera access error:', err);
    isScanning = false;
    isStartingScanner = false;
    await cleanupScannerInstance();
    resetStartButton();

    if (placeholderEl) placeholderEl.classList.remove('hidden');
    if (readerElement) readerElement.classList.add('hidden');

    const rawMsg = (err && err.message) ? err.message : String(err || '');
    const lower = rawMsg.toLowerCase();
    const name = (err && err.name) ? err.name : '';

    let userMsg = 'Gagal mengakses kamera.';
    if (name === 'NotAllowedError' || lower.includes('permission') || lower.includes('notallowed')) {
      userMsg = 'Izin kamera ditolak. Berikan izin kamera di browser/ikon gembok di URL bar, lalu coba lagi.';
    } else if (name === 'NotFoundError' || lower.includes('notfound') || lower.includes('device not found')) {
      userMsg = 'Kamera tidak ditemukan. Anda dapat menggunakan opsi "Scan Gambar" atau input manual.';
    } else if (name === 'NotReadableError' || lower.includes('notreadable') || lower.includes('could not start')) {
      userMsg = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.';
    } else if (lower.includes('overconstrained')) {
      userMsg = 'Mode kamera tidak didukung oleh perangkat. Coba gunakan opsi kamera depan.';
    } else if (lower.includes('secure') || lower.includes('https')) {
      userMsg = 'Akses kamera membutuhkan protokol HTTPS yang aman.';
    } else {
      userMsg = `Gagal membuka kamera: ${rawMsg}`;
    }

    showScanStatus(userMsg, 'error');
  }
}

function resetStartButton() {
  const startBtn = document.getElementById('start-cam-btn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = '<i class="bi bi-play-circle-fill"></i> <span>Aktifkan Kamera</span>';
    startBtn.classList.remove('hidden');
  }
  const stopBtn = document.getElementById('stop-cam-btn');
  if (stopBtn) stopBtn.classList.add('hidden');
}

// Mematikan Kamera Scanner
async function stopCameraScanner() {
  isStartingScanner = false;
  await cleanupScannerInstance();

  isScanning = false;
  isPaused = false;
  isTorchOn = false;

  if (autoContinueTimer) {
    clearTimeout(autoContinueTimer);
    autoContinueTimer = null;
  }

  const readerElement = document.getElementById('qr-reader');
  const placeholderEl = document.getElementById('scanner-placeholder');
  const laserEl = document.getElementById('laser-anim');
  const torchBtn = document.getElementById('torch-btn');

  if (readerElement) readerElement.classList.add('hidden');
  if (placeholderEl) placeholderEl.classList.remove('hidden');
  if (laserEl) laserEl.classList.add('hidden');
  if (torchBtn) torchBtn.classList.add('hidden');

  resetStartButton();
  showScanStatus('Kamera Dinonaktifkan.', 'info');
}

// Memproses Kode QR yang terdeteksi
async function handleScannedCode(decodedText) {
  if (scanLock || !decodedText) return;
  scanLock = true;

  pauseScanner();
  console.log('Decoded QR Text:', decodedText);

  let ticketId = decodedText.trim();
  let securityToken = '';

  // Ekstrak dari URL format atau pipe format
  try {
    if (ticketId.includes('http://') || ticketId.includes('https://')) {
      const urlObj = new URL(ticketId);
      const urlTicket = urlObj.searchParams.get('ticket_id');
      const urlToken = urlObj.searchParams.get('token');
      if (urlTicket) {
        ticketId = urlTicket.trim();
        securityToken = urlToken ? urlToken.trim() : '';
      }
    } else if (ticketId.includes('|')) {
      const parts = ticketId.split('|');
      ticketId = parts[0].trim();
      securityToken = parts[1] ? parts[1].trim() : '';
    }
  } catch (e) {
    console.warn('QR parse fallback:', e);
  }

  await processCheckIn(ticketId, securityToken);
  scanLock = false;
}

// Upload & Scan Berkas Gambar QR
async function handleQrFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  showScanStatus('Memproses berkas gambar QR...', 'info');

  try {
    let fileScanner = html5QrCode;
    if (!fileScanner) {
      fileScanner = new Html5Qrcode('qr-reader', {
        verbose: false
      });
    }

    const decodedText = await fileScanner.scanFile(file, true);
    if (decodedText) {
      showScanStatus('QR Code berhasil dibaca dari gambar!', 'info');
      handleScannedCode(decodedText);
    } else {
      showScanStatus('Tidak ditemukan QR Code yang valid pada gambar tersebut.', 'error');
    }
  } catch (err) {
    console.error('File QR Scan Error:', err);
    showScanStatus('Gagal membaca QR dari gambar. Pastikan gambar QR jelas dan tidak buram.', 'error');
  } finally {
    event.target.value = '';
  }
}

// Cek dukungan Senter / Flashlight
async function checkTorchSupport() {
  const torchBtn = document.getElementById('torch-btn');
  if (!torchBtn || !html5QrCode) return;

  try {
    const capabilities = html5QrCode.getRunningTrackCameraCapabilities();
    if (capabilities && capabilities.torchFeature && capabilities.torchFeature().isSupported()) {
      torchBtn.classList.remove('hidden');
    } else {
      torchBtn.classList.add('hidden');
    }
  } catch (e) {
    torchBtn.classList.add('hidden');
  }
}

// Tombol Flashlight / Senter
async function toggleTorch() {
  if (!html5QrCode || !isScanning) return;
  try {
    const capabilities = html5QrCode.getRunningTrackCameraCapabilities();
    if (capabilities && capabilities.torchFeature && capabilities.torchFeature().isSupported()) {
      isTorchOn = !isTorchOn;
      await capabilities.torchFeature().apply(isTorchOn);
      const icon = document.getElementById('torch-icon');
      const label = document.getElementById('torch-label');
      if (icon) icon.className = isTorchOn ? 'bi bi-lightning-fill text-amber-500' : 'bi bi-lightning-charge-fill';
      if (label) label.textContent = isTorchOn ? 'Flash ON' : 'Flash';
    }
  } catch (e) {
    console.warn('Toggle torch error:', e);
  }
}

function pauseScanner() {
  if (html5QrCode && isScanning && !isPaused) {
    try {
      html5QrCode.pause(true);
      isPaused = true;
    } catch (e) {
      console.warn('Pause scanner error:', e);
    }
  }
}

function resumeScanner() {
  if (html5QrCode && isScanning && isPaused) {
    try {
      html5QrCode.resume();
      isPaused = false;
      const activeLabel = currentFacingMode === 'environment' ? 'Kamera Belakang' : 'Kamera Depan';
      showScanStatus(`${activeLabel} Aktif. Arahkan QR Code ke dalam kotak.`, 'info');
    } catch (e) {
      console.warn('Resume scanner error:', e);
    }
  }
}

// Kirim request Check-in ke Server
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

      if (autoContinueTimer) clearTimeout(autoContinueTimer);
      autoContinueTimer = setTimeout(() => {
        closeResultModal();
      }, 2000);
    } else {
      playSound('error');
      showResultModal(false, result.message, result.participant || null);
    }
  } catch (err) {
    playSound('error');
    showResultModal(false, 'Terjadi kesalahan jaringan/server: ' + err.message);
  }
}

// Tampilkan Modal Hasil Scan
function showResultModal(isSuccess, message, participant) {
  const modal = document.getElementById('scan-result-modal');
  const container = document.getElementById('modal-content-box');
  if (!modal || !container) return;

  if (isSuccess) {
    container.className = 'glass-card-light border-2 border-emerald-500 p-6 rounded-2xl max-w-md w-full mx-4 shadow-2xl transition-all scale-100 bg-white';
    container.innerHTML = `
      <div class="text-center">
        <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm">
          <i class="bi bi-check-circle-fill"></i>
        </div>
        <h3 class="text-2xl font-bold text-emerald-700 mb-1">CHECK-IN BERHASIL</h3>
        <p class="text-slate-600 text-xs sm:text-sm mb-4">${message}</p>
        
        ${participant ? `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2 mb-6 text-xs">
          <div class="flex justify-between border-b pb-2">
            <span class="text-slate-500 font-medium">Nama Peserta</span>
            <span class="text-sm font-bold text-slate-800">${participant.nama_lengkap}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-slate-500 font-medium">Ticket ID</span>
            <span class="font-mono font-bold text-emerald-700">${participant.ticket_id}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-slate-500 font-medium">Prodi / Fakultas</span>
            <span class="font-semibold text-slate-700">${participant.prodi || '-'} / ${participant.fakultas || '-'}</span>
          </div>
          <div class="flex justify-between border-b pb-2">
            <span class="text-slate-500 font-medium">Unit Properti</span>
            <span class="font-semibold text-slate-700">${participant.unit_rumah || '-'} (Kamar: ${participant.unit_kamar || '-'})</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500 font-medium">Waktu Check-in</span>
            <span class="font-mono font-bold text-slate-700">${participant.waktu_checkin || 'Baru saja'}</span>
          </div>
        </div>
        ` : ''}

        <button onclick="closeResultModal()" class="w-full btn-green hover:opacity-95 text-white font-bold py-3.5 rounded-xl shadow-lg transition cursor-pointer text-sm">
          Selesai & Lanjutkan Scan
        </button>
        <p class="text-[11px] text-slate-400 mt-2">Lanjut otomatis dalam 2 detik...</p>
      </div>
    `;
  } else {
    container.className = 'glass-card-light border-2 border-rose-500 p-6 rounded-2xl max-w-md w-full mx-4 shadow-2xl transition-all scale-100 bg-white';
    container.innerHTML = `
      <div class="text-center">
        <div class="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm">
          <i class="bi bi-x-circle-fill"></i>
        </div>
        <h3 class="text-2xl font-bold text-rose-700 mb-1">CHECK-IN GAGAL</h3>
        <p class="text-slate-700 text-xs sm:text-sm font-semibold mb-4">${message}</p>
        
        ${participant ? `
        <div class="bg-rose-50/70 border border-rose-200 rounded-xl p-4 text-left space-y-2 mb-6 text-xs">
          <div class="flex justify-between border-b border-rose-200 pb-2">
            <span class="text-slate-500 font-medium">Nama Peserta</span>
            <span class="text-sm font-bold text-slate-800">${participant.nama_lengkap}</span>
          </div>
          <div class="flex justify-between border-b border-rose-200 pb-2">
            <span class="text-slate-500 font-medium">Ticket ID</span>
            <span class="font-mono font-bold text-rose-600">${participant.ticket_id}</span>
          </div>
          <div class="flex justify-between border-b border-rose-200 pb-2">
            <span class="text-slate-500 font-medium">Status</span>
            <span class="font-bold text-rose-700">${participant.status_kehadiran}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500 font-medium">Waktu Check-in Pertama</span>
            <span class="font-mono font-bold text-slate-700">${participant.waktu_checkin || '-'}</span>
          </div>
        </div>
        ` : ''}

        <button onclick="closeResultModal()" class="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3.5 rounded-xl shadow-lg transition cursor-pointer text-sm">
          Tutup & Coba Lagi
        </button>
      </div>
    `;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeResultModal() {
  if (autoContinueTimer) {
    clearTimeout(autoContinueTimer);
    autoContinueTimer = null;
  }

  const modal = document.getElementById('scan-result-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  resumeScanner();
}

function showScanStatus(msg, type) {
  const el = document.getElementById('scan-status-text');
  if (el) {
    el.textContent = msg;
    if (type === 'error') {
      el.className = 'text-rose-600 font-semibold';
    } else {
      el.className = 'text-slate-600';
    }
  }
}

// Export fungsi ke objek window
window.startCameraScanner = startCameraScanner;
window.stopCameraScanner = stopCameraScanner;
window.processCheckIn = processCheckIn;
window.closeResultModal = closeResultModal;
window.handleQrFileUpload = handleQrFileUpload;
window.toggleTorch = toggleTorch;
window.onCameraSelectChange = onCameraSelectChange;

// Inisialisasi opsi kamera saat halaman dimuat
document.addEventListener('DOMContentLoaded', () => {
  initCameraSelect();
});
