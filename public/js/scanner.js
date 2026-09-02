/**
 * CASANAWASENA - QR Scanner Helper
 * High-performance, robust camera scanner with simplified options:
 * - Hanya 2 kategori: Kamera Belakang & Kamera Depan (tanpa duplikasi ganda/ultra-lebar)
 * - Tampilan video tidak di-mirror (un-mirrored / normal)
 * - Dukungan scan file gambar QR & input manual
 */

let html5QrCode = null;
let isScanning = false;
let isStartingScanner = false;
let isPaused = false;
let selectedFacingMode = 'environment'; // 'environment' (Belakang) or 'user' (Depan)
let selectedCameraDeviceId = null;
let simplifiedCameras = [];
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
    console.warn('Audio playback note:', e);
  }
}

// Check library availability
function isHtml5QrcodeLoaded() {
  return typeof Html5Qrcode !== 'undefined';
}

/**
 * Filter dan sederhanakan daftar kamera agar hanya ada:
 * 1. Kamera Belakang (Utama)
 * 2. Kamera Depan
 * Menghilangkan duplikasi kamera ultra-wide / multi-lensa ganda.
 */
async function discoverCameras() {
  if (!isHtml5QrcodeLoaded()) return [];
  try {
    const rawCameras = await Html5Qrcode.getCameras();
    if (!rawCameras || rawCameras.length === 0) {
      simplifiedCameras = [
        { id: 'mode:environment', label: '📷 Kamera Belakang', facing: 'environment' },
        { id: 'mode:user', label: '🤳 Kamera Depan', facing: 'user' }
      ];
      renderCameraSelectOptions();
      return simplifiedCameras;
    }

    let backCam = null;
    let frontCam = null;
    const others = [];

    rawCameras.forEach(cam => {
      const lbl = (cam.label || '').toLowerCase();
      // Lewati sensor ultra-wide / macro / depth / ganda berlebih jika sudah ada kamera utama
      const isUltraWide = lbl.includes('ultra') || lbl.includes('wide') || lbl.includes('0.5') || lbl.includes('tele');
      
      if (lbl.includes('back') || lbl.includes('rear') || lbl.includes('belakang') || lbl.includes('environment')) {
        if (!backCam) {
          backCam = { id: cam.id, label: '📷 Kamera Belakang', facing: 'environment' };
        } else if (!isUltraWide && backCam) {
          backCam = { id: cam.id, label: '📷 Kamera Belakang', facing: 'environment' };
        }
      } else if (lbl.includes('front') || lbl.includes('user') || lbl.includes('depan') || lbl.includes('facetime') || lbl.includes('selfie')) {
        if (!frontCam) {
          frontCam = { id: cam.id, label: '🤳 Kamera Depan', facing: 'user' };
        }
      } else {
        others.push(cam);
      }
    });

    // Jika perangkat desktop / hanya 1-2 kamera tanpa label spesifik
    if (!backCam && !frontCam) {
      if (rawCameras.length === 1) {
        simplifiedCameras = [
          { id: rawCameras[0].id, label: '📷 Kamera Utama', facing: 'environment' }
        ];
      } else {
        simplifiedCameras = [
          { id: rawCameras[0].id, label: '📷 Kamera Belakang / Utama', facing: 'environment' },
          { id: rawCameras[1] ? rawCameras[1].id : 'mode:user', label: '🤳 Kamera Depan', facing: 'user' }
        ];
      }
    } else {
      simplifiedCameras = [];
      if (backCam) simplifiedCameras.push(backCam);
      if (frontCam) simplifiedCameras.push(frontCam);
      // Fallback opsi generic jika salah satu kosong
      if (!backCam) simplifiedCameras.unshift({ id: 'mode:environment', label: '📷 Kamera Belakang', facing: 'environment' });
      if (!frontCam) simplifiedCameras.push({ id: 'mode:user', label: '🤳 Kamera Depan', facing: 'user' });
    }

    renderCameraSelectOptions();
    return simplifiedCameras;
  } catch (e) {
    console.warn('Camera enumeration fallback:', e);
    simplifiedCameras = [
      { id: 'mode:environment', label: '📷 Kamera Belakang', facing: 'environment' },
      { id: 'mode:user', label: '🤳 Kamera Depan', facing: 'user' }
    ];
    renderCameraSelectOptions();
    return simplifiedCameras;
  }
}

