// Scrapes og:image thumbnails from air.inc links and writes them to "Thumb URL"
// in the content base. Run daily (GitHub Actions) or manually: node update_thumbs.js
const fetch = require('node-fetch');
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch(_) {}

const API_KEY      = process.env.AIRTABLE_API_KEY;
const CONTENT_BASE = process.env.CONTENT_BASE_ID || 'app8A4YjfUtQACQvb';
if (!API_KEY) { console.error('AIRTABLE_API_KEY env var is required.'); process.exit(1); }

const HDR = { Authorization: `Bearer ${API_KEY}` };

async function listTables() {
  const r = await fetch(`https://api.airtable.com/v0/meta/bases/${CONTENT_BASE}/tables`, { headers: HDR });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.tables;
}

async function readAll(table) {
  const rows = [];
  let offset;
  do {
    const p = new URLSearchParams({ pageSize: '100' });
    if (offset) p.set('offset', offset);
    const r = await fetch(`https://api.airtable.com/v0/${CONTENT_BASE}/${encodeURIComponent(table)}?${p}`, { headers: HDR });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    rows.push(...(d.records || []));
    offset = d.offset;
  } while (offset);
  return rows;
}

async function scrapeOgImage(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
    const t = await r.text();
    const m = t.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/) ||
              t.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/);
    if (!m) return null;
    return m[1].replace(/&amp;/g, '&');
  } catch (e) {
    console.warn('  scrape failed:', url, e.message);
    return null;
  }
}

async function batchUpdate(table, updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const r = await fetch(`https://api.airtable.com/v0/${CONTENT_BASE}/${encodeURIComponent(table)}`, {
      method: 'PATCH',
      headers: { ...HDR, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
  }
}

(async () => {
  const tables = await listTables();
  for (const tbl of tables) {
    const hasThumb = tbl.fields.some(f => f.name === 'Thumb URL');
    const hasUrl   = tbl.fields.some(f => f.name === 'url');
    if (!hasThumb || !hasUrl) { console.log(`skip ${tbl.name} (no Thumb URL/url field)`); continue; }

    const rows = await readAll(tbl.name);
    const todo = rows.filter(r => r.fields.url && !r.fields['Thumb URL']);
    console.log(`${tbl.name}: ${todo.length} records need thumbnails`);

    const updates = [];
    for (const rec of todo) {
      const thumb = await scrapeOgImage(rec.fields.url);
      if (thumb) {
        updates.push({ id: rec.id, fields: { 'Thumb URL': thumb } });
        console.log(`  ✓ ${rec.fields['SET name'] || rec.id}`);
      }
    }
    if (updates.length) await batchUpdate(tbl.name, updates);
    console.log(`${tbl.name}: wrote ${updates.length} thumbnails`);
  }
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
