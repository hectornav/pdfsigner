/**
 * SignPDF — Main Application Controller
 */

// ─── State ─────────────────────────────────────────────
const state = {
  pdf: null,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  minZoom: 0.25,
  maxZoom: 4.0,
  zoomStep: 0.25,
  pdfPath: null,
  pdfName: null,
  certificate: null,
  certPath: null,
  certPassword: null
};

// ─── DOM Shortcuts ─────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Init ──────────────────────────────────────────────
console.log('SignPDF init, pdfjsLib:', typeof pdfjsLib);
bindToolbar();
bindSidebar();
bindModals();
bindDragDrop();
bindKeyboard();
bindIPC();
initColorSwatches();

// ─── Toolbar Events ────────────────────────────────────
function bindToolbar() {
  $('#btn-open').addEventListener('click', () => window.signpdf.openPDF());
  $('#btn-save').addEventListener('click', () => window.signpdf.saveCopy());
  $('#btn-zoom-in').addEventListener('click', zoomIn);
  $('#btn-zoom-out').addEventListener('click', zoomOut);
  $('#btn-prev-page').addEventListener('click', () => goToPage(state.currentPage - 1));
  $('#btn-next-page').addEventListener('click', () => goToPage(state.currentPage + 1));
  $('#btn-cert').addEventListener('click', openCertDialog);
  $('#btn-sign').addEventListener('click', openSignModal);

  // PDF Tools
  $('#btn-rotate-cw').addEventListener('click', () => rotateCurrent(90));
  $('#btn-rotate-ccw').addEventListener('click', () => rotateCurrent(270));
  $('#btn-delete-page').addEventListener('click', deleteCurrentPage);
  $('#btn-merge').addEventListener('click', mergePDFs);
  $('#btn-split').addEventListener('click', splitPDF);
  $('#btn-extract').addEventListener('click', extractCurrentPage);
  $('#btn-watermark').addEventListener('click', openWatermarkDialog);

  // Welcome buttons
  $('#btn-welcome-open').addEventListener('click', () => window.signpdf.openPDF());
  $('#btn-welcome-cert').addEventListener('click', openCertDialog);
}

// ─── Sidebar Events ────────────────────────────────────
function bindSidebar() {
  $$('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.sidebar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.sidebar-content').forEach(c => c.classList.remove('active'));
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
  $('#btn-cert-load-sidebar').addEventListener('click', openCertDialog);
  $('#btn-change-cert').addEventListener('click', openCertDialog);
}

// ─── Modal Events ──────────────────────────────────────
function bindModals() {
  $('#sign-modal-close').addEventListener('click', () => $('#sign-modal').style.display = 'none');
  $('#sign-cancel').addEventListener('click', () => $('#sign-modal').style.display = 'none');
  $('#sign-confirm').addEventListener('click', handleSign);
  $('#sign-reason').addEventListener('change', function() {
    $('#sign-reason-custom').style.display = this.value === 'custom' ? 'block' : 'none';
  });

  $('#cert-modal-close').addEventListener('click', () => $('#cert-modal').style.display = 'none');
  $('#cert-cancel').addEventListener('click', () => $('#cert-modal').style.display = 'none');
  $('#cert-confirm').addEventListener('click', handleCertLoad);
  $('#cert-pw-toggle').addEventListener('click', () => {
    const inp = $('#cert-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('#cert-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCertLoad(); });
}

// ─── Drag & Drop ───────────────────────────────────────
function bindDragDrop() {
  const container = $('#viewer-container');
  ['dragenter', 'dragover'].forEach(e => container.addEventListener(e, (ev) => {
    ev.preventDefault();
    const dz = $('#drop-zone');
    if (dz) dz.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(e => container.addEventListener(e, (ev) => {
    ev.preventDefault();
    const dz = $('#drop-zone');
    if (dz) dz.classList.remove('drag-over');
  }));
  container.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files;
    if (f.length && f[0].name.toLowerCase().endsWith('.pdf')) {
      window.signpdf.openFromPath(f[0].path);
    }
  });
}

// ─── Keyboard ──────────────────────────────────────────
function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '=') { e.preventDefault(); zoomIn(); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); zoomOut(); }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); zoomReset(); }
    if (e.key === 'Escape') {
      $('#sign-modal').style.display = 'none';
      $('#cert-modal').style.display = 'none';
    }
  });
  const viewer = $('#pdf-viewer');
  if (viewer) viewer.addEventListener('scroll', updateCurrentPageFromScroll);
}