// Populate camera select dropdown
function renderCameraSelectOptions() {
  const selectEl = document.getElementById('camera-select');
  const containerEl = document.getElementById('camera-select-container');
  if (!selectEl || !containerEl) return;

  if (simplifiedCameras.length > 0) {
    selectEl.innerHTML = '';
    simplifiedCameras.forEach((cam) => {
      const opt = document.createElement('option');
      opt.value = cam.id;
      opt.textContent = cam.label;
      selectEl.appendChild(opt);
    });

    if (selectedCameraDeviceId) {
      selectEl.value = selectedCameraDeviceId;
    } else {
      // Default pilih kamera belakang
      const defaultBack = simplifiedCameras.find(c => c.facing === 'environment') || simplifiedCameras[0];
      if (defaultBack) {
        selectEl.value = defaultBack.id;
        selectedCameraDeviceId = defaultBack.id;
        selectedFacingMode = defaultBack.facing;
      }
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
  const newSelection = selectEl.value;
  if (newSelection && newSelection !== selectedCameraDeviceId) {
    selectedCameraDeviceId = newSelection;
    const found = simplifiedCameras.find(c => c.id === newSelection);
    if (found) {
      selectedFacingMode = found.facing;
    }

    if (isScanning) {
      await stopCameraScanner();
      await startCameraScanner();
    }
  }
}

// Helper to destroy and clean the Html5Qrcode instance
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

// Start Camera Scanning with single-instance safety and non-mirrored output
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

  // Visual loading feedback
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
    // 1. Bersihkan instance sebelumnya
    await cleanupScannerInstance();

    // 2. Refresh simplified list of cameras
    if (simplifiedCameras.length === 0) {
      await discoverCameras();
    }

    const selectEl = document.getElementById('camera-select');
    let targetSelection = selectedCameraDeviceId || (selectEl ? selectEl.value : null);

    // Dapatkan konfigurasi kamera berdasarkan pilihan
    const currentCam = simplifiedCameras.find(c => c.id === targetSelection) || simplifiedCameras[0];
    const targetFacing = currentCam ? currentCam.facing : selectedFacingMode;

    // Persiapkan wadah sebelum start
    if (placeholderEl) placeholderEl.classList.add('hidden');
    if (readerElement) {
      readerElement.classList.remove('hidden');
      readerElement.style.display = 'block';
    }

    const qrCodeSuccessCallback = (decodedText) => {
      if (isScanning && !isPaused) {
        handleScannedCode(decodedText);
      }
    };

    const qrCodeErrorCallback = () => {};

    // Konfigurasi Scan: disableFlip = true untuk mencegah efek cermin (mirror)
    const scanConfig = {
      fps: 20,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.333333,
      disableFlip: true // Non-mirrored
    };

    // Helper untuk mencoba konfigurasi kamera
    async function attemptStart(cameraParam) {
      await cleanupScannerInstance();
      if (readerElement) {
        readerElement.innerHTML = '';
        readerElement.classList.remove('hidden');
        readerElement.style.display = 'block';
      }

      const instance = new Html5Qrcode('qr-reader', {
        verbose: false
      });
      await instance.start(cameraParam, scanConfig, qrCodeSuccessCallback, qrCodeErrorCallback);

      // Pastikan CSS video un-mirrored dan pas
      const videoEl = readerElement.querySelector('video');
      if (videoEl) {
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.maxHeight = '380px';
        videoEl.style.objectFit = 'cover';
        videoEl.style.display = 'block';
        videoEl.style.borderRadius = '0.875rem';
        videoEl.style.transform = 'none'; // Pastikan tidak ada transform: scaleX(-1)
      }

      return instance;
    }

    let activeInstance = null;
    let lastError = null;

    // Prioritaskan membuka Kamera Belakang terlebih dahulu jika diminta
    const candidates = [];
    if (targetFacing === 'environment') {
      // 1. Direct device ID jika ada dan bukan mode:
      if (targetSelection && !targetSelection.startsWith('mode:')) {
        candidates.push(targetSelection);
      }
      // 2. Exact facingMode environment
      candidates.push({ facingMode: { exact: 'environment' } });
      // 3. Ideal facingMode environment
      candidates.push({ facingMode: 'environment' });
      // 4. Fallback user
      candidates.push({ facingMode: 'user' });
    } else {
      if (targetSelection && !targetSelection.startsWith('mode:')) {
        candidates.push(targetSelection);
      }
      candidates.push({ facingMode: 'user' });
      candidates.push({ facingMode: 'environment' });
    }

    // Jalankan urutan kandidat hingga berhasil
    for (const cand of candidates) {
      try {
        activeInstance = await attemptStart(cand);
        if (activeInstance) break;
      } catch (errCand) {
        console.warn('Attempt with candidate failed:', cand, errCand);
        lastError = errCand;
      }
    }

    if (!activeInstance) {
      if (placeholderEl) placeholderEl.classList.remove('hidden');
      if (readerElement) readerElement.classList.add('hidden');
      throw lastError || new Error('Tidak dapat membuka kamera pada perangkat ini.');
    }

    html5QrCode = activeInstance;
    isScanning = true;
    isPaused = false;
    isStartingScanner = false;

    if (placeholderEl) placeholderEl.classList.add('hidden');
    if (readerElement) readerElement.classList.remove('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    if (laserEl) laserEl.classList.remove('hidden');

    checkTorchSupport();
    const camName = targetFacing === 'environment' ? 'Kamera Belakang' : 'Kamera Depan';
    showScanStatus(`${camName} aktif. Arahkan QR Code peserta ke dalam kotak.`, 'info');

    // Update label kamera setelah izin diberikan oleh peramban
    setTimeout(() => {
      discoverCameras();
    }, 600);

  } catch (err) {
    console.error('Camera access error:', err);
    isScanning = false;
    isStartingScanner = false;
    await cleanupScannerInstance();
    resetStartButton();

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
      userMsg = 'Kamera yang dipilih tidak mendukung mode ini. Coba pilih kamera lainnya pada menu dropdown.';
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
