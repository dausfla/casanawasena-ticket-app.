/**
 * CASANAWASENA - QR Scanner Helper
 * High-performance, robust camera scanner with multi-device detection,
 * automatic fallback, torch toggle, and QR file scanner.
 */

let html5QrCode = null;
let isScanning = false;
let isPaused = false;
let currentCameraId = null;
let availableCameras = [];
let isTorchOn = false;
let audioCtx = null;
let autoContinueTimer = null;
let scanLock = false;

// Audio Beep using Web Audio API
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
    console.warn('Audio playback not permitted or unavailable:', e);
  }
}

// Check library availability
function isHtml5QrcodeLoaded() {
  return typeof Html5Qrcode !== 'undefined';
}

// Initialize and discover available camera devices
async function discoverCameras() {
  if (!isHtml5QrcodeLoaded()) return [];
  try {
    const cameras = await Html5Qrcode.getCameras();
    availableCameras = cameras || [];
    renderCameraSelectOptions();
    return availableCameras;
  } catch (e) {
    console.warn('Unable to query camera list:', e);
    return [];
  }
}

// Populate camera select dropdown
function renderCameraSelectOptions() {
  const selectEl = document.getElementById('camera-select');
  const containerEl = document.getElementById('camera-select-container');
  if (!selectEl || !containerEl) return;

  if (availableCameras.length > 1) {
    selectEl.innerHTML = '';
    availableCameras.forEach((cam, idx) => {
      const opt = document.createElement('option');
      opt.value = cam.id;
      const label = cam.label || `Kamera ${idx + 1}`;
      opt.textContent = label;
      selectEl.appendChild(opt);
    });

    if (currentCameraId) {
      selectEl.value = currentCameraId;
    }
    containerEl.classList.remove('hidden');
  } else {
    containerEl.classList.add('hidden');
  }
}

// Handle camera selection change from dropdown
async function onCameraSelectChange() {
  const selectEl = document.getElementById('camera-select');
  if (!selectEl) return;
  const newCameraId = selectEl.value;
  if (newCameraId && newCameraId !== currentCameraId) {
    currentCameraId = newCameraId;
    if (isScanning) {
      await stopCameraScanner();
      await startCameraScanner();
    }
  }
}

