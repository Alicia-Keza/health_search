let selectedSymptoms = [];

/* ── Utilities ── */
const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const stripHtml = s => { const d = document.createElement('div'); d.innerHTML = s||''; return d.textContent||d.innerText||''; };
const showLoader = id => $(id).classList.add('show');
const hideLoader = id => $(id).classList.remove('show');
const showError  = (id, msg) => { $(id).textContent = '⚠ '+msg; $(id).classList.add('show'); };
const hideError  = id => $(id).classList.remove('show');

/* ── Tab switching ── */
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  btn.classList.add('active');
}

/* ── Disease Search ── */
const quickSearch = name => { $('disease-input').value = name; searchDisease(); };

async function searchDisease() {
  const q = $('disease-input').value.trim();
  if (!q) return;
  $('disease-results').innerHTML = '';
  hideError('d-error'); showLoader('d-loader'); $('search-btn').disabled = true;
  try {
    const res  = await fetch(`/api/icd/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    const hits = data.destinationEntities || [];
    if (!hits.length) { showError('d-error', `No results for "${esc(q)}". Try a different term.`); return; }
    $('disease-results').innerHTML = `<p class="results-info">Top result for "<strong>${esc(q)}</strong>"</p>`;
    renderDiseaseCard(hits[0]);
  } catch (e) {
    showError('d-error', e.message || 'Could not reach the server.');
  } finally {
    hideLoader('d-loader'); $('search-btn').disabled = false;
  }
}

function renderDiseaseCard(hit) {
  const title = stripHtml(hit.title || '');
  const code  = hit.theCode || '';
  const slug  = code || title.replace(/\W/g,'').slice(0,12);
  const [aId, sId, fId] = ['about-'+slug, 'sym-'+slug, 'fda-'+slug];
  const card = document.createElement('div');
  card.className = 'disease-card';
  card.innerHTML = `
    <div class="d-name">${esc(title)}</div>
    ${code ? `<span class="d-code">ICD-11: ${esc(code)}</span>` : ''}
    <div id="${aId}"><p class="d-loading">Loading description…</p></div>
    <div id="${sId}"><p class="d-loading">Loading symptoms…</p></div>
    <div id="${fId}"><p class="d-loading">Loading medication…</p></div>
  `;
  $('disease-results').appendChild(card);
  loadSymptoms(title, aId, sId);
  loadFDA(title, fId, sId);
}

/* ── Description + Symptoms  */
async function loadSymptoms(name, aId, sId) {
  try {
    const data = await fetch(`/api/disease-info?name=${encodeURIComponent(name)}`).then(r => r.json());
    if ($(aId)) $(aId).innerHTML = data.description ? `<div class="d-section-label">About</div><p class="d-text">${esc(data.description)}</p>` : '';
    if ($(sId)) $(sId).innerHTML = data.symptoms?.length ? `<div class="d-section-label">🤒 Symptoms</div><ul class="ai-list">${data.symptoms.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>` : '';
    // Store wiki treatments on the element for FDA fallback
    if ($(sId)) $(sId).dataset.treatments = JSON.stringify(data.treatments || []);
  } catch (_) { if ($(aId)) $(aId).innerHTML=''; if ($(sId)) $(sId).innerHTML=''; }
}

/* ── Medication (OpenFDA) ── */
async function loadFDA(query, fId, sId) {
  try {
    const data = await fetch(`/api/drugs?q=${encodeURIComponent(query)}`).then(r => r.json());
    const sec  = $(fId);
    if (!sec) return;
    const names = [...new Set((data.results||[]).flatMap(d => [d.openfda?.brand_name?.[0], d.openfda?.generic_name?.[0]].filter(Boolean)))].slice(0,6);
    if (names.length) {
      sec.innerHTML = `<div class="d-section-label">💊 Medication</div><ul class="ai-list">${names.map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p class="fda-note">Source: OpenFDA. Always consult a doctor before taking any medication.</p>`;
    } else {
      // Fallback: use Wikipedia treatments
      const treatments = JSON.parse($(sId)?.dataset.treatments || '[]');
      sec.innerHTML = treatments.length ? `<div class="d-section-label">💊 Treatment</div><ul class="ai-list">${treatments.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p class="fda-note">Source: Wikipedia. Always consult a doctor before taking any medication.</p>` : '';
    }
  } catch (_) { if ($(fId)) $(fId).innerHTML=''; }
}

/* ── Symptom Tag Input ── */
function addSymptom() {
  const input = $('sym-input');
  input.value.trim().split(',').map(s=>s.trim()).filter(Boolean).forEach(s => {
    if (!selectedSymptoms.map(x=>x.toLowerCase()).includes(s.toLowerCase())) selectedSymptoms.push(s);
  });
  input.value = '';
  renderTags(); updateCount();
}
function toggleCheckSymptom(name, checked) {
  if (checked) {
    if (!selectedSymptoms.map(x=>x.toLowerCase()).includes(name.toLowerCase())) selectedSymptoms.push(name);
  } else {
    const i = selectedSymptoms.findIndex(x => x.toLowerCase() === name.toLowerCase());
    if (i !== -1) selectedSymptoms.splice(i, 1);
  }
  renderTags(); updateCount();
}
const removeSymptom = idx => {
  const name = selectedSymptoms[idx];
  selectedSymptoms.splice(idx, 1);
  const cb = document.querySelector(`input[data-sym="${name}"]`);
  if (cb) cb.checked = false;
  renderTags(); updateCount();
};
const renderTags = () => { $('sym-tags').innerHTML = selectedSymptoms.map((s,i) => `<span class="sym-tag">${esc(s)}<span class="sym-tag-remove" onclick="removeSymptom(${i})">×</span></span>`).join(''); };
function updateCount() {
  const n = selectedSymptoms.length;
  $('sym-count').innerHTML = n ? `<strong>${n} symptom${n>1?'s':''}</strong> added` : 'No symptoms added.';
  $('dx-btn').disabled = n === 0;
}

/* ── Symptom Checker ── */
async function runDiagnosis() {
  if (!selectedSymptoms.length) return;
  $('dx-results').innerHTML = ''; hideError('dx-error'); showLoader('dx-loader'); $('dx-btn').disabled = true;
  const age = Math.max(1, Math.min(120, new Date().getFullYear() - (parseInt($('birth-yr').value)||1990)));
  try {
    const res  = await fetch('/api/diagnosis', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symptoms: selectedSymptoms, gender: $('gender-sel').value, age }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    $('sym-form-container').style.display = 'none';
    renderDiagnosis(data);
  } catch (e) {
    showError('dx-error', e.message || 'Failed to analyse symptoms. Please try again.');
  } finally {
    hideLoader('dx-loader'); $('dx-btn').disabled = selectedSymptoms.length === 0;
  }
}

function buildConditionCard(d) {
  const name = d.name||d.condition||d.diagnosis||d.title||'—';
  const card = document.createElement('div');
  card.className = 'dx-card dx-card-ai';
  card.innerHTML = `<div class="dx-left">
    <div class="dx-name">${esc(name)}</div>
    ${d.probability||d.confidence||d.likelihood ? `<div class="dx-meta">Likelihood: ${esc(String(d.probability||d.confidence||d.likelihood))}</div>` : ''}
    ${d.description||d.details||d.info ? `<div class="dx-ai-text">${esc(d.description||d.details||d.info)}</div>` : ''}
    ${d.recommendation||d.treatment ? `<div class="dx-ai-rec"><strong>Recommendation:</strong> ${esc(d.recommendation||d.treatment)}</div>` : ''}
    ${name!=='—' ? `<button class="btn-view" onclick="jumpToSearch('${esc(name).replace(/'/g,"\\'")}')">View in Disease Search →</button>` : ''}
  </div>`;
  return card;
}

function renderDiagnosis(data) {
  const wrap = $('dx-results');
  wrap.innerHTML = '';
  const conditions = data.conditions||data.possibleConditions||data.diagnoses||data.result?.conditions||data.result?.diagnoses||(Array.isArray(data)?data:null);

  if (conditions?.length) {
    wrap.innerHTML = `<div class="dx-heading">Possible Conditions (${conditions.length} found)</div>`;
    conditions.slice(0,8).forEach(d => wrap.appendChild(buildConditionCard(d)));
  } else {
    wrap.innerHTML = '<div class="dx-heading">Analysis Result</div>';
    const card = document.createElement('div');
    card.className = 'dx-card dx-card-ai';
    const fields = ['summary','overview','assessment','result','recommendations','urgency','urgencyLevel','advice'];
    const html = fields.filter(f => data[f] && typeof data[f]==='string').map(f => `<div class="dx-ai-section"><strong>${f.charAt(0).toUpperCase()+f.slice(1)}:</strong><br>${esc(data[f])}</div>`).join('') || `<pre style="font-size:.8rem;white-space:pre-wrap">${esc(JSON.stringify(data,null,2))}</pre>`;
    card.innerHTML = `<div class="dx-left">${html}</div>`;
    wrap.appendChild(card);
  }

  const note = document.createElement('p');
  note.className = 'dx-disclaimer';
  note.textContent = '⚠ Informational only. Always consult a licensed healthcare professional.';
  wrap.appendChild(note);

  const btn = document.createElement('button');
  btn.className = 'btn btn-block'; btn.style.marginTop = '1.5rem'; btn.textContent = '+ Check Different Symptoms';
  btn.onclick = () => {
    $('dx-results').innerHTML='';
    $('sym-form-container').style.display='block';
    selectedSymptoms=[];
    document.querySelectorAll('.symptom-checklist input[type="checkbox"]').forEach(cb => cb.checked=false);
    renderTags(); updateCount();
  };
  wrap.appendChild(btn);
}

const jumpToSearch = name => { $('disease-input').value=name; switchTab('disease',$('btn-disease')); searchDisease(); };
