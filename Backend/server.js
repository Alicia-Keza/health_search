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

/* ── Symptom Checker (RapidAPI) ── */
app.post('/api/diagnosis', async (req, res) => {
  const { symptoms, gender, age } = req.body;
  if (!symptoms?.length || !gender) return res.status(400).json({ error: 'Missing symptoms or gender' });
  try {
    const r = await fetch('https://ai-medical-diagnosis-api-symptoms-to-results.p.rapidapi.com/analyzeSymptomsAndDiagnose?noqueue=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rapidapi-key': process.env.RAPIDAPI_KEY, 'x-rapidapi-host': 'ai-medical-diagnosis-api-symptoms-to-results.p.rapidapi.com' },
      body: JSON.stringify({ symptoms, patientInfo: { age: age || 30, gender }, lang: 'en' }),
    });
    if (!r.ok) throw new Error(`Diagnosis API error (${r.status})`);
    res.json(await r.json());
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
    const searchData = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`, { headers: h }).then(r => r.json());
    const pageTitle  = searchData.query?.search?.[0]?.title;
    if (!pageTitle) return res.json({ notFound: true });

    const secData    = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=sections&format=json`, { headers: h }).then(r => r.json());
    const symSection = (secData.parse?.sections || []).find(s => ['signs and symptoms', 'symptoms'].some(k => s.line.toLowerCase().includes(k)));

    let symptoms = [];
    if (symSection) {
      const htmlData = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=${symSection.index}&format=json`, { headers: h }).then(r => r.json());
      symptoms = [...(htmlData.parse?.text?.['*'] || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(m => stripTags(m[1]).trim()).filter(s => s.length > 4 && s.length < 200).slice(0, 8);
    }

    res.json({ title: pageTitle, symptoms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── OpenFDA Drugs ── */
app.get('/api/drugs', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const key = process.env.OPENFDA_KEY ? `&api_key=${process.env.OPENFDA_KEY}` : '';
    const r   = await fetch(`https://api.fda.gov/drug/label.json?search=indications_and_usage:"${encodeURIComponent(q)}"&limit=3${key}`);
    if (r.status === 404) return res.json({ results: [] });
    if (!r.ok) throw new Error(`OpenFDA error (${r.status})`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Catch-all ── */
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html')));

app.listen(PORT, () => console.log(`MediSearch running at http://localhost:${PORT}`));