// ─── IPC Events ────────────────────────────────────────
function bindIPC() {
  window.signpdf.onPDFLoaded(loadPDF);
  window.signpdf.onMenuSave(() => window.signpdf.saveCopy());
  window.signpdf.onMenuLoadCert(openCertDialog);
  window.signpdf.onMenuSign(openSignModal);
  window.signpdf.onMenuZoomIn(zoomIn);
  window.signpdf.onMenuZoomOut(zoomOut);
  window.signpdf.onMenuZoomReset(zoomReset);
  window.signpdf.onCertGenerated((d) => {
    state.certPath = d.path;
    state.certPassword = d.password;
    showCertModal(d.path.split('/').pop());
  });
  window.signpdf.onMenuRotateCW(() => rotateCurrent(90));
  window.signpdf.onMenuRotateCCW(() => rotateCurrent(270));
  window.signpdf.onMenuDeletePage(deleteCurrentPage);
  window.signpdf.onMenuExtractPages(extractCurrentPage);
  window.signpdf.onMenuSplitAll(splitPDF);
  window.signpdf.onMenuMerge(mergePDFs);
  window.signpdf.onCertAutoloaded((certInfo) => {
    state.certificate = certInfo;
    updateCertificatePanel(certInfo);
    updateSignButton();
    updateStatusBar();
    showToast(`🔐 Certificado cargado: ${certInfo.commonName}`, 'success');
  });
}

// ═══════════════════════════════════════════════════════
// PDF LOADING & RENDERING
// ═══════════════════════════════════════════════════════

async function loadPDF(data) {
  console.log('loadPDF called, data keys:', Object.keys(data), 'buffer type:', typeof data.buffer, 'isArray:', Array.isArray(data.buffer));
  showLoading('Cargando PDF...');
  try {
    const pdfData = new Uint8Array(data.buffer);
    console.log('PDF data size:', pdfData.length);
    state.pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    state.totalPages = state.pdf.numPages;
    state.currentPage = 1;
    state.pdfPath = data.path;
    state.pdfName = data.name;

    $('#welcome-screen').style.display = 'none';
    $('#pdf-viewer').style.display = 'flex';

    enablePDFButtons(true);
    await renderAllPages();
    renderThumbnails();
    updatePageInfo();
    updateStatusBar();
    hideLoading();
    showToast(`${data.name} — ${state.totalPages} páginas`, 'success');
  } catch (err) {
    hideLoading();
    showToast(`Error al cargar: ${err.message}`, 'error');
    console.error('PDF load error:', err);
  }
}

async function renderAllPages() {
  const container = $('#pages-container');
  container.innerHTML = '';
  const dpr = window.devicePixelRatio || 1;

  for (let i = 1; i <= state.totalPages; i++) {
    const page = await state.pdf.getPage(i);
    const scale = state.zoom * dpr;
    const viewport = page.getViewport({ scale });
    const displayViewport = page.getViewport({ scale: state.zoom });

    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.id = `page-${i}`;
    wrapper.style.width = `${displayViewport.width}px`;
    wrapper.style.height = `${displayViewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${displayViewport.width}px`;
    canvas.style.height = `${displayViewport.height}px`;

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);
  }
}

async function renderThumbnails() {
  const list = $('#thumbnail-list');
  list.innerHTML = '';

  for (let i = 1; i <= state.totalPages; i++) {
    const page = await state.pdf.getPage(i);
    const vp = page.getViewport({ scale: 0.3 });

    const item = document.createElement('div');
    item.className = `thumbnail-item${i === state.currentPage ? ' active' : ''}`;
    item.dataset.page = i;
    item.addEventListener('click', () => goToPage(i));

    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    const label = document.createElement('span');
    label.className = 'thumbnail-label';
    label.textContent = i;

    item.appendChild(canvas);
    item.appendChild(label);
    list.appendChild(item);
  }
}

// ═══════════════════════════════════════════════════════
// NAVIGATION & ZOOM
// ═══════════════════════════════════════════════════════

