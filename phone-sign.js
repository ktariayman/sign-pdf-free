// ==== QR Phone Signing ====
const TURN_WORKER_URL = '/.netlify/functions/turn';

let iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function fetchTurnServers() {
  if (!TURN_WORKER_URL) return;
  try {
    const res = await fetch(TURN_WORKER_URL);
    if (res.ok) {
      const servers = await res.json();
      if (Array.isArray(servers) && servers.length) {
        iceConfig = { iceServers: servers };
      }
    }
  } catch (e) {
    console.warn('Could not fetch TURN servers, using STUN only:', e);
  }
}

let phonePeer = null, phoneConn = null, phoneTimeout = null, phoneInitTimeout = null;

async function openPhoneSign() {
  document.getElementById('qrContainer').style.display = '';
  document.getElementById('qrWaiting').style.display = 'none';
  document.getElementById('qrLinkRow').style.display = 'none';
  document.querySelector('.qr-instructions').style.display = '';
  updateQrStatus('init', 'Initializing...');
  cleanupPhonePeer();
  await fetchTurnServers();
  startPhonePeer();
}

function startPhonePeer() {
  if (typeof Peer === 'undefined') {
    updateQrStatus('error', 'PeerJS failed to load. Check your internet connection.');
    return;
  }
  if (typeof QRCode === 'undefined') {
    updateQrStatus('error', 'QR library failed to load. Check your internet connection.');
    return;
  }
  // Clear previous QR code
  document.getElementById('qrContainer').innerHTML = '';

  try {
    phonePeer = new Peer({ config: iceConfig });
  } catch (e) {
    updateQrStatus('error', 'Failed to create connection: ' + e.message);
    return;
  }

  // Timeout if peer doesn't open within 15 seconds
  phoneInitTimeout = setTimeout(() => {
    updateQrStatus('error', 'Could not reach signaling server. Check your connection.');
  }, 15000);

  phonePeer.on('open', id => {
    clearTimeout(phoneInitTimeout);
    phoneInitTimeout = null;

    const base = window.location.href.replace(/\/[^/]*$/, '/');
    const mobileUrl = base + 'sign-mobile.html?peerId=' + id;

    try {
      new QRCode(document.getElementById('qrContainer'), {
        text: mobileUrl,
        width: 240,
        height: 240,
        colorDark: '#111111',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      updateQrStatus('waiting', 'Waiting for phone to scan...');
      // Show copyable link
      document.getElementById('qrLinkInput').value = mobileUrl;
      document.getElementById('qrLinkRow').style.display = '';
    } catch (err) {
      updateQrStatus('error', 'Failed to generate QR code');
      console.error('QRCode error:', err);
      return;
    }

    // Session timeout: 3 minutes
    phoneTimeout = setTimeout(() => {
      updateQrStatus('error', 'Session expired');
      cleanupPhonePeer();
    }, 180000);
  });

  phonePeer.on('connection', conn => {
    phoneConn = conn;
    updateQrStatus('connected', 'Phone connected');

    // Switch UI: hide QR, show waiting spinner
    document.getElementById('qrContainer').style.display = 'none';
    document.querySelector('.qr-instructions').style.display = 'none';
    document.getElementById('qrWaiting').style.display = '';

    conn.on('data', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.type !== 'signature' || !msg.dataUrl) return;

      // Send acknowledgment
      try { conn.send(JSON.stringify({ type: 'ack' })); } catch (e) { }

      // Save to localStorage
      const sigs = JSON.parse(localStorage.getItem('saved_signatures') || '[]');
      if (!sigs.includes(msg.dataUrl)) {
        sigs.push(msg.dataUrl);
        localStorage.setItem('saved_signatures', JSON.stringify(sigs));
      }

      // Load onto draw canvas so user can preview/recolor, then click "Use"
      cleanupPhonePeer();
      useSavedSig(msg.dataUrl);
      showSavedSigs();
    });

    conn.on('close', () => {
      updateQrStatus('error', 'Phone disconnected');
    });

    conn.on('error', () => {
      updateQrStatus('error', 'Connection error');
    });
  });

  phonePeer.on('error', err => {
    clearTimeout(phoneInitTimeout);
    console.error('PeerJS error:', err);
    if (err.type === 'unavailable-id') {
      cleanupPhonePeer();
      startPhonePeer();
    } else {
      updateQrStatus('error', 'Connection failed: ' + (err.type || err.message));
    }
  });

  phonePeer.on('disconnected', () => {
    console.warn('PeerJS disconnected from signaling server');
  });
}

function cleanupPhonePeer() {
  clearTimeout(phoneTimeout);
  clearTimeout(phoneInitTimeout);
  phoneTimeout = null;
  phoneInitTimeout = null;
  if (phoneConn) { try { phoneConn.close(); } catch (e) { } phoneConn = null; }
  if (phonePeer) { try { phonePeer.destroy(); } catch (e) { } phonePeer = null; }
}

function updateQrStatus(state, text) {
  const el = document.getElementById('qrStatus');
  el.querySelector('.qr-status-dot').className = 'qr-status-dot ' + state;
  el.querySelector('span').textContent = text;
}

function copyPhoneLink() {
  const input = document.getElementById('qrLinkInput');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.querySelector('.qr-copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }).catch(() => {
    input.select();
    document.execCommand('copy');
  });
}
