/**
 * DAILY PLAN BUILDER
 * ==================
 * Generates today's IG posting schedule for each active account:
 *   - N stories  (default 5) — fresh content, respects cooldown
 *   - N new reels (default 1) — never/rarely posted, lowest PostCount
 *   - N trial reels (default 2) — reposts of best-performing content
 *
 * Writes rows into DailyPlan (tagged with today's date).
 * Re-running on the same day replaces that day's rows.
 *
 * Run: node daily_plan.js [--date YYYY-MM-DD] [--dry-run]
 */

const { readAll, batchInsert, deleteRecords, sleep, API_KEY } = require('./airtable');
const fetch = require('node-fetch');

const ACCOUNTS_BASE  = process.env.ACCOUNTS_BASE_ID || 'appkOOpwWXWRxYjbH';
const AT_ACC         = `https://api.airtable.com/v0/${ACCOUNTS_BASE}`;
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT        = process.env.TELEGRAM_CHAT_ID   || '';

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  });
}

async function readAccBase(table) {
  const rows = [];
  let offset;
  do {
    const p = new URLSearchParams({ pageSize: '100' });
    if (offset) p.set('offset', offset);
    const r = await fetch(`${AT_ACC}/${encodeURIComponent(table)}?${p}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`Accounts base: ${JSON.stringify(d)}`);
    for (const rec of (d.records || [])) rows.push({ id: rec.id, ...rec.fields });
    offset = d.offset;
    if (offset) await sleep(250);
  } while (offset);
  return rows;
}

const args = process.argv.slice(2);
const TODAY = args.find((a, i) => args[i - 1] === '--date') || new Date().toISOString().split('T')[0];
const DRY_RUN = args.includes('--dry-run');

// Defaults — overridden by Settings table
let STORIES_PER_DAY      = 5;
let REELS_NEW_PER_DAY    = 1;
let REELS_TRIAL_PER_DAY  = 2;   // fallback; per-account overridden by TRIAL_SCHEDULE
let STORY_COOLDOWN_DAYS  = 7;
let REEL_NEW_COOLDOWN    = 30;
let TRIAL_MIN_POSTS      = 1;
let SCORE_W_VIEWS        = 0.4;
let SCORE_W_LIKES        = 0.3;
let SCORE_W_SAVES        = 0.3;
let WARMUP_DURATION_DAYS = 14;
let TRIAL_SCHEDULE       = [0, 0, 1, 2]; // index = week-1; last value repeats

function loadSettings(rows) {
  const sv = {};
  for (const r of rows) if (r.Setting) sv[r.Setting] = r.Value;
  const num  = (k, d) => { const v = parseFloat(sv[k]); return isNaN(v) ? d : v; };
  STORIES_PER_DAY      = Math.round(num('StoriesPerDay',       STORIES_PER_DAY));
  REELS_NEW_PER_DAY    = Math.round(num('ReelsNewPerDay',      REELS_NEW_PER_DAY));
  REELS_TRIAL_PER_DAY  = Math.round(num('ReelsTrialPerDay',    REELS_TRIAL_PER_DAY));
  STORY_COOLDOWN_DAYS  = num('StoryCooldownDays',   STORY_COOLDOWN_DAYS);
  REEL_NEW_COOLDOWN    = num('ReelNewCooldownDays',  REEL_NEW_COOLDOWN);
  TRIAL_MIN_POSTS      = num('TrialMinPosts',         TRIAL_MIN_POSTS);
  SCORE_W_VIEWS        = num('ScoreWeightViews',      SCORE_W_VIEWS);
  SCORE_W_LIKES        = num('ScoreWeightLikes',      SCORE_W_LIKES);
  SCORE_W_SAVES        = num('ScoreWeightSaves',      SCORE_W_SAVES);
  WARMUP_DURATION_DAYS = num('WarmupDurationDays',    WARMUP_DURATION_DAYS);
  if (sv['TrialReelsPerWeek']) {
    TRIAL_SCHEDULE = sv['TrialReelsPerWeek'].split(',').map(v => parseInt(v.trim()) || 0);
  }
}

// Returns number of trial reels for an account based on how many weeks it has been Live
function trialReelsForAccount(acc) {
  const created = acc['Date Created'];
  if (!created) return REELS_TRIAL_PER_DAY;
  const elapsed  = Math.floor((Date.now() - new Date(created).getTime()) / 86400000);
  const daysLive = elapsed - WARMUP_DURATION_DAYS;
  if (daysLive <= 0) return 0; // still in warmup — should not happen (filtered), safety guard
  const week = Math.floor(daysLive / 7); // 0-based
  return TRIAL_SCHEDULE[Math.min(week, TRIAL_SCHEDULE.length - 1)];
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff / (1000 * 60 * 60 * 24);
}

// Compute normalized performance score for a content piece
function computeScore(c, maxViews, maxLikes, maxSaves) {
  const v = maxViews > 0 ? (c.AvgViews  || 0) / maxViews : 0;
  const l = maxLikes > 0 ? (c.AvgLikes  || 0) / maxLikes : 0;
  const s = maxSaves > 0 ? (c.AvgSaves  || 0) / maxSaves : 0;  // AvgSaves may not exist
  return SCORE_W_VIEWS * v + SCORE_W_LIKES * l + SCORE_W_SAVES * s;
}

function pickStories(content, account, n) {
  const pool = content.filter(c =>
    c.Account === account &&
    c.Type === 'Story' &&
    c.Status !== 'Archived' &&
    daysSince(c.LastPosted) >= STORY_COOLDOWN_DAYS
  );
  // Shuffle for variety (not pure performance-ranked for stories)
  const shuffled = pool.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function pickNewReels(content, account, n) {
  const pool = content.filter(c =>
    c.Account === account &&
    c.Type === 'Reel' &&
    c.Status !== 'Archived' &&
    daysSince(c.LastPosted) >= REEL_NEW_COOLDOWN
  );
  // Sort by PostCount asc (prefer unposted), then by DateAdded asc (older first)
  pool.sort((a, b) => (a.PostCount || 0) - (b.PostCount || 0) || new Date(a.DateAdded || 0) - new Date(b.DateAdded || 0));
  return pool.slice(0, n);
}

function pickTrialReels(content, account, n, excludeIds) {
  const pool = content.filter(c =>
    c.Account === account &&
    c.Type === 'Reel' &&
    c.Status !== 'Archived' &&
    (c.PostCount || 0) >= TRIAL_MIN_POSTS &&
    !excludeIds.has(c.ContentID || c.id)
  );
  // Sort by AvgScore desc (best performers first)
  const maxViews = Math.max(...pool.map(c => c.AvgViews || 0), 1);
  const maxLikes = Math.max(...pool.map(c => c.AvgLikes || 0), 1);
  const maxSaves = 1; // placeholder
  pool.sort((a, b) =>
    computeScore(b, maxViews, maxLikes, maxSaves) - computeScore(a, maxViews, maxLikes, maxSaves)
  );
  return pool.slice(0, n);
}

function makeSlotOrder(slotType) {
  const order = {
    'Story 1': 1, 'Story 2': 2, 'Story 3': 3, 'Story 4': 4, 'Story 5': 5,
    'Reel New': 6, 'Reel Trial 1': 7, 'Reel Trial 2': 8,
  };
  return order[slotType] || 99;
}

async function main() {
  console.log(`\n🗓  IG Daily Plan Builder — ${TODAY}${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log('────────────────────────────────────────');

  const [settings, igAccounts, content, existingPlan] = await Promise.all([
    readAll('Settings'),
    readAccBase('Instagram Accounts'),
    readAll('ContentLibrary'),
    readAll('DailyPlan', `{Date}='${TODAY}'`),
  ]);

  loadSettings(settings);
  console.log(`Settings: ${STORIES_PER_DAY} stories | ${REELS_NEW_PER_DAY} new reel | ${REELS_TRIAL_PER_DAY} trial reels`);

  // ── Suspended account notifications ─────────────────────────────────────
  const suspendedToday = igAccounts.filter(a => {
    if (!a.Status) return false;
    const status = a.Status.trim();
    if (status !== 'Suspended') return false;
    // Notify only if Suspension Date = today (freshly suspended)
    const suspDate = a['Suspension Date'] || '';
    return suspDate === TODAY;
  });

  for (const acc of suspendedToday) {
    const name        = (acc.Username || '').trim() || acc.id;
    const created     = acc['Date Created'] || '';
    const suspDate    = acc['Suspension Date'] || TODAY;
    const totalDays   = created ? Math.floor((new Date(suspDate) - new Date(created)) / 86400000) : null;
    const liveDays    = totalDays != null ? Math.max(0, totalDays - WARMUP_DURATION_DAYS) : null;
    const warmupDays  = totalDays != null ? Math.min(totalDays, WARMUP_DURATION_DAYS) : null;

    const lines = [
      `🚫 <b>Račun suspendiran</b>`,
      ``,
      `👤 <b>${name}</b>`,
      created   ? `📅 Ustvarjen: ${created}` : '',
      `🔴 Suspendiran: ${suspDate}`,
      totalDays != null ? `⏱ Skupaj dni: ${totalDays}` : '',
      warmupDays != null ? `🔥 Warmup: ${warmupDays} dni` : '',
      liveDays != null ? `✅ Dni LIVE: ${liveDays}` : '',
      acc.Followers != null ? `👥 Sledilci ob suspenziji: ${acc.Followers}` : '',
      acc.Device ? `📱 Naprava: ${acc.Device}` : '',
    ].filter(Boolean).join('\n');

    console.log(`\n🚫 Suspended: ${name} (${liveDays ?? '?'} dni LIVE)`);
    await sendTelegram(lines);
  }

  const activeAccounts = igAccounts.filter(a => a.Status && a.Status.trim() === 'Live');
  if (!activeAccounts.length) {
    console.log('⚠  No active accounts found in Instagram Accounts table.');
    return;
  }

  // Delete today's existing plan rows
  if (existingPlan.length > 0 && !DRY_RUN) {
    console.log(`🗑  Removing ${existingPlan.length} existing plan rows for ${TODAY}...`);
    await deleteRecords('DailyPlan', existingPlan.map(r => r.id));
  }

  const newRows = [];

  for (const acc of activeAccounts) {
    const name = (acc.Username || '').replace(/^@/, '') || acc.id;
    const stories    = STORIES_PER_DAY;
    const reelsNew   = REELS_NEW_PER_DAY;
    const reelsTrial = trialReelsForAccount(acc);

    const elapsed  = acc['Date Created'] ? Math.floor((Date.now() - new Date(acc['Date Created']).getTime()) / 86400000) : '?';
    const daysLive = typeof elapsed === 'number' ? Math.max(0, elapsed - WARMUP_DURATION_DAYS) : '?';
    const week     = typeof daysLive === 'number' ? Math.floor(daysLive / 7) + 1 : '?';
    console.log(`\n👤 ${name} (teden ${week}, ${reelsTrial} trial reeli)`);

    const storyPicks    = pickStories(content, name, stories);
    const newReelPicks  = pickNewReels(content, name, reelsNew);
    const usedIds       = new Set([...newReelPicks.map(c => c.ContentID || c.id)]);
    const trialPicks    = pickTrialReels(content, name, reelsTrial, usedIds);

    const slots = [
      ...storyPicks.map((c, i) => ({ slot: `Story ${i + 1}`, content: c })),
      ...newReelPicks.map((c, i) => ({ slot: `Reel New`, content: c })),
      ...trialPicks.map((c, i) => ({ slot: `Reel Trial ${i + 1}`, content: c })),
    ];

    for (const { slot, content: c } of slots) {
      console.log(`  [${slot}] ${c ? (c.Description || c.ContentID || c.id).slice(0, 60) : '⚠ NO CONTENT'}`);
      if (!c) continue;

      newRows.push({
        Date:        TODAY,
        Account:     name,
        SlotType:    slot,
        ContentID:   c.ContentID || c.id || '',
        Description: c.Description || '',
        FileURL:     c.FileURL || '',
        ThumbnailURL:c.ThumbnailURL || '',
        Status:      'Pending',
        SlotOrder:   makeSlotOrder(slot),
      });
    }

    const missing = (stories + reelsNew + reelsTrial) - slots.filter(s => s.content).length;
    if (missing > 0) console.log(`  ⚠  ${missing} slots could not be filled — add more content!`);
  }

  if (!DRY_RUN && newRows.length > 0) {
    console.log(`\n💾 Writing ${newRows.length} plan rows to Airtable...`);
    await batchInsert('DailyPlan', newRows);
    console.log('✅ Done!');
  } else if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would write ${newRows.length} rows.`);
  } else {
    console.log('\n⚠  Nothing to write.');
  }
}

main().catch(async e => {
  console.error(e);
  // Detect Airtable auth/scraping errors and alert via Telegram before failing
  const msg = e.message || '';
  const isAuthErr     = msg.includes('401') || msg.includes('UNAUTHORIZED') || msg.includes('invalid_api_key');
  const isRateErr     = msg.includes('429') || msg.includes('RATE_LIMIT');
  const isPermErr     = msg.includes('403') || msg.includes('FORBIDDEN') || msg.includes('permission');
  if (isAuthErr || isRateErr || isPermErr) {
    const kind = isAuthErr ? '🔑 API ključ invalid / račun suspendiran'
               : isRateErr ? '⚠️ Rate limit — preveč zahtevkov'
               : '🚫 Dostop zavrnjen (403)';
    await sendTelegram(
      `❌ <b>IG Scraper — kritična napaka</b>\n\n${kind}\n\n<code>${msg.slice(0, 300)}</code>\n\n🛑 Scripta se je ustavila.`
    ).catch(() => {});
  } else {
    await sendTelegram(
      `❌ <b>IG Daily Plan — napaka</b>\n\n<code>${msg.slice(0, 400)}</code>`
    ).catch(() => {});
  }
  process.exit(1);
});
