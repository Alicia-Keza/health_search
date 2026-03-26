/* ============================================================
   MediSearch — frontend/script.js  (final)
   All fetch calls go to /api/... on our own backend.
   No API keys live in this file.
   ============================================================ */

/* ── State ── */
let selectedSymptoms = [];

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

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
}

/* ══════════════════════════════════════
   DISEASE SEARCH  →  GET /api/icd/search
══════════════════════════════════════ */
function quickSearch(name) {
  $('disease-input').value = name;
  searchDisease();
}

async function searchDisease() {
  const q = $('disease-input').value.trim();
  if (!q) return;

  $('disease-results').innerHTML = '';
  hideError('d-error');
  showLoader('d-loader');
  $('search-btn').disabled = true;

  try {
    const res  = await fetch(`/api/icd/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    const hits = data.destinationEntities || [];
    if (!hits.length) {
      showError('d-error', `No ICD-11 results for "${esc(q)}". Try a different term.`);
      return;
    }

    $('disease-results').innerHTML =
      `<p class="results-info">Top result for "<strong>${esc(q)}</strong>"</p>`;

    renderDiseaseCard(hits[0]);

  } catch (e) {
    showError('d-error', e.message || 'Could not reach the server. Is it running?');
  } finally {
    hideLoader('d-loader');
    $('search-btn').disabled = false;
  }
}


function renderDiseaseCard(hit) {
  const wrap  = $('disease-results');
  const title = stripHtml(hit.title || '');
  const code  = hit.theCode || '';
  const slug    = code || title.replace(/\W/g, '').slice(0, 12);
  const aboutId = 'about-'    + slug;
  const symId   = 'sym-'      + slug;
  const fdaId   = 'fda-'      + slug;

  const card = document.createElement('div');
  card.className = 'disease-card';
  card.innerHTML = `
    <div class="d-name">${esc(title)}</div>
    ${code ? `<span class="d-code">ICD-11: ${esc(code)}</span>` : ''}
    <div id="${aboutId}" class="d-about-block">
      <p class="d-loading">Loading description…</p>
    </div>
    <div id="${symId}" class="d-sym-block">
      <p class="d-loading">Loading symptoms…</p>
    </div>
    <div id="${fdaId}" class="d-fda-block">
      <p class="d-loading">Loading medication…</p>
    </div>
  `;

  wrap.appendChild(card);

  // Description + Symptoms → Wikipedia (one call)
  loadSymptoms(title, aboutId, symId);

  // Medication → OpenFDA
  loadFDA(title, fdaId);
}

/* ══════════════════════════════════════
   DESCRIPTION + SYMPTOMS  →  Wikipedia
══════════════════════════════════════ */
async function loadSymptoms(diseaseName, aboutId, symId) {
  const aboutSec = $(aboutId);
  const symSec   = $(symId);
  try {
    const res  = await fetch(`/api/disease-info?name=${encodeURIComponent(diseaseName)}`);
    const data = await res.json();

    // Description
    if (aboutSec) {
      aboutSec.innerHTML = data.description
        ? `<div class="d-section-label">About</div><p class="d-text">${esc(data.description)}</p>`
        : '';
    }

    // Symptoms
    if (symSec) {
      symSec.innerHTML = data.symptoms?.length
        ? `<div class="d-section-label">🤒 Symptoms</div><ul class="ai-list">${data.symptoms.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`
        : '';
    }
  } catch (_) {
    if (aboutSec) aboutSec.innerHTML = '';
    if (symSec)   symSec.innerHTML   = '';
  }
}

/* ══════════════════════════════════════
   OPENFDA DRUGS  →  GET /api/drugs
══════════════════════════════════════ */
async function loadFDA(query, sectionId) {
  const section = $(sectionId);
  try {
    const res  = await fetch(`/api/drugs?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!section) return;

    if (!res.ok || !data.results?.length) {
      section.innerHTML = '';
      return;
    }

    const names = [];
    data.results.forEach(drug => {
      const brand   = drug.openfda?.brand_name?.[0];
      const generic = drug.openfda?.generic_name?.[0];
      if (brand)   names.push(brand);
      if (generic && generic !== brand) names.push(generic);
    });

    const unique = [...new Set(names)].slice(0, 6);
    if (!unique.length) { section.innerHTML = ''; return; }

    section.innerHTML = `
      <div class="d-section-label">💊 Medication</div>
      <ul class="ai-list">${unique.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="fda-note">Source: OpenFDA. Always consult a doctor before taking any medication.</p>
    `;
  } catch (_) {
    if (section) section.innerHTML = '';
  }
}

/* ══════════════════════════════════════
   SYMPTOM TAG INPUT
══════════════════════════════════════ */
function addSymptom() {
  const input = $('sym-input');
  const val   = input.value.trim();
  if (!val) return;
  // allow comma-separated entry
  val.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
    if (!selectedSymptoms.map(x => x.toLowerCase()).includes(s.toLowerCase())) {
      selectedSymptoms.push(s);
    }
  });
  input.value = '';
  renderTags();
  updateCount();
}

