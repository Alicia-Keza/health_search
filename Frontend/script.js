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
      `<p class="results-info">Showing ${Math.min(hits.length, 5)} of ${hits.length} result(s) for "<strong>${esc(q)}</strong>"</p>`;

    hits.slice(0, 5).forEach(hit => renderDiseaseCard(hit));

  } catch (e) {
    showError('d-error', e.message || 'Could not reach the server. Is it running?');
  } finally {
    hideLoader('d-loader');
    $('search-btn').disabled = false;
  }
}

function renderDiseaseCard(hit) {
  const wrap     = $('disease-results');
  const title    = stripHtml(hit.title    || '');
  const code     = hit.theCode            || '';
  const chapter  = stripHtml(hit.chapter  || '');
  const defn     = stripHtml(hit.definition || '');
  const note     = stripHtml(hit.longDefinition || hit.note || '');
  const synonyms = (hit.synonyms || hit.inclusion || [])
    .map(s => stripHtml(typeof s === 'object' ? s.label || '' : s))
    .filter(Boolean).slice(0, 10);

  const fdaId = 'fda-' + (code || title.replace(/\W/g, '').slice(0, 12));

  const card = document.createElement('div');
  card.className = 'disease-card';
  card.innerHTML = `
    <div class="d-name">${esc(title)}</div>
    ${code    ? `<span class="d-code">ICD-11: ${esc(code)}</span>` : ''}
    ${chapter ? `<div class="d-section-label">Chapter</div><p class="d-text">${esc(chapter)}</p>` : ''}
    ${defn    ? `<div class="d-section-label">Definition</div><p class="d-text">${esc(defn)}</p>` : ''}
    ${note    ? `<div class="d-section-label">Clinical Notes</div><p class="d-text">${esc(note)}</p>` : ''}
    ${synonyms.length ? `
      <div class="d-section-label">Also Known As</div>
      <div class="d-synonyms">
        ${synonyms.map(s => `<span class="syn-tag">${esc(s)}</span>`).join('')}
      </div>` : ''}
    <div class="fda-block" id="${fdaId}">
      <div class="fda-heading">💊 Related Medicines (OpenFDA)</div>
      <p style="font-size:.82rem;color:#bbb;font-style:italic">Loading…</p>
    </div>
  `;

  wrap.appendChild(card);
  loadFDA(title, fdaId);
}

/* ══════════════════════════════════════
   OPENFDA DRUGS  →  GET /api/drugs
══════════════════════════════════════ */
async function loadFDA(query, sectionId) {
  try {
    const res     = await fetch(`/api/drugs?q=${encodeURIComponent(query)}`);
    const data    = await res.json();
    const section = $(sectionId);
    if (!section) return;

    if (!res.ok || !data.results?.length) {
      section.querySelector('p').textContent = 'No FDA drug data found for this condition.';
      return;
    }

    section.innerHTML = `
      <div class="fda-heading">💊 Related Medicines (OpenFDA)</div>
      ${data.results.map(drug => {
        const brand   = drug.openfda?.brand_name?.slice(0, 2).join(' / ') || 'Unknown Brand';
        const generic = drug.openfda?.generic_name?.[0] || '';
        const use     = drug.indications_and_usage?.[0]?.substring(0, 200) || '';
        return `
          <div class="drug-card">
            <div class="drug-brand">${esc(brand)}</div>
            ${generic ? `<div class="drug-generic">Generic: ${esc(generic)}</div>` : ''}
            ${use     ? `<div class="drug-use">${esc(use)}${use.length >= 200 ? '…' : ''}</div>` : ''}
          </div>`;
      }).join('')}
      <p class="fda-note">Source: OpenFDA. Consult a licensed doctor before taking any medication.</p>
    `;
  } catch (_) {
    const section = $(sectionId);
    if (section) section.querySelector('p').textContent = 'Could not load drug data.';
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
  const age    = new Date().getFullYear() - year;

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
    conditions.slice(0, 8).forEach(d => {
      const name  = d.name  || d.condition || d.diagnosis || d.title || '—';
      const prob  = d.probability || d.confidence || d.likelihood || '';
      const desc  = d.description || d.details    || d.info       || '';
      const rec   = d.recommendation || d.treatment || '';

      const card = document.createElement('div');
      card.className = 'dx-card dx-card-ai';
      card.innerHTML = `
        <div class="dx-left">
          <div class="dx-name">${esc(name)}</div>
          ${prob ? `<div class="dx-meta">Likelihood: ${esc(String(prob))}</div>` : ''}
          ${desc ? `<div class="dx-ai-text">${esc(desc)}</div>` : ''}
          ${rec  ? `<div class="dx-ai-rec"><strong>Recommendation:</strong> ${esc(rec)}</div>` : ''}
          <button class="btn-view" onclick="jumpToSearch('${esc(name).replace(/'/g, "\\'")}')">
            View in Disease Search →
          </button>
        </div>
      `;
      wrap.appendChild(card);
    });
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