function goToPage(n) {
  if (!state.pdf || n < 1 || n > state.totalPages) return;
  state.currentPage = n;
  const el = document.getElementById(`page-${n}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updatePageInfo();
  updateThumbnailHighlight();
}

function updateCurrentPageFromScroll() {
  const viewer = $('#pdf-viewer');
  if (!state.pdf || !viewer) return;
  const rect = viewer.getBoundingClientRect();
  for (let i = 1; i <= state.totalPages; i++) {
    const el = document.getElementById(`page-${i}`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.top <= rect.top + rect.height / 3 && r.bottom > rect.top) {
      if (state.currentPage !== i) {
        state.currentPage = i;
        updatePageInfo();
        updateThumbnailHighlight();
      }
      break;
    }
  }
}

function updatePageInfo() {
  $('#page-info').textContent = `${state.currentPage} / ${state.totalPages}`;
  $('#btn-prev-page').disabled = state.currentPage <= 1;
  $('#btn-next-page').disabled = state.currentPage >= state.totalPages;
}

function updateThumbnailHighlight() {
  $$('.thumbnail-item').forEach(item => {
    item.classList.toggle('active', parseInt(item.dataset.page) === state.currentPage);
  });
}

function zoomIn() {
  if (state.zoom >= state.maxZoom) return;
  state.zoom = Math.min(state.zoom + state.zoomStep, state.maxZoom);
  applyZoom();
}

function zoomOut() {
  if (state.zoom <= state.minZoom) return;
  state.zoom = Math.max(state.zoom - state.zoomStep, state.minZoom);
  applyZoom();
}

function zoomReset() { state.zoom = 1.0; applyZoom(); }

async function applyZoom() {
  $('#zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
  if (state.pdf) {
    await renderAllPages();
    goToPage(state.currentPage);
  }
}

// ═══════════════════════════════════════════════════════
// PDF TOOLS
// ═══════════════════════════════════════════════════════

async function rotateCurrent(angle) {
  if (!state.pdf) return showToast('Abre un PDF primero', 'warning');
  showLoading('Rotando página...');
  const result = await window.signpdf.rotatePage([state.currentPage - 1], angle);
  hideLoading();
  if (result.success) showToast(`Página ${state.currentPage} rotada ${angle}°`, 'success');
  else showToast(`Error: ${result.error}`, 'error');
}

async function deleteCurrentPage() {
  if (!state.pdf) return showToast('Abre un PDF primero', 'warning');
  if (state.totalPages <= 1) return showToast('No se puede eliminar la única página', 'warning');
  if (!confirm(`¿Eliminar página ${state.currentPage} de ${state.totalPages}?`)) return;
  showLoading('Eliminando página...');
  const result = await window.signpdf.deletePages([state.currentPage - 1]);
  hideLoading();
  if (result.success) showToast(`Página eliminada`, 'success');
  else showToast(`Error: ${result.error}`, 'error');
}

async function extractCurrentPage() {
  if (!state.pdf) return showToast('Abre un PDF primero', 'warning');
  showLoading('Extrayendo página...');
  const result = await window.signpdf.extractPages([state.currentPage - 1]);
  hideLoading();
  if (result.success) showToast(`Página extraída`, 'success');
  else if (result.error !== 'Cancelado') showToast(`Error: ${result.error}`, 'error');
}

async function splitPDF() {
  if (!state.pdf) return showToast('Abre un PDF primero', 'warning');
  showLoading('Dividiendo PDF...');
  const result = await window.signpdf.splitAll();
  hideLoading();
  if (result.success) showToast(`PDF dividido en ${result.count} archivos`, 'success');
  else if (result.error !== 'Cancelado') showToast(`Error: ${result.error}`, 'error');
}

async function mergePDFs() {
  showLoading('Uniendo PDFs...');
  const result = await window.signpdf.mergePDFs();
  hideLoading();
  if (result.success) showToast(`${result.fileCount} PDFs unidos`, 'success');
  else if (result.error !== 'Cancelado') showToast(`Error: ${result.error}`, 'error');
}

// ═══════════════════════════════════════════════════════
// CERTIFICATE & SIGNING
// ═══════════════════════════════════════════════════════

async function openCertDialog() {
  const result = await window.signpdf.loadCertificateDialog();
  if (result) {
    state.certPath = result.path;
    showCertModal(result.name);
  }
}

function showCertModal(fileName) {
  $('#cert-file-name').textContent = fileName;
  $('#cert-password').value = state.certPassword || '';
  $('#cert-error').style.display = 'none';
  $('#cert-modal').style.display = 'flex';
  setTimeout(() => $('#cert-password').focus(), 100);
}

async function handleCertLoad() {
  const password = $('#cert-password').value;
  if (!password) {
    $('#cert-error').textContent = 'Introduce la contraseña del certificado';
    $('#cert-error').style.display = 'block';
    return;
  }
  showLoading('Cargando certificado...');
  const result = await window.signpdf.loadCertificate(state.certPath, password);
  hideLoading();
  if (result.success) {
    state.certificate = result.info;
    state.certPassword = password;
    $('#cert-modal').style.display = 'none';
    updateCertificatePanel(result.info);
    updateSignButton();
    updateStatusBar();
    $$('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'certificate'));
    $$('.sidebar-content').forEach(c => c.classList.remove('active'));
    $('#tab-certificate').classList.add('active');
    showToast(`Certificado: ${result.info.commonName}`, 'success');
  } else {
    $('#cert-error').textContent = result.error;
    $('#cert-error').style.display = 'block';
  }
}

function updateCertificatePanel(info) {
  $('#cert-empty').style.display = 'none';
  $('#cert-info').style.display = 'block';
  const s = $('#cert-status'), ic = $('#cert-status-icon'), lb = $('#cert-status-label'), tr = $('#cert-trust-level');
  if (info.isExpired) { s.className='cert-status error'; ic.textContent='❌'; lb.textContent='Expirado'; tr.textContent='No válido'; }
  else if (info.isSelfSigned) { s.className='cert-status warning'; ic.textContent='⚠️'; lb.textContent='Certificado de Prueba'; tr.textContent='Autofirmado — solo pruebas'; }
  else { s.className='cert-status valid'; ic.textContent='✅'; lb.textContent='Certificado Válido'; tr.textContent='Autoridad reconocida'; }
  $('#cert-cn').textContent = info.commonName||'—';
  $('#cert-org').textContent = info.organization||'—';
  $('#cert-email').textContent = info.email||'—';
  $('#cert-country').textContent = info.country||'—';
  $('#cert-issuer').textContent = info.issuerName||'—';
  $('#cert-issuer-org').textContent = info.issuerOrg||'—';
  $('#cert-from').textContent = info.validFromFormatted||'—';
  $('#cert-to').textContent = info.validToFormatted||'—';
  $('#cert-expiry').textContent = info.daysUntilExpiry>0?`${info.daysUntilExpiry} días`:'Expirado';
  $('#cert-serial').textContent = info.serialNumber||'—';
  $('#cert-algo').textContent = info.signatureAlgorithm||'—';
  $('#cert-usage').textContent = info.keyUsages?.join(', ')||'—';
}

function openSignModal() {
  if (!state.pdf) return showToast('Abre un PDF primero', 'warning');
  if (!state.certificate) { showToast('Carga un certificado primero', 'warning'); openCertDialog(); return; }
  
  state.sigPlacing = true;
  
  // Banner
  let banner = document.getElementById('sig-placement-banner');
  if (banner) banner.remove();
  banner = document.createElement('div');
  banner.id = 'sig-placement-banner';
  banner.style.cssText = `
    position: fixed; top: 48px; left: 0; right: 0; z-index: 900;
    background: linear-gradient(135deg, #b91c1c, #dc2626);
    color: white; padding: 12px 20px; text-align: center;
    font-size: 14px; font-weight: 600; font-family: var(--font);
    box-shadow: 0 4px 20px rgba(220,38,38,0.4);
  `;
  banner.innerHTML = '📍 Arrastra un rectángulo sobre el PDF para ubicar la firma — <span style="opacity:0.7">ESC para cancelar</span>';
  document.body.appendChild(banner);
  
  document.body.classList.add('placement-mode');
  
  let drawing = false;
  let startX = 0, startY = 0;
  let currentWrapper = null;
  let preview = null;
  let wrapperRect = null;
  
  const cleanup = () => {
    document.body.classList.remove('placement-mode');
    const b = document.getElementById('sig-placement-banner');
    if (b) b.remove();
    state.sigPlacing = false;
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('keydown', escHandler);
  };
  
  const onDown = (e) => {
    const pw = e.target.closest('.page-wrapper');
    if (!pw) return;
    e.preventDefault();
    e.stopPropagation();
    
    drawing = true;
    currentWrapper = pw;
    wrapperRect = pw.getBoundingClientRect();
    startX = e.clientX - wrapperRect.left;
    startY = e.clientY - wrapperRect.top;
    
    // Create preview
    const old = document.getElementById('sig-preview');
    if (old) old.remove();
    preview = document.createElement('div');
    preview.id = 'sig-preview';
    preview.style.left = startX + 'px';
    preview.style.top = startY + 'px';
    preview.style.width = '0px';
    preview.style.height = '0px';
    pw.appendChild(preview);
  };
  
  const onMove = (e) => {
    if (!drawing || !preview || !wrapperRect) return;
    e.preventDefault();
    
    const curX = Math.max(0, Math.min(e.clientX - wrapperRect.left, wrapperRect.width));
    const curY = Math.max(0, Math.min(e.clientY - wrapperRect.top, wrapperRect.height));
    
    const left = Math.min(startX, curX);
    const top = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    
    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
    preview.style.width = w + 'px';
    preview.style.height = h + 'px';
  };
  
  const onUp = (e) => {
    if (!drawing || !preview || !currentWrapper || !wrapperRect) return;
    drawing = false;
    
    const curX = Math.max(0, Math.min(e.clientX - wrapperRect.left, wrapperRect.width));
    const curY = Math.max(0, Math.min(e.clientY - wrapperRect.top, wrapperRect.height));
    
    let left = Math.min(startX, curX);
    let top = Math.min(startY, curY);
    let w = Math.abs(curX - startX);
    let h = Math.abs(curY - startY);
    
    // Minimum size: if too small, use default size centered on click
    if (w < 30 || h < 20) {
      w = wrapperRect.width * 0.42;
      h = wrapperRect.height * 0.13;
      left = Math.max(0, startX - w / 2);
      top = Math.max(0, startY - h / 2);
      if (left + w > wrapperRect.width) left = wrapperRect.width - w;
      if (top + h > wrapperRect.height) top = wrapperRect.height - h;
    }
    
    // Convert to percentages
    const leftPct = left / wrapperRect.width;
    const topPct = top / wrapperRect.height;
    const sigWPct = w / wrapperRect.width;
    const sigHPct = h / wrapperRect.height;
    
    const pageNum = parseInt(currentWrapper.id.replace('page-', ''));
    state.sigPlacement = { pageIndex: pageNum - 1, leftPct, topPct, sigWPct, sigHPct };
    
    // Update preview position
    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
    preview.style.width = w + 'px';
    preview.style.height = h + 'px';
    preview.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-family:var(--font);font-size:12px;color:#b91c1c;font-weight:700;text-align:center">✍️ ${state.certificate.commonName}</div>`;
    
    // Stop drawing listeners
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    document.body.classList.remove('placement-mode');
    
    // Update banner
    const b = document.getElementById('sig-placement-banner');
    if (b) {
      b.style.background = 'linear-gradient(135deg, #15803d, #22c55e)';
      b.innerHTML = '';
      const msg = document.createElement('span');
      msg.textContent = '✅ Área seleccionada — ';
      b.appendChild(msg);
      
      const ok = document.createElement('button');
      ok.textContent = 'Confirmar y firmar';
      ok.style.cssText = 'background:white;color:#15803d;border:none;padding:6px 16px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;margin-left:8px';
      ok.onclick = () => {
        cleanup();
        $('#sign-cert-name').textContent = state.certificate.commonName;
        $('#sign-cert-issuer-text').textContent = `Emitido por: ${state.certificate.issuerName}`;
        if (state.certificate.email) $('#sign-contact').value = state.certificate.email;
        $('#sign-modal').style.display = 'flex';
      };
      b.appendChild(ok);
      
      const no = document.createElement('button');
      no.textContent = 'Cancelar';
      no.style.cssText = 'background:transparent;color:white;border:1px solid rgba(255,255,255,.5);padding:6px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;margin-left:6px';
      no.onclick = () => {
        const p = document.getElementById('sig-preview');
        if (p) p.remove();
        cleanup();
      };
      b.appendChild(no);
    }
  };
  
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }, 150);
  
  const escHandler = (e) => {
    if (e.key === 'Escape' && state.sigPlacing) {
      const p = document.getElementById('sig-preview');
      if (p) p.remove();
      cleanup();
      showToast('Firma cancelada', 'info');
    }
  };
  document.addEventListener('keydown', escHandler);
}

