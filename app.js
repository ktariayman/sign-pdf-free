pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null, pdfBytes = null, totalPages = 0, scale = 1.5;
let items = [];
let selected = null;
let placingSignature = null;
let sigColor = '#222';
let uploadedSigUrl = null;

// ---- Deselect on click outside ----
document.addEventListener('pointerdown', e => {
  if (selected && !selected.contains(e.target) && !e.target.closest('.bar')) {
    selected.classList.remove('selected');
    selected = null;
  }
});

// ---- File loading ----
const dropBox = document.getElementById('dropBox');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropBox.onclick = () => fileInput.click();
dropBox.ondragover = e => { e.preventDefault(); dropBox.style.borderColor = '#e94560'; };
dropBox.ondragleave = () => dropBox.style.borderColor = '#333';
dropBox.ondrop = e => { e.preventDefault(); dropBox.style.borderColor = '#333'; loadFile(e.dataTransfer.files[0]); };
fileInput.onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); };

async function loadFile(file) {
  if (file.type !== 'application/pdf') return alert('PDF only');
  pdfBytes = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  totalPages = pdfDoc.numPages;
  items = [];
  dropZone.style.display = 'none';
  document.getElementById('workspace').classList.add('on');
  document.getElementById('btnSig').disabled = false;
  document.getElementById('btnText').disabled = false;
  document.getElementById('btnDl').disabled = false;
  renderPages();
}

async function renderPages() {
  const ws = document.getElementById('workspace');
  ws.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale });
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = i;
    wrap.style.width = vp.width + 'px';
    wrap.style.height = vp.height + 'px';
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    wrap.appendChild(c);
    ws.appendChild(wrap);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;

    wrap.addEventListener('click', e => {
      if (placingSignature) {
        placeItem(wrap, e, i, 'sig', placingSignature);
        placingSignature = null;
        document.body.style.cursor = '';
      } else if (placingText) {
        placeItem(wrap, e, i, 'text', placingText);
        placingText = null;
        document.body.style.cursor = '';
      }
    });
  }
  restoreItems();
}

// ---- Signature modal ----
let sigCtx, drawing = false, hasDrawn = false;

function switchSigTab(tab) {
  document.querySelectorAll('.sig-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tabDraw').classList.toggle('active', tab === 'draw');
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
}

function openSigPad() {
  uploadedSigUrl = null;
  hasDrawn = false;
  document.getElementById('sigUploadPreview').style.display = 'none';
  document.getElementById('sigPlaceholder').classList.remove('hidden');
  switchSigTab('draw');

  const modal = document.getElementById('sigModal');
  modal.classList.add('on');
  const c = document.getElementById('sigCanvas');
  c.width = c.offsetWidth; c.height = c.offsetHeight;
  sigCtx = c.getContext('2d');
  sigCtx.strokeStyle = sigColor; sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = 'round'; sigCtx.lineJoin = 'round';
  clearPad();

  c.onpointerdown = e => {
    drawing = true; hasDrawn = true;
    document.getElementById('sigPlaceholder').classList.add('hidden');
    sigCtx.beginPath(); sigCtx.moveTo(e.offsetX, e.offsetY);
  };
  c.onpointermove = e => { if (drawing) { sigCtx.lineTo(e.offsetX, e.offsetY); sigCtx.stroke(); } };
  c.onpointerup = c.onpointerleave = () => drawing = false;
  showSavedSigs();
}

function setSigColor(color, dot) {
  sigColor = color;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  dot.classList.add('active');
  if (sigCtx) {
    sigCtx.strokeStyle = color;
    // Recolor existing drawing
    const c = document.getElementById('sigCanvas');
    if (hasDrawn) {
      sigCtx.save();
      sigCtx.globalCompositeOperation = 'source-in';
      sigCtx.fillStyle = color;
      sigCtx.fillRect(0, 0, c.width, c.height);
      sigCtx.restore();
    }
  }
}

function clearPad() {
  const c = document.getElementById('sigCanvas');
  if (sigCtx) sigCtx.clearRect(0, 0, c.width, c.height);
  hasDrawn = false;
  document.getElementById('sigPlaceholder').classList.remove('hidden');
}

function closePad() { document.getElementById('sigModal').classList.remove('on'); }

// ---- Upload signature ----
const sigUploadArea = document.getElementById('sigUploadArea');
const sigFileInput = document.getElementById('sigFileInput');

sigUploadArea.ondragover = e => { e.preventDefault(); sigUploadArea.style.borderColor = '#e94560'; };
sigUploadArea.ondragleave = () => { sigUploadArea.style.borderColor = '#ddd'; };
sigUploadArea.ondrop = e => {
  e.preventDefault(); e.stopPropagation();
  sigUploadArea.style.borderColor = '#ddd';
  if (e.dataTransfer.files[0]) handleSigUpload(e.dataTransfer.files[0]);
};
sigFileInput.onchange = e => { if (e.target.files[0]) handleSigUpload(e.target.files[0]); sigFileInput.value = ''; };

