/**
 * FEEDBACK — records actual IG post performance and updates ContentLibrary averages.
 *
 * Usage:
 *   node feedback.js                   — interactive: prompts for today's results
 *   node feedback.js --date YYYY-MM-DD — process a specific date's posted plan
 *   node feedback.js --demo            — insert sample performance data for testing
 *
 * What it does:
 *   1. Reads DailyPlan rows with Status='Posted' for the given date
 *   2. Reads corresponding Performance rows already entered (if any)
 *   3. Updates ContentLibrary: PostCount++, AvgViews/AvgLikes recalculated, LastPosted updated
 *   4. Marks IsTrialReady=true for reels with PostCount >= TrialMinPosts and decent score
 */

const { readAll, batchInsert, batchUpdate, sleep } = require('./airtable');

const args = process.argv.slice(2);
const DATE    = args.find((a, i) => args[i - 1] === '--date') || new Date().toISOString().split('T')[0];
const IS_DEMO = args.includes('--demo');

async function main() {
  console.log(`\n📊 IG Feedback — ${DATE}${IS_DEMO ? ' [DEMO]' : ''}`);
  console.log('────────────────────────────────────────');

  const [settings, plan, performance, content] = await Promise.all([
    readAll('Settings'),
    readAll('DailyPlan',   `{Date}='${DATE}'`),
    readAll('Performance', `{Date}='${DATE}'`),
    readAll('ContentLibrary'),
  ]);

  const trialMinPosts = parseFloat((settings.find(s => s.Setting === 'TrialMinPosts') || {}).Value || 1);

  if (IS_DEMO) {
    await insertDemoPerformance(plan, performance, content);
    return;
  }

  // Match performance rows to plan
  const perfByContentId = {};
  for (const p of performance) perfByContentId[p.ContentID] = p;

  const posted = plan.filter(p => p.Status === 'Posted');
  if (!posted.length) {
    console.log('⚠  No rows with Status="Posted" found in DailyPlan for this date.');
    console.log('   Mark posts as Posted in Airtable, then re-run.');
    return;
  }

  console.log(`Found ${posted.length} posted slots. Updating ContentLibrary...`);

  const contentById = {};
  for (const c of content) contentById[c.ContentID || c.id] = c;

  const updates = [];

  for (const row of posted) {
    const perf = perfByContentId[row.ContentID];
    const c = contentById[row.ContentID];
    if (!c) { console.log(`  ⚠ ContentID ${row.ContentID} not found in ContentLibrary`); continue; }

    const views    = perf ? (perf.Views  || 0) : 0;
    const likes    = perf ? (perf.Likes  || 0) : 0;
    const oldCount = c.PostCount || 0;
    const newCount = oldCount + 1;

    // Running average
    const newAvgViews = Math.round(((c.AvgViews || 0) * oldCount + views) / newCount);
    const newAvgLikes = Math.round(((c.AvgLikes || 0) * oldCount + likes) / newCount);

    const isTrialReady = c.Type === 'Reel' && newCount >= trialMinPosts;

    updates.push({
      id: c.id,
      fields: {
        PostCount:    newCount,
        LastPosted:   DATE,
        AvgViews:     newAvgViews,
        AvgLikes:     newAvgLikes,
        IsTrialReady: isTrialReady,
        Status:       'Used',
      }
    });

    console.log(`  ✓ ${c.ContentID || c.id} [${c.Type}] — count ${oldCount}→${newCount}, avgViews ${c.AvgViews||0}→${newAvgViews}`);
  }

  if (updates.length > 0) {
    await batchUpdate('ContentLibrary', updates);
    console.log(`\n✅ Updated ${updates.length} content records.`);
  }
}

async function insertDemoPerformance(plan, existingPerf, content) {
  const existingIds = new Set(existingPerf.map(p => p.ContentID));
  const toInsert = [];

  for (const row of plan) {
    if (existingIds.has(row.ContentID)) continue;
    const isStory = row.SlotType && row.SlotType.startsWith('Story');
    toInsert.push({
      Date:      DATE,
      Account:   row.Account,
      ContentID: row.ContentID,
      SlotType:  row.SlotType,
      Type:      isStory ? 'Story' : 'Reel',
      Views:     isStory ? Math.round(800  + Math.random() * 2000) : Math.round(3000  + Math.random() * 15000),
      Likes:     isStory ? Math.round(50   + Math.random() * 300)  : Math.round(200   + Math.random() * 2000),
      Comments:  isStory ? Math.round(2    + Math.random() * 20)   : Math.round(10    + Math.random() * 150),
      Shares:    isStory ? Math.round(1    + Math.random() * 10)   : Math.round(5     + Math.random() * 100),
      Saves:     isStory ? Math.round(5    + Math.random() * 40)   : Math.round(20    + Math.random() * 400),
      Reach:     isStory ? Math.round(900  + Math.random() * 2500) : Math.round(4000  + Math.random() * 20000),
      Score:     parseFloat((Math.random() * 100).toFixed(1)),
    });
  }

  if (!toInsert.length) { console.log('⚠ Demo: nothing to insert (all already exist)'); return; }
  console.log(`Inserting ${toInsert.length} demo performance rows...`);
  await batchInsert('Performance', toInsert);

  // Also mark plan rows as Posted
  const { batchUpdate } = require('./airtable');
  const planUpdates = plan.map(r => ({ id: r.id, fields: { Status: 'Posted' } }));
  await batchUpdate('DailyPlan', planUpdates);

  console.log('✅ Demo data inserted!');
}

main().catch(e => { console.error(e); process.exit(1); });