// Color swatch selection
function initColorSwatches() {
  const container = document.getElementById('sign-border-color');
  if (!container) return;
  container.addEventListener('click', (e) => {
    const label = e.target.closest('label');
    if (!label) return;
    // Update visual ring on all swatches
    container.querySelectorAll('label').forEach(l => {
      const swatch = l.querySelector('.color-swatch');
      const radio = l.querySelector('input[type=radio]');
      if (radio.checked) {
        swatch.style.boxShadow = `0 0 0 2px white, 0 0 0 3px ${radio.value}`;
        swatch.style.border = `3px solid ${radio.value}`;
      } else {
        swatch.style.boxShadow = 'none';
        swatch.style.border = '3px solid transparent';
      }
    });
  });
}

async function handleSign() {
  let reason = $('#sign-reason').value;
  if (reason === 'custom') reason = $('#sign-reason-custom').value || 'Firma digital';
  
  // Get selected border color
  const colorRadio = document.querySelector('input[name="sig-color"]:checked');
  const borderColor = colorRadio ? colorRadio.value : '#B83030';
  
  $('#sign-modal').style.display = 'none';
  
  // Remove preview
  const preview = document.getElementById('sig-preview');
  if (preview) preview.remove();
  
  showLoading('Firmando con PAdES...');
  try {
    const p = state.sigPlacement || { pageIndex: 0, leftPct: 0.05, topPct: 0.85, sigWPct: 0.40, sigHPct: 0.12 };
    const result = await window.signpdf.signPDF({
      reason,
      location: $('#sign-location').value,
      contactInfo: $('#sign-contact').value,
      borderColor,
      pageIndex: p.pageIndex,
      leftPct: p.leftPct,
      topPct: p.topPct,
      sigWPct: p.sigWPct,
      sigHPct: p.sigHPct
    });
    hideLoading();
    if (result.success) showToast('✅ Documento firmado con PAdES', 'success');
    else showToast(`Error: ${result.error}`, 'error');
  } catch (err) { hideLoading(); showToast(`Error: ${err.message}`, 'error'); }
}

