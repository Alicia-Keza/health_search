
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

/* ══════════════════════════════════════════════════════════
   WHO ICD-11 — OAuth 2.0 token cache
══════════════════════════════════════════════════════════ */
let icdToken       = null;
let icdTokenExpiry = 0;

async function getIcdToken() {
  if (icdToken && Date.now() < icdTokenExpiry - 60_000) return icdToken;

  const body = new URLSearchParams({
    client_id:     process.env.ICD_CLIENT_ID,
    client_secret: process.env.ICD_CLIENT_SECRET,
    scope:         'icdapi_access',
    grant_type:    'client_credentials',
  });

  const res = await fetch('https://icdaccessmanagement.who.int/connect/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ICD-11 auth failed (${res.status}): ${text}`);
  }

  const data     = await res.json();
  icdToken       = data.access_token;
  icdTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return icdToken;
}

/* ══════════════════════════════════════════════════════════
   ROUTE — WHO ICD-11 Search
   GET /api/icd/search?q=malaria
══════════════════════════════════════════════════════════ */
app.get('/api/icd/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });

  try {
    const token = await getIcdToken();
    const url   = `https://id.who.int/icd/release/11/2024-01/mms/search?q=${encodeURIComponent(q)}&useFlexisearch=true&flatResults=true`;

    const apiRes = await fetch(url, {
      headers: {
        Authorization:     'Bearer ' + token,
        Accept:            'application/json',
        'Accept-Language': 'en',
        'API-Version':     'v2',
      },
    });

    if (!apiRes.ok) throw new Error(`ICD-11 search error (${apiRes.status})`);
    res.json(await apiRes.json());

  } catch (e) {
    console.error('[ICD search]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ROUTE — WHO ICD-11 Entity Detail
   GET /api/icd/entity?uri=https://id.who.int/icd/entity/...
══════════════════════════════════════════════════════════ */
app.get('/api/icd/entity', async (req, res) => {
  const uri = req.query.uri;
  if (!uri) return res.status(400).json({ error: 'Missing query parameter: uri' });

  try {
    const token   = await getIcdToken();
    const safeUri = uri.replace('http://', 'https://');

    const apiRes = await fetch(safeUri, {
      headers: {
        Authorization:     'Bearer ' + token,
        Accept:            'application/json',
        'Accept-Language': 'en',
        'API-Version':     'v2',
      },
    });

    if (!apiRes.ok) throw new Error(`ICD-11 entity error (${apiRes.status})`);
    res.json(await apiRes.json());

  } catch (e) {
    console.error('[ICD entity]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ROUTE — AI Medical Diagnosis
   POST /api/diagnosis
   body: { symptoms: ["headache","fever"], gender: "male", age: 30 }
══════════════════════════════════════════════════════════ */
app.post('/api/diagnosis', async (req, res) => {
  const { symptoms, gender, age } = req.body;

  if (!symptoms?.length || !gender) {
    return res.status(400).json({
      error: 'Missing required fields: symptoms (array), gender',
    });
  }

  try {
    const apiRes = await fetch(
      'https://ai-medical-diagnosis-api-symptoms-to-results.p.rapidapi.com/analyzeSymptomsAndDiagnose?noqueue=1',
      {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-rapidapi-key':  process.env.RAPIDAPI_KEY,
          'x-rapidapi-host': 'ai-medical-diagnosis-api-symptoms-to-results.p.rapidapi.com',
        },
        body: JSON.stringify({
          symptoms,
          patientInfo: { age: age || 30, gender },
          lang: 'en',
        }),
      }
    );

    if (!apiRes.ok) throw new Error(`Diagnosis API error (${apiRes.status})`);
    res.json(await apiRes.json());

  } catch (e) {
    console.error('[Diagnosis]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ROUTE — Wikipedia Medical Information
   GET /api/disease-info?name=diabetes
   Fetches summary + Signs/Treatment/Prevention/Complications
   from Wikipedia — completely free, no API key required.
══════════════════════════════════════════════════════════ */
// Strip wiki markup from a plain string
function cleanWikiText(raw = '') {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref[^/]*\/>/gi, '')
    .replace(/\[\[(File|Image):[^\n]*/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)+([^\]|]+)\]\]/g, '$1')
    .replace(/\[\[([^\]|]+)\]\]/g, '$1')
    .replace(/\]\]/g, '').replace(/\[\[/g, '')
    .replace(/'''?/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Truncate plain text to N full sentences
function toSentences(text, max = 2) {
  const sentences = (text.match(/[^.!?]+[.!?]+/g) || [])
    .map(s => s.trim()).filter(s => s.length > 20);
  return sentences.slice(0, max).join(' ').trim() || text.substring(0, 200).trim();
}

// Extract the medical infobox from wikitext and return its fields
function extractInfoboxFields(wikitext) {
  const startMatch = wikitext.match(/\{\{[Ii]nfobox\s+medical/i);
  if (!startMatch) return {};
  let depth = 0, end = startMatch.index;
  for (let i = startMatch.index; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i++; }
    else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      if (depth === 0) { end = i + 2; break; }
      i++;
    }
  }
  const body = wikitext.substring(startMatch.index + 2, end - 2);
  const fields = {};
  let field = null, value = '';
  for (const line of body.split('\n')) {
    const m = line.match(/^\|\s*([\w\s]+?)\s*=\s*(.*)/);
    if (m) {
      if (field) fields[field] = value.trim();
      field = m[1].toLowerCase().trim();
      value = m[2];
    } else if (field) {
      value += ' ' + line.trim();
    }
  }
  if (field) fields[field] = value.trim();
  return fields;
}

// Parse a wikitext list field into a clean string array
function parseListField(raw = '') {
  if (!raw) return [];
  // Handle {{plainlist|...}} or {{ubl|...}}
  const tplMatch = raw.match(/\{\{(?:plainlist|ubl|ublist|hlist)\s*\|([\s\S]*?)\}\}/i);
  if (tplMatch) {
    return tplMatch[1].split(/\n\*\s*|\|\s*/)
      .map(s => cleanWikiText(s).trim()).filter(s => s.length > 2).slice(0, 8);
  }
  // Handle * bullet lines
  const bullets = [...raw.matchAll(/^\*+\s*(.+)/gm)].map(m => cleanWikiText(m[1]).trim()).filter(s => s.length > 2);
  if (bullets.length) return bullets.slice(0, 8);
  // Fall back to comma-separated
  return raw.split(/,|;/).map(s => cleanWikiText(s).trim()).filter(s => s.length > 2).slice(0, 8);
}

app.get('/api/disease-info', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'Missing query parameter: name' });

  const headers = { 'User-Agent': 'HealthSearch/1.0 (educational project)' };

  try {
    // 1 — Find best matching Wikipedia article
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`;
    const searchData = await fetch(searchUrl, { headers }).then(r => r.json());
    const pageTitle  = searchData.query?.search?.[0]?.title;
    if (!pageTitle) return res.json({ notFound: true });

    // 2 — Fetch short description + lead section wikitext (contains infobox) in parallel
    const [summaryData, wikiData] = await Promise.all([
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
        { headers: { ...headers, Accept: 'application/json' } }).then(r => r.json()),
      fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvsection=0&titles=${encodeURIComponent(pageTitle)}&format=json`,
        { headers }).then(r => r.json()),
    ]);

    const description = toSentences(summaryData.extract || '', 2);
    const wikitext    = Object.values(wikiData.query?.pages || {})[0]?.revisions?.[0]?.['*'] || '';

    // 3 — Parse infobox fields
    const fields     = extractInfoboxFields(wikitext);
    const symptoms   = parseListField(fields.symptoms   || fields['signs and symptoms'] || '');
    const medication = parseListField(fields.medication || fields.treatment             || fields.medications || '');

    res.json({ title: pageTitle, description, symptoms, medication });

  } catch (e) {
    console.error('[DiseaseInfo/Wikipedia]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ROUTE — OpenFDA Drug Labels
   GET /api/drugs?q=malaria
══════════════════════════════════════════════════════════ */
app.get('/api/drugs', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing query parameter: q' });

  try {
    const key    = process.env.OPENFDA_KEY ? `&api_key=${process.env.OPENFDA_KEY}` : '';
    const url    = `https://api.fda.gov/drug/label.json?search=indications_and_usage:"${encodeURIComponent(q)}"&limit=3${key}`;
    const apiRes = await fetch(url);

    if (apiRes.status === 404) return res.json({ results: [] });
    if (!apiRes.ok)            throw new Error(`OpenFDA error (${apiRes.status})`);

    res.json(await apiRes.json());

  } catch (e) {
    console.error('[OpenFDA]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   Catch-all — serve frontend for any unmatched route
══════════════════════════════════════════════════════════ */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
});

/* ══════════════════════════════════════════════════════════
   START
══════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n  MediSearch running at http://localhost:${PORT}\n`);
  if (!process.env.ICD_CLIENT_ID)
    console.warn('  ⚠  ICD_CLIENT_ID missing from .env');
  if (!process.env.ICD_CLIENT_SECRET)
    console.warn('  ⚠  ICD_CLIENT_SECRET missing from .env');
  if (!process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_KEY.includes('YOUR_'))
    console.warn('  ⚠  RAPIDAPI_KEY not set — Symptom Checker will not work');
});