function removeSymptom(idx) {
  selectedSymptoms.splice(idx, 1);
  renderTags();
  updateCount();
}

function renderTags() {
  $('sym-tags').innerHTML = selectedSymptoms.map((s, i) => `
    <span class="sym-tag">
      ${esc(s)}
      <span class="sym-tag-remove" onclick="removeSymptom(${i})">×</span>
    </span>
  `).join('');
}

function updateCount() {
  const n = selectedSymptoms.length;
  $('sym-count').innerHTML = n
    ? `<strong>${n} symptom${n > 1 ? 's' : ''}</strong> added`
    : 'No symptoms added.';
  $('dx-btn').disabled = n === 0;
}

/* ══════════════════════════════════════
   DIAGNOSIS  →  POST /api/diagnosis
══════════════════════════════════════ */
async function runDiagnosis() {
  if (!selectedSymptoms.length) return;

  $('dx-results').innerHTML = '';
  hideError('dx-error');
  showLoader('dx-loader');
  $('dx-btn').disabled = true;

  const gender = $('gender-sel').value;
  const year   = parseInt($('birth-yr').value) || 1990;
  const age    = Math.max(1, Math.min(120, new Date().getFullYear() - year));

  try {
    const res  = await fetch('/api/diagnosis', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symptoms: selectedSymptoms, gender, age }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    $('sym-form-container').style.display = 'none';
    renderDiagnosis(data);

  } catch (e) {
    showError('dx-error', e.message || 'Failed to analyse symptoms. Please try again.');
  } finally {
    hideLoader('dx-loader');
    $('dx-btn').disabled = selectedSymptoms.length === 0;
  }
}

function buildConditionCard(d) {
  const name = d.name  || d.condition || d.diagnosis || d.title || '—';
  const prob = d.probability || d.confidence || d.likelihood || '';
  const desc = d.description || d.details    || d.info       || '';
  const rec  = d.recommendation || d.treatment || '';
  const card = document.createElement('div');
  card.className = 'dx-card dx-card-ai';
  card.innerHTML = `
    <div class="dx-left">
      <div class="dx-name">${esc(name)}</div>
      ${prob ? `<div class="dx-meta">Likelihood: ${esc(String(prob))}</div>` : ''}
      ${desc ? `<div class="dx-ai-text">${esc(desc)}</div>` : ''}
      ${rec  ? `<div class="dx-ai-rec"><strong>Recommendation:</strong> ${esc(rec)}</div>` : ''}
      ${name !== '—' ? `<button class="btn-view" onclick="jumpToSearch('${esc(name).replace(/'/g, "\\'")}')">View in Disease Search →</button>` : ''}
    </div>
  `;
  return card;
}


function renderDiagnosis(data) {
  const wrap = $('dx-results');
  wrap.innerHTML = '';

  // Normalise response — the AI API may nest results differently
  const conditions =
    data.conditions         ||
    data.possibleConditions ||
    data.diagnoses          ||
    data.result?.conditions ||
    data.result?.diagnoses  ||
    (Array.isArray(data) ? data : null);

  if (conditions?.length) {
    wrap.innerHTML = `<div class="dx-heading">Possible Conditions (${conditions.length} found)</div>`;
    conditions.slice(0, 8).forEach(d => wrap.appendChild(buildConditionCard(d)));
  } else {
    // Fallback: render whatever top-level fields came back as a summary card
    wrap.innerHTML = '<div class="dx-heading">Analysis Result</div>';
    const card = document.createElement('div');
    card.className = 'dx-card dx-card-ai';

    const fields = ['summary','overview','assessment','result','recommendations','urgency','urgencyLevel','advice'];
    let html = '';
    fields.forEach(f => {
      if (data[f] && typeof data[f] === 'string') {
        html += `<div class="dx-ai-section"><strong>${f.charAt(0).toUpperCase()+f.slice(1)}:</strong><br>${esc(data[f])}</div>`;
      }
    });
    if (!html) html = `<pre style="font-size:.8rem;white-space:pre-wrap">${esc(JSON.stringify(data, null, 2))}</pre>`;
    card.innerHTML = `<div class="dx-left">${html}</div>`;
    wrap.appendChild(card);
  }

  const note = document.createElement('p');
  note.className = 'dx-disclaimer';
  note.textContent = '⚠ Informational only. Always consult a licensed healthcare professional.';
  wrap.appendChild(note);

  const addMoreBtn = document.createElement('button');
  addMoreBtn.className = 'btn btn-block';
  addMoreBtn.style.marginTop = '1.5rem';
  addMoreBtn.textContent = '+ Check Different Symptoms';
  addMoreBtn.onclick = () => {
    $('dx-results').innerHTML = '';
    $('sym-form-container').style.display = 'block';
  };
  wrap.appendChild(addMoreBtn);
}

function jumpToSearch(name) {
  $('disease-input').value = name;
  switchTab('disease', $('btn-disease'));
  searchDisease();
}