// ═══════════════════════════════════════════════════════
// WATERMARK
// ═══════════════════════════════════════════════════════

async function openWatermarkDialog() {
  if (!state.pdf) return showToast('Abre un PDF primero', 'warning');
  
  const text = prompt('Texto de la marca de agua:', 'BORRADOR');
  if (!text) return;
  
  showLoading('Aplicando marca de agua...');
  try {
    const result = await window.signpdf.addWatermark({
      text: text,
      fontSize: 60,
      opacity: 0.15,
      angle: -45,
      color: { r: 0.5, g: 0.5, b: 0.5 }
    });
    hideLoading();
    if (result.success) showToast('✅ Marca de agua aplicada', 'success');
    else showToast(`Error: ${result.error}`, 'error');
  } catch (err) { hideLoading(); showToast(`Error: ${err.message}`, 'error'); }
}

// ═══════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════

function enablePDFButtons(enabled) {
  ['#btn-save','#btn-zoom-in','#btn-zoom-out','#btn-rotate-cw','#btn-rotate-ccw',
   '#btn-delete-page','#btn-split','#btn-extract','#btn-watermark'].forEach(s => { $(s).disabled = !enabled; });
  updateSignButton();
}

function updateSignButton() { $('#btn-sign').disabled = !(state.pdf && state.certificate); }

function updateStatusBar() {
  if (state.pdfName) {
    $('#status-file').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg> ${state.pdfName} — ${state.totalPages} pág.`;
  }
  if (state.certificate) {
    const dot = state.certificate.isExpired?'red':state.certificate.isSelfSigned?'yellow':'green';
    $('#status-cert').innerHTML = `<span class="status-dot ${dot}"></span> ${state.certificate.commonName}`;
  }
}

function showLoading(text) { $('#loading-text').textContent=text||'Procesando...'; $('#loading-overlay').style.display='flex'; }
function hideLoading() { $('#loading-overlay').style.display='none'; }

function showToast(message, type='info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = {success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  t.innerHTML = `<span>${icons[type]||''}</span><span>${message}</span>`;
  $('#toast-container').appendChild(t);
  setTimeout(() => { if(t.parentNode) t.remove(); }, 4000);
}