// Start Camera Scanning
async function startCameraScanner() {
  if (isScanning) return;

  const readerElement = document.getElementById('qr-reader');
  const placeholderEl = document.getElementById('scanner-placeholder');
  const startBtn = document.getElementById('start-cam-btn');
  const stopBtn = document.getElementById('stop-cam-btn');
  const laserEl = document.getElementById('laser-anim');

  if (!readerElement) {
    console.error('Reader element #qr-reader not found');
    return;
  }

  // Visual feedback: loading
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<i class="bi bi-arrow-repeat animate-spin"></i> <span>Membuka Kamera...</span>';
  }
  showScanStatus('Meminta izin dan membuka kamera...', 'info');

  if (!isHtml5QrcodeLoaded()) {
    showScanStatus('Library pemindai QR belum siap. Periksa koneksi internet Anda.', 'error');
    resetStartButton();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScanStatus('Akses kamera tidak didukung di peramban ini atau membutuhkan koneksi aman (HTTPS).', 'error');
    resetStartButton();
    return;
  }

  try {
    // Cleanup previous instance if any
    if (html5QrCode) {
      try {
        if (html5QrCode.isScanning) {
          await html5QrCode.stop();
        }
        await html5QrCode.clear();
      } catch (cleanErr) {
        console.warn('Instance cleanup warning:', cleanErr);
      }
      html5QrCode = null;
    }

    // Safe formats config to avoid undeclared variable ReferenceError
    const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined')
      ? [Html5QrcodeSupportedFormats.QR_CODE]
      : undefined;

    html5QrCode = new Html5Qrcode('qr-reader', {
      formatsToSupport: formats,
      verbose: false
    });

    // Query cameras if not discovered yet
    if (availableCameras.length === 0) {
      await discoverCameras();
    }

    // Choose best camera ID or facingMode
    let cameraToUse = null;
    const selectEl = document.getElementById('camera-select');
    if (selectEl && selectEl.value) {
      cameraToUse = selectEl.value;
    } else if (availableCameras.length > 0) {
      // Find back camera if on mobile
      const backCam = availableCameras.find(c => {
        const l = (c.label || '').toLowerCase();
        return l.includes('back') || l.includes('rear') || l.includes('belakang') || l.includes('environment');
      });
      cameraToUse = backCam ? backCam.id : availableCameras[0].id;
      currentCameraId = cameraToUse;
      if (selectEl) selectEl.value = cameraToUse;
    }

    const qrCodeSuccessCallback = (decodedText) => {
      if (isScanning && !isPaused) {
        handleScannedCode(decodedText);
      }
    };

    const qrCodeErrorCallback = () => {
      // Suppress frame-by-frame non-detection logs
    };

    const scanConfig = {
      fps: 20,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const size = Math.max(180, Math.floor(minEdge * 0.72));
        return { width: size, height: size };
      },
      aspectRatio: 1.0,
      disableFlip: false,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    };

    // Attempt sequential start strategies
    let started = false;
    let lastError = null;

    // Strategy 1: Chosen camera ID from getCameras
    if (cameraToUse) {
      try {
        await html5QrCode.start(cameraToUse, scanConfig, qrCodeSuccessCallback, qrCodeErrorCallback);
        started = true;
      } catch (err1) {
        console.warn('Strategy 1 (device ID) failed, trying facingMode:', err1);
        lastError = err1;
      }
    }

    // Strategy 2: Environment / Back Camera
    if (!started) {
      try {
        await html5QrCode.start({ facingMode: 'environment' }, scanConfig, qrCodeSuccessCallback, qrCodeErrorCallback);
        started = true;
      } catch (err2) {
        console.warn('Strategy 2 (environment facingMode) failed, trying user camera:', err2);
        lastError = err2;
      }
    }

    // Strategy 3: User / Front / Default Camera
    if (!started) {
      try {
        await html5QrCode.start({ facingMode: 'user' }, scanConfig, qrCodeSuccessCallback, qrCodeErrorCallback);
        started = true;
      } catch (err3) {
        console.warn('Strategy 3 (user facingMode) failed, trying any camera:', err3);
        lastError = err3;
      }
    }

    // Strategy 4: Fallback to first available camera device if any
    if (!started && availableCameras.length > 0) {
      try {
        await html5QrCode.start(availableCameras[0].id, scanConfig, qrCodeSuccessCallback, qrCodeErrorCallback);
        started = true;
      } catch (err4) {
        lastError = err4;
      }
    }

    if (!started) {
      throw lastError || new Error('Tidak dapat memulai kamera dengan konfigurasi yang tersedia.');
    }

    // Camera started successfully
    isScanning = true;
    isPaused = false;

    if (placeholderEl) placeholderEl.classList.add('hidden');
    if (readerElement) readerElement.classList.remove('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    if (laserEl) laserEl.classList.remove('hidden');

    checkTorchSupport();
    showScanStatus('Kamera aktif. Arahkan QR Code peserta ke dalam kotak.', 'info');
  } catch (err) {
    console.error('Camera access error:', err);
    isScanning = false;
    resetStartButton();

    const rawMsg = (err && err.message) ? err.message : String(err || '');
    const lower = rawMsg.toLowerCase();
    const name = (err && err.name) ? err.name : '';

    let userMsg = 'Gagal mengakses kamera.';
    if (name === 'NotAllowedError' || lower.includes('permission') || lower.includes('notallowed')) {
      userMsg = 'Izin kamera ditolak. Berikan izin kamera di pengaturan browser/ikon gembok di URL bar, lalu coba lagi.';
    } else if (name === 'NotFoundError' || lower.includes('notfound') || lower.includes('device not found')) {
      userMsg = 'Kamera tidak ditemukan pada perangkat ini. Anda dapat menggunakan opsi "Scan Gambar" atau input manual.';
    } else if (name === 'NotReadableError' || lower.includes('notreadable') || lower.includes('could not start')) {
      userMsg = 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.';
    } else if (lower.includes('overconstrained')) {
      userMsg = 'Resolusi atau pengaturan kamera tidak didukung perangkat.';
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

// Stop Camera Scanning
async function stopCameraScanner() {
  if (html5QrCode) {
    try {
      if (isScanning) {
        await html5QrCode.stop();
      }
      await html5QrCode.clear();
    } catch (e) {
      console.warn('Stop scanner warning:', e);
    }
  }

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

// Handle Scanned Result
async function handleScannedCode(decodedText) {
  if (scanLock || !decodedText) return;
  scanLock = true;

  pauseScanner();
  console.log('Decoded QR Text:', decodedText);

  let ticketId = decodedText.trim();
  let securityToken = '';

  // Extract from full URL format or pipe format
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

// Handle QR File / Image Upload
async function handleQrFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  showScanStatus('Memproses berkas gambar QR...', 'info');

  try {
    if (!html5QrCode) {
      const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined')
        ? [Html5QrcodeSupportedFormats.QR_CODE]
        : undefined;

      html5QrCode = new Html5Qrcode('qr-reader', {
        formatsToSupport: formats,
        verbose: false
      });
    }

    const decodedText = await html5QrCode.scanFile(file, true);
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
    // Reset file input
    event.target.value = '';
  }
}

// Check if Torch / Flashlight is supported
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

// Toggle Torch
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
      showScanStatus('Kamera Aktif. Arahkan QR Code ke dalam kotak.', 'info');
    } catch (e) {
      console.warn('Resume scanner error:', e);
    }
  }
}

// Send Check-in API Request
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

// Show Result Modal
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

// Export functions to window for onclick handlers
window.startCameraScanner = startCameraScanner;
window.stopCameraScanner = stopCameraScanner;
window.processCheckIn = processCheckIn;
window.closeResultModal = closeResultModal;
window.handleQrFileUpload = handleQrFileUpload;
window.toggleTorch = toggleTorch;
window.onCameraSelectChange = onCameraSelectChange;

// Auto-discover cameras on page load
document.addEventListener('DOMContentLoaded', () => {
  discoverCameras();
});