function handleSigUpload(file) {
  if (!file.type.match(/^image\/(png|jpe?g|svg\+xml)$/)) return alert('PNG, JPG or SVG only');
  const reader = new FileReader();
  reader.onload = e => {
    uploadedSigUrl = e.target.result;
    document.getElementById('sigUploadImg').src = uploadedSigUrl;
    document.getElementById('sigUploadPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ---- Saved signatures ----
function showSavedSigs() {
  const container = document.getElementById('savedSigs');
  const sigs = JSON.parse(localStorage.getItem('saved_signatures') || '[]');
  if (!sigs.length) { container.innerHTML = ''; return; }
  container.innerHTML = '<p>Saved signatures</p><div class="saved-list"></div>';
  const list = container.querySelector('.saved-list');
  sigs.forEach((url, i) => {
    const item = document.createElement('div');
    item.className = 'saved-item';
    const img = document.createElement('img');
    img.src = url;
    item.appendChild(img);
    item.onclick = () => { useSavedSig(url); };
    const del = document.createElement('button');
    del.className = 'saved-del';
    del.textContent = '\u00d7';
    del.onclick = e => { e.stopPropagation(); removeSavedSig(i); };
    item.appendChild(del);
    list.appendChild(item);
  });
}

function removeSavedSig(idx) {
  const sigs = JSON.parse(localStorage.getItem('saved_signatures') || '[]');
  sigs.splice(idx, 1);
  localStorage.setItem('saved_signatures', JSON.stringify(sigs));
  showSavedSigs();
}

function useSavedSig(url) {
  closePad();
  placingSignature = url;
  document.body.style.cursor = 'crosshair';
}

function cropCanvas(c, ctx) {
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 <= x0) return null;
  const p = 10;
  x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p);
  x1 = Math.min(c.width, x1 + p); y1 = Math.min(c.height, y1 + p);
  const crop = document.createElement('canvas');
  crop.width = x1 - x0; crop.height = y1 - y0;
  crop.getContext('2d').drawImage(c, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop.toDataURL('image/png');
}

function useSig() {
  const activeTab = document.querySelector('.sig-tab.active').dataset.tab;
  let url;

  if (activeTab === 'upload') {
    if (!uploadedSigUrl) return alert('Upload an image first');
    url = uploadedSigUrl;
  } else {
    const c = document.getElementById('sigCanvas');
    url = cropCanvas(c, sigCtx);
    if (!url) return alert('Draw something first');
  }

  // Save to localStorage
  const sigs = JSON.parse(localStorage.getItem('saved_signatures') || '[]');
  if (!sigs.includes(url)) {
    sigs.push(url);
    localStorage.setItem('saved_signatures', JSON.stringify(sigs));
  }
  closePad();
  placingSignature = url;
  document.body.style.cursor = 'crosshair';
}

// ---- Add text ----
let placingText = null;

function addText() {
  document.getElementById('textInput').value = '';
  document.getElementById('textModal').classList.add('on');
  setTimeout(() => document.getElementById('textInput').focus(), 50);
}

function closeTextModal() {
  document.getElementById('textModal').classList.remove('on');
}

function confirmText() {
  const val = document.getElementById('textInput').value.trim();
  if (!val) return alert('Type something first');
  closeTextModal();
  placingText = val;
  document.body.style.cursor = 'crosshair';
}

// ---- Generic item placement ----
function placeItem(wrap, e, pageNum, type, value) {
  const r = wrap.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (type === 'sig') {
    const w = 150, h = 50;
    const item = { type, pageNum, xPct: (x - w / 2) / r.width, yPct: (y - h / 2) / r.height, wPct: w / r.width, hPct: h / r.height, dataUrl: value };
    items.push(item);
    createItemEl(wrap, item, items.length - 1);
  } else {
    const item = { type, pageNum, xPct: x / r.width, yPct: y / r.height, text: value, fontSize: 14 };
    items.push(item);
    createItemEl(wrap, item, items.length - 1);
  }
}

function sel(div) {
  if (selected && selected !== div) selected.classList.remove('selected');
  div.classList.add('selected');
  selected = div;
}

function createItemEl(wrap, item, idx) {
  const div = document.createElement('div');
  div.className = 'item';
  div.dataset.idx = idx;

  if (item.type === 'sig') {
    div.style.left = (item.xPct * 100) + '%';
    div.style.top = (item.yPct * 100) + '%';
    div.style.width = (item.wPct * 100) + '%';
    div.style.height = (item.hPct * 100) + '%';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    div.appendChild(img);
  } else {
    div.style.left = (item.xPct * 100) + '%';
    div.style.top = (item.yPct * 100) + '%';
    const span = document.createElement('div');
    span.className = 'item-text';
    span.textContent = item.text;
    span.style.fontSize = (item.fontSize || 14) + 'px';
    div.appendChild(span);
  }

  // Delete button
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '\u00d7';
  del.onclick = e => { e.stopPropagation(); items[idx] = null; div.remove(); if (selected === div) selected = null; };
  div.appendChild(del);

  // Resize handle (signatures only)
  if (item.type === 'sig') {
    const rh = document.createElement('div');
    rh.className = 'resize';
    div.appendChild(rh);
    let resizing = false, sx, sy, ow, oh;
    rh.addEventListener('pointerdown', e => {
      e.stopPropagation(); sel(div);
      resizing = true; sx = e.clientX; sy = e.clientY;
      ow = parseFloat(div.style.width); oh = parseFloat(div.style.height);
      rh.setPointerCapture(e.pointerId);
    });
    rh.addEventListener('pointermove', e => {
      if (!resizing) return;
      const ww = wrap.offsetWidth, wh = wrap.offsetHeight;
      div.style.width = Math.max(3, ow + (e.clientX - sx) / ww * 100) + '%';
      div.style.height = Math.max(2, oh + (e.clientY - sy) / wh * 100) + '%';
    });
    rh.addEventListener('pointerup', () => {
      resizing = false;
      item.wPct = parseFloat(div.style.width) / 100;
      item.hPct = parseFloat(div.style.height) / 100;
    });
  }

  // Select + drag
  let dragging = false, sx, sy, ol, ot;
  div.addEventListener('pointerdown', e => {
    if (e.target.closest('.del') || e.target.closest('.resize')) return;
    e.stopPropagation();
    sel(div);
    dragging = true; sx = e.clientX; sy = e.clientY;
    ol = parseFloat(div.style.left); ot = parseFloat(div.style.top);
    div.setPointerCapture(e.pointerId);
  });
  div.addEventListener('pointermove', e => {
    if (!dragging) return;
    const ww = wrap.offsetWidth, wh = wrap.offsetHeight;
    div.style.left = (ol + (e.clientX - sx) / ww * 100) + '%';
    div.style.top = (ot + (e.clientY - sy) / wh * 100) + '%';
  });
  div.addEventListener('pointerup', () => {
    if (dragging) {
      dragging = false;
      item.xPct = parseFloat(div.style.left) / 100;
      item.yPct = parseFloat(div.style.top) / 100;
    }
  });

  wrap.appendChild(div);
  sel(div);
}

function restoreItems() {
  items.forEach((item, idx) => {
    if (!item) return;
    const wrap = document.querySelector(`.page-wrap[data-page="${item.pageNum}"]`);
    if (wrap) createItemEl(wrap, item, idx);
  });
}

// ---- Download ----
async function downloadPdf() {
  const active = items.filter(Boolean);
  if (!active.length) return alert('Add something first');

  const { PDFDocument } = PDFLib;
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);

  for (const it of active) {
    const page = pages[it.pageNum - 1];
    const { width: pw, height: ph } = page.getSize();
    const wrap = document.querySelector(`.page-wrap[data-page="${it.pageNum}"]`);
    const canvasW = wrap ? wrap.offsetWidth : pw * scale;
    const canvasH = wrap ? wrap.offsetHeight : ph * scale;
    const rx = pw / canvasW;
    const ry = ph / canvasH;

    if (it.type === 'sig') {
      const x = it.xPct * canvasW * rx;
      const yTop = it.yPct * canvasH * ry;
      const w = it.wPct * canvasW * rx;
      const h = it.hPct * canvasH * ry;
      let img;
      if (it.dataUrl.startsWith('data:image/jpeg') || it.dataUrl.startsWith('data:image/jpg')) {
        img = await pdf.embedJpg(await fetch(it.dataUrl).then(r => r.arrayBuffer()));
      } else {
        img = await pdf.embedPng(await fetch(it.dataUrl).then(r => r.arrayBuffer()));
      }
      page.drawImage(img, { x, y: ph - yTop - h, width: w, height: h });
    } else {
      const fontSize = it.fontSize || 14;
      const sz = fontSize * rx;
      const x = it.xPct * canvasW * rx;
      const yTop = it.yPct * canvasH * ry;
      page.drawText(it.text || '', { x, y: ph - yTop - sz * 0.82, size: sz, font, color: PDFLib.rgb(0, 0, 0) });
    }
  }

  const bytes = await pdf.save();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = 'signed.pdf';
  a.click();
  URL.revokeObjectURL(a.href);
}
