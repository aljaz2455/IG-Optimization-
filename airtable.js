/**
 * Airtable helpers — thin wrapper around the REST API
 */
const fetch = require('node-fetch');

// Load .env if present (local dev)
try { require('dotenv').config(); } catch(_) {}

const BASE_ID  = process.env.AIRTABLE_BASE_ID  || 'appYCG4Sfa4AI0s6W';
const API_KEY  = process.env.AIRTABLE_API_KEY;
if (!API_KEY) throw new Error('AIRTABLE_API_KEY env var is required. Create a .env file.');
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;
const META_URL = `https://api.airtable.com/v0/meta/bases/${BASE_ID}`;

const headers = () => ({
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type':  'application/json'
});

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiRequest(method, url, body) {
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  let res = await fetch(url, opts);
  if (res.status === 429) {
    await sleep(30000);
    res = await fetch(url, opts);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(`Airtable ${method} ${url}: ${JSON.stringify(data)}`);
  return data;
}

async function readAll(table, filterFormula) {
  const rows = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (filterFormula) params.set('filterByFormula', filterFormula);
    if (offset) params.set('offset', offset);
    const data = await apiRequest('GET', `${BASE_URL}/${encodeURIComponent(table)}?${params}`);
    for (const r of (data.records || [])) rows.push({ id: r.id, ...r.fields });
    offset = data.offset;
    if (offset) await sleep(250);
  } while (offset);
  return rows;
}

async function batchInsert(table, records) {
  const chunks = [];
  for (let i = 0; i < records.length; i += 10) chunks.push(records.slice(i, i + 10));
  const created = [];
  for (const chunk of chunks) {
    const data = await apiRequest('POST', `${BASE_URL}/${encodeURIComponent(table)}`,
      { records: chunk.map(f => ({ fields: f })) });
    created.push(...(data.records || []));
    await sleep(250);
  }
  return created;
}

async function batchUpdate(table, updates) {
  const chunks = [];
  for (let i = 0; i < updates.length; i += 10) chunks.push(updates.slice(i, i + 10));
  for (const chunk of chunks) {
    await apiRequest('PATCH', `${BASE_URL}/${encodeURIComponent(table)}`,
      { records: chunk.map(u => ({ id: u.id, fields: u.fields })) });
    await sleep(250);
  }
}

async function deleteRecords(table, ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  for (const chunk of chunks) {
    const params = chunk.map(id => `records[]=${id}`).join('&');
    await apiRequest('DELETE', `${BASE_URL}/${encodeURIComponent(table)}?${params}`);
    await sleep(250);
  }
}

async function listTables() {
  const data = await apiRequest('GET', `${META_URL}/tables`);
  return data.tables || [];
}

async function createTable(schema) {
  return apiRequest('POST', `${META_URL}/tables`, schema);
}

async function addField(tableId, field) {
  return apiRequest('POST', `${META_URL}/tables/${tableId}/fields`, field);
}

module.exports = { BASE_ID, API_KEY, BASE_URL, META_URL, apiRequest, readAll, batchInsert, batchUpdate, deleteRecords, listTables, createTable, addField, sleep };
