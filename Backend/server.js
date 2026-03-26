
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
// Only fetch these sections — symptoms + treatment + prevention is all we need
const WIKI_WANTED = ['signs and symptoms', 'symptoms', 'treatment', 'management', 'prevention', 'complications'];

function cleanWikiText(raw = '') {
  return raw
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')        // remove <ref>...</ref>
    .replace(/<ref[^/]*\/>/gi, '')                       // remove self-closing <ref />
    .replace(/\[\[(File|Image):[^\]]*\]\]/gi, '')        // remove [[File:...]] images
    .replace(/\{\{[^}]*\}\}/g, '')                       // remove {{templates}}
    .replace(/\[\[(?:[^\]|]*\|)+([^\]|]+)\]\]/g, '$1')  // [[a|b|c]] → c (last segment)
    .replace(/\[\[([^\]|]+)\]\]/g, '$1')                 // [[link]] → link
    .replace(/'''?/g, '')                                // remove bold/italic markers
    .replace(/==+[^=]+==+/g, '')                         // remove section headers
    .replace(/\[\d+\]/g, '')                             // remove [1] citation markers
    .replace(/^[ \t]*(right|left|thumb|frame|upright|center)\|[^\n]*/gmi, '')  // thumb captions
    .replace(/^=\s*thumb\|[^\n]*/gmi, '')               // = thumb| artifacts
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract bullet-point list items from wikitext (* item)
function extractBullets(raw = '') {
  const lines = raw.split('\n');
  const items = [];
  for (const line of lines) {
    const m = line.match(/^\*+\s*(.+)/);
    if (m) {
      const text = cleanWikiText(m[1]).replace(/\s+/g, ' ').trim();
      if (text.length > 3 && text.length < 200) items.push(text);
    }
  }
  return items;
}

// Truncate a plain string to N sentences (max)
function toSentences(text, max = 2) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  return sentences.slice(0, max).join(' ').trim() || text.substring(0, 200);
}

app.get('/api/disease-info', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'Missing query parameter: name' });

  const headers = { 'User-Agent': 'HealthSearch/1.0 (educational project)' };

  try {
    // 1 — Search for best matching Wikipedia article title
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`;
    const searchData = await fetch(searchUrl, { headers }).then(r => r.json());
    const pageTitle  = searchData.query?.search?.[0]?.title;
    if (!pageTitle) return res.json({ notFound: true });

    // 2 — Get intro summary — keep first 2 sentences only
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
    const summaryData = await fetch(summaryUrl, { headers: { ...headers, Accept: 'application/json' } }).then(r => r.json());
    const overview = toSentences(summaryData.extract || '', 2);

    // 3 — Get section index list
    const secListUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=sections&format=json`;
    const secListData = await fetch(secListUrl, { headers }).then(r => r.json());
    const sections = secListData.parse?.sections || [];

    // 4 — Fetch content of matching sections (level 2 only)
    const wanted = sections.filter(s =>
      s.level === '2' && WIKI_WANTED.some(w => s.line.toLowerCase().includes(w))
    );

    // sectionContents: { title: { items: [...], text: '...' } }
    const sectionContents = {};
    await Promise.all(wanted.map(async s => {
      const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&section=${s.index}&format=json`;
      const data = await fetch(url, { headers }).then(r => r.json());
      const raw  = data.parse?.wikitext?.['*'] || '';
      const items = extractBullets(raw);
      const text  = toSentences(cleanWikiText(raw), 3);
      sectionContents[s.line] = { items: items.slice(0, 8), text: text.substring(0, 300) };
    }));

    res.json({ title: pageTitle, overview, sections: sectionContents });

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
