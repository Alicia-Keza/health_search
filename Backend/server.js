require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'Frontend')));

/* ── ICD-11 token cache ── */
let icdToken = null, icdTokenExpiry = 0;
async function getIcdToken() {
  if (icdToken && Date.now() < icdTokenExpiry - 60_000) return icdToken;
  const res  = await fetch('https://icdaccessmanagement.who.int/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.ICD_CLIENT_ID, client_secret: process.env.ICD_CLIENT_SECRET, scope: 'icdapi_access', grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`ICD-11 auth failed (${res.status})`);
  const data = await res.json();
  icdToken = data.access_token;
  icdTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return icdToken;
}

const icdHeaders = async () => ({
  Authorization: 'Bearer ' + await getIcdToken(),
  Accept: 'application/json', 'Accept-Language': 'en', 'API-Version': 'v2',
});

/* ── ICD-11 Search ── */
app.get('/api/icd/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const r = await fetch(`https://id.who.int/icd/release/11/2024-01/mms/search?q=${encodeURIComponent(q)}&useFlexisearch=true&flatResults=true`, { headers: await icdHeaders() });
    if (!r.ok) throw new Error(`ICD-11 search error (${r.status})`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── ICD-11 Entity ── */
app.get('/api/icd/entity', async (req, res) => {
  const { uri } = req.query;
  if (!uri) return res.status(400).json({ error: 'Missing uri' });
  try {
    const r = await fetch(uri.replace('http://', 'https://'), { headers: await icdHeaders() });
    if (!r.ok) throw new Error(`ICD-11 entity error (${r.status})`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Symptom Checker (ICD-11) ── */
app.post('/api/diagnosis', async (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms?.length) return res.status(400).json({ error: 'Missing symptoms' });
  try {
    const headers = await icdHeaders();
    // Search ICD-11 for each symptom, collect unique conditions
    const seen = new Set();
    const conditions = [];
    for (const symptom of symptoms.slice(0, 6)) {
      const r = await fetch(`https://id.who.int/icd/release/11/2024-01/mms/search?q=${encodeURIComponent(symptom)}&useFlexisearch=true&flatResults=true`, { headers });
      if (!r.ok) continue;
      const data = await r.json();
      for (const hit of (data.destinationEntities || []).slice(0, 3)) {
        const name = hit.title?.replace(/<[^>]+>/g, '').trim();
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          conditions.push({ name, description: hit.definition || '', probability: 'Possible' });
        }
      }
    }
    res.json({ conditions: conditions.slice(0, 8) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Wikipedia Symptoms ── */
function stripTags(html = '') {
  return html.replace(/<[^>]+>/g, '').replace(/\[[\d\s,]+\]/g, '').replace(/\s+/g, ' ').trim();
}

app.get('/api/disease-info', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const h = { 'User-Agent': 'HealthSearch/1.0 (educational project)' };
  try {
    // 1 — Find Wikipedia article (strip ICD qualifiers before searching)
    const cleanName = name
      .replace(/,\s*(type\s+)?(un)?specified.*/i, '')
      .replace(/\s+without\s+.*/i, '')
      .replace(/\s+with\s+.*/i, '')
      .trim();
    const searchData = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanName)}&format=json&srlimit=1`, { headers: h }).then(r => r.json());
    const pageTitle  = searchData.query?.search?.[0]?.title;
    if (!pageTitle) return res.json({ notFound: true });

    // 2 — Get description from REST summary (clean 2-sentence plain text)
    const summary = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`, { headers: { ...h, Accept: 'application/json' } }).then(r => r.json());
    const sentences  = (summary.extract || '').match(/[^.!?]+[.!?]+/g) || [];
    const description = sentences.filter(s => s.trim().length > 20).slice(0, 2).join(' ').trim();

    // 3 — Find the symptoms and treatment sections
    const secData      = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=sections&format=json`, { headers: h }).then(r => r.json());
    const sections     = secData.parse?.sections || [];
    const symSection   = sections.find(s => ['signs and symptoms', 'symptoms'].some(k => s.line.toLowerCase().includes(k)));
    const treatSection = sections.find(s => ['treatment', 'management', 'therapy'].some(k => s.line.toLowerCase().includes(k)));

    // 4 — Extract symptoms from section HTML
    let symptoms = [];
    if (symSection) {
      const htmlData = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=${symSection.index}&format=json`, { headers: h }).then(r => r.json());
      const html = htmlData.parse?.text?.['*'] || '';
      // Remove reference footnotes block first
      const cleanHtml = html.replace(/<ol class="references">[\s\S]*?<\/ol>/gi, '');

      // Try bullet <li> items first
      const liItems = [...cleanHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(m => stripTags(m[1]).trim())
        .filter(s => s.length > 5 && s.length < 200 && !s.startsWith('^') && !s.includes('Cite error') && !s.includes('Retrieved'));

      if (liItems.length) {
        symptoms = liItems.slice(0, 8);
      } else {
        // Fallback: extract comma-separated list from first paragraph prose
        const paras = [...cleanHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => stripTags(m[1]).replace(/\[[\d,\s]+\]/g, '').trim()).filter(s => s.length > 30);
        for (const para of paras.slice(0, 3)) {
          const m = para.match(/\b(?:include|includes|are|such as|including)\s+([^.;]+)/i);
          if (m) {
            symptoms = m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 60).slice(0, 8);
            if (symptoms.length >= 2) break;
          }
        }
      }
    }

    // 5 — Extract treatments from treatment section
    let treatments = [];
    if (treatSection) {
      const htmlData = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=${treatSection.index}&format=json`, { headers: h }).then(r => r.json());
      const html = htmlData.parse?.text?.['*'] || '';
      const cleanHtml = html.replace(/<ol class="references">[\s\S]*?<\/ol>/gi, '');
      const liItems = [...cleanHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(m => stripTags(m[1]).trim())
        .filter(s => s.length > 3 && s.length < 200 && !s.startsWith('^') && !s.includes('Cite error') && !s.includes('Retrieved'));
      if (liItems.length) {
        treatments = liItems.slice(0, 6);
      } else {
        const paras = [...cleanHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => stripTags(m[1]).replace(/\[[\d,\s]+\]/g, '').trim()).filter(s => s.length > 30);
        for (const para of paras.slice(0, 3)) {
          const m = para.match(/\b(?:include|includes|are|such as|including|used|involves?)\s+([^.;]+)/i);
          if (m) {
            treatments = m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 80).slice(0, 6);
            if (treatments.length >= 2) break;
          }
        }
      }
    }

    res.json({ title: pageTitle, description, symptoms, treatments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── OpenFDA Drugs ── */
app.get('/api/drugs', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const cleanQ = q.replace(/,\s*(type\s+)?(un)?specified.*/i, '').replace(/\s+without\s+.*/i, '').replace(/\s+with\s+.*/i, '').trim();
    const key = process.env.OPENFDA_KEY ? `&api_key=${process.env.OPENFDA_KEY}` : '';
    const r   = await fetch(`https://api.fda.gov/drug/label.json?search=indications_and_usage:"${encodeURIComponent(cleanQ)}"&limit=3${key}`);
    if (r.status === 404) return res.json({ results: [] });
    if (!r.ok) throw new Error(`OpenFDA error (${r.status})`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Catch-all ── */
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html')));

app.listen(PORT, () => console.log(`MediSearch running at http://localhost:${PORT}`));
