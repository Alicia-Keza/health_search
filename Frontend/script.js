/* ============================================================
   MediSearch — frontend/script.js
   STAGE 1: Utilities, tab switching, and hardcoded fake data
   so the UI can be tested before the backend is ready.
   ============================================================ */

/* ── State ── */
let allSymptoms    = [];
let selectedIds    = new Set();
let symptomsLoaded = false;

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

function showLoader(id) { $(id).classList.add('show'); }
function hideLoader(id) { $(id).classList.remove('show'); }

function showError(id, msg) {
  const el = $(id);
  el.textContent = '⚠ ' + msg;
  el.classList.add('show');
}
function hideError(id) { $(id).classList.remove('show'); }

/* Escape HTML to prevent XSS */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Strip HTML tags from WHO API text fields */
function stripHtml(s) {
  const div = document.createElement('div');
  div.innerHTML = s || '';
  return div.textContent || div.innerText || '';
}

/* ══════════════════════════════════════
   TAB SWITCHING
══════════════════════════════════════ */
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'symptom' && !symptomsLoaded) loadSymptoms();
}

/* ══════════════════════════════════════
   DISEASE SEARCH — using fake data for now
   (will be replaced with real /api/icd/search call)
══════════════════════════════════════ */

/* Fake dataset to test UI rendering before backend exists */
const FAKE_DISEASES = {
  malaria: {
    destinationEntities: [
      {
        title: 'Malaria',
        theCode: '1F40',
        chapter: 'Certain infectious or parasitic diseases',
        definition: 'Malaria is a life-threatening disease caused by Plasmodium parasites transmitted through the bites of infected female Anopheles mosquitoes.',
        synonyms: ['Marsh fever', 'Paludism', 'Swamp fever'],
      }
    ]
  },
  diabetes: {
    destinationEntities: [
      {
        title: 'Type 2 Diabetes Mellitus',
        theCode: '5A11',
        chapter: 'Endocrine, nutritional or metabolic diseases',
        definition: 'A metabolic disorder characterised by hyperglycaemia resulting from defects in insulin secretion, insulin action, or both.',
        synonyms: ['Non-insulin-dependent diabetes', 'Adult-onset diabetes'],
      }
    ]
  },
};

function quickSearch(name) {
  $('disease-input').value = name;
  searchDisease();
}

function searchDisease() {
  const q = $('disease-input').value.trim().toLowerCase();
  if (!q) return;

  $('disease-results').innerHTML = '';
  hideError('d-error');
  showLoader('d-loader');
  $('search-btn').disabled = true;

  /* Simulate async delay */
  setTimeout(() => {
    hideLoader('d-loader');
    $('search-btn').disabled = false;

    /* Look up fake data */
    const match = Object.keys(FAKE_DISEASES).find(k => q.includes(k));
    if (!match) {
      showError('d-error', `No results for "${esc(q)}". (Using fake data — backend not connected yet.)`);
      return;
    }

    const data = FAKE_DISEASES[match];
    const hits = data.destinationEntities || [];

    $('disease-results').innerHTML =
      `<p class="results-info">Showing ${hits.length} result(s) for "<strong>${esc(q)}</strong>" <em>(fake data)</em></p>`;

    hits.forEach(hit => renderDiseaseCard(hit));
  }, 600);
}

/* ══════════════════════════════════════
   RENDER DISEASE CARD
══════════════════════════════════════ */
function renderDiseaseCard(hit) {
  const wrap    = $('disease-results');
  const title   = stripHtml(hit.title   || '');
  const code    = hit.theCode           || '';
  const chapter = stripHtml(hit.chapter || '');
  const defn    = stripHtml(hit.definition || '');
  const synonyms = (hit.synonyms || []).slice(0, 10);
  const fdaId   = 'fda-' + (code || title.replace(/\W/g, '').slice(0, 12));

  const card = document.createElement('div');
  card.className = 'disease-card';
  card.innerHTML = `
    <div class="d-name">${esc(title)}</div>
    ${code    ? `<span class="d-code">ICD-11: ${esc(code)}</span>` : ''}
    ${chapter ? `<div class="d-section-label">Chapter</div><p class="d-text">${esc(chapter)}</p>` : ''}
    ${defn    ? `<div class="d-section-label">Definition</div><p class="d-text">${esc(defn)}</p>` : ''}
    ${synonyms.length ? `
      <div class="d-section-label">Also Known As</div>
      <div class="d-synonyms">
        ${synonyms.map(s => `<span class="syn-tag">${esc(s)}</span>`).join('')}
      </div>` : ''}
    <div class="fda-block" id="${fdaId}">
      <div class="fda-heading">💊 Related Medicines (OpenFDA)</div>
      <p style="font-size:.82rem;color:#bbb;font-style:italic">Backend not connected yet.</p>
    </div>
  `;
  wrap.appendChild(card);
}

/* ── Placeholder — will be implemented when backend is ready ── */
function loadSymptoms() {}
function runDiagnosis()  {}
function jumpToSearch(name) {
  $('disease-input').value = name;
  switchTab('disease', $('btn-disease'));
  searchDisease();
}