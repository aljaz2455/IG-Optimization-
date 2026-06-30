/**
 * SETUP — creates all Airtable tables for the IG Optimization system.
 * Run once: node setup.js
 * Safe to re-run — skips tables that already exist.
 */
const { listTables, createTable, sleep } = require('./airtable');

const SCHEMAS = [
  {
    name: 'Accounts',
    fields: [
      { name: 'Name',             type: 'singleLineText' },
      { name: 'IGUsername',       type: 'singleLineText' },
      { name: 'Active',           type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'StoriesPerDay',    type: 'number',   options: { precision: 0 } },
      { name: 'ReelsNewPerDay',   type: 'number',   options: { precision: 0 } },
      { name: 'ReelsTrialPerDay', type: 'number',   options: { precision: 0 } },
      { name: 'Notes',            type: 'multilineText' },
    ]
  },
  {
    name: 'ContentLibrary',
    fields: [
      { name: 'ContentID',     type: 'singleLineText' },
      { name: 'Account',       type: 'singleLineText' },
      { name: 'Type',          type: 'singleSelect', options: { choices: [
        { name: 'Story',  color: 'blueLight2'   },
        { name: 'Reel',   color: 'purpleLight2' },
      ]}},
      { name: 'Description',  type: 'multilineText' },
      { name: 'FileURL',       type: 'url' },
      { name: 'ThumbnailURL',  type: 'url' },
      { name: 'Tags',          type: 'multilineText' },
      { name: 'Status',        type: 'singleSelect', options: { choices: [
        { name: 'Available', color: 'greenBright'  },
        { name: 'Used',      color: 'yellowLight2' },
        { name: 'Archived',  color: 'grayLight2'   },
      ]}},
      { name: 'DateAdded',     type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'LastPosted',    type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'PostCount',     type: 'number', options: { precision: 0 } },
      { name: 'AvgViews',      type: 'number', options: { precision: 0 } },
      { name: 'AvgLikes',      type: 'number', options: { precision: 0 } },
      { name: 'AvgScore',      type: 'number', options: { precision: 2 } },
      { name: 'IsTrialReady',  type: 'checkbox', options: { icon: 'check', color: 'purpleBright' } },
    ]
  },
  {
    name: 'DailyPlan',
    fields: [
      { name: 'Date',          type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'Account',       type: 'singleLineText' },
      { name: 'SlotType',      type: 'singleSelect', options: { choices: [
        { name: 'Story 1',     color: 'blueLight2'    },
        { name: 'Story 2',     color: 'blueLight2'    },
        { name: 'Story 3',     color: 'blueLight2'    },
        { name: 'Story 4',     color: 'blueLight2'    },
        { name: 'Story 5',     color: 'blueLight2'    },
        { name: 'Reel New',    color: 'purpleBright'  },
        { name: 'Reel Trial 1',color: 'pinkLight2'    },
        { name: 'Reel Trial 2',color: 'pinkLight2'    },
      ]}},
      { name: 'ContentID',     type: 'singleLineText' },
      { name: 'Description',   type: 'multilineText'  },
      { name: 'FileURL',       type: 'url'            },
      { name: 'ThumbnailURL',  type: 'url'            },
      { name: 'Status',        type: 'singleSelect', options: { choices: [
        { name: 'Pending',  color: 'yellowBright' },
        { name: 'Posted',   color: 'greenBright'  },
        { name: 'Skipped',  color: 'grayLight2'   },
      ]}},
      { name: 'Notes',         type: 'multilineText' },
      { name: 'SlotOrder',     type: 'number', options: { precision: 0 } },
    ]
  },
  {
    name: 'Performance',
    fields: [
      { name: 'Date',       type: 'date', options: { dateFormat: { name: 'iso' } } },
      { name: 'Account',    type: 'singleLineText' },
      { name: 'ContentID',  type: 'singleLineText' },
      { name: 'SlotType',   type: 'singleLineText' },
      { name: 'Type',       type: 'singleLineText' },
      { name: 'Views',      type: 'number', options: { precision: 0 } },
      { name: 'Likes',      type: 'number', options: { precision: 0 } },
      { name: 'Comments',   type: 'number', options: { precision: 0 } },
      { name: 'Shares',     type: 'number', options: { precision: 0 } },
      { name: 'Saves',      type: 'number', options: { precision: 0 } },
      { name: 'Reach',      type: 'number', options: { precision: 0 } },
      { name: 'Score',      type: 'number', options: { precision: 2 } },
      { name: 'Notes',      type: 'multilineText' },
    ]
  },
  {
    name: 'Settings',
    fields: [
      { name: 'Setting',     type: 'singleLineText' },
      { name: 'Value',       type: 'singleLineText' },
      { name: 'Description', type: 'multilineText'  },
    ]
  }
];

const DEFAULT_SETTINGS = [
  { Setting: 'StoriesPerDay',       Value: '5',    Description: 'Number of stories to plan per account per day' },
  { Setting: 'ReelsNewPerDay',      Value: '1',    Description: 'Number of new reels per account per day' },
  { Setting: 'ReelsTrialPerDay',    Value: '2',    Description: 'Number of trial (repost) reels per account per day' },
  { Setting: 'StoryCooldownDays',   Value: '7',    Description: 'Min days before re-posting same story' },
  { Setting: 'ReelNewCooldownDays', Value: '30',   Description: 'Min days before re-posting same reel as New' },
  { Setting: 'TrialMinPosts',       Value: '1',    Description: 'Min times a reel must have been posted to be trial-eligible' },
  { Setting: 'ScoreWeightViews',    Value: '0.4',  Description: 'Weight of Views in performance score' },
  { Setting: 'ScoreWeightLikes',    Value: '0.3',  Description: 'Weight of Likes in performance score' },
  { Setting: 'ScoreWeightSaves',    Value: '0.3',  Description: 'Weight of Saves in performance score' },
  { Setting: 'WarmupDurationDays',  Value: '14',   Description: 'Koliko dni traja warmup preden gre račun v Live' },
  { Setting: 'TrialReelsPerWeek',   Value: '0,0,1,2', Description: 'Število trial reelev po tednih postanja (ločeno z vejico). Primer: 0,0,1,2 = teden1→0, teden2→0, teden3→1, teden4+→2' },
];

async function main() {
  console.log('🔍 Checking existing tables...');
  const existing = await listTables();
  const existingNames = new Set(existing.map(t => t.name));
  console.log('Existing:', [...existingNames].join(', ') || '(none)');

  // The default "Table 1" is replaced by renaming it to Accounts if Accounts doesn't exist
  const table1 = existing.find(t => t.name === 'Table 1');

  for (const schema of SCHEMAS) {
    if (existingNames.has(schema.name)) {
      console.log(`✓ ${schema.name} — already exists, skipping`);
      continue;
    }

    // Use Table 1 for first table (Airtable requires at least 1 table)
    if (schema.name === 'Accounts' && table1) {
      console.log(`⚙️  Renaming "Table 1" → Accounts...`);
      try {
        const { apiRequest, META_URL } = require('./airtable');
        await apiRequest('PATCH', `${META_URL}/tables/${table1.id}`, { name: 'Accounts', description: 'IG model accounts' });
        console.log(`✓ Accounts — renamed`);

        // Add missing fields (Table 1 has Name, Notes, Assignee, Status, Attachments)
        const existingFields = new Set(table1.fields.map(f => f.name));
        for (const field of schema.fields) {
          if (existingFields.has(field.name)) continue;
          try {
            const { addField } = require('./airtable');
            await addField(table1.id, field);
            await sleep(300);
          } catch(e) {
            console.warn(`  ⚠ field ${field.name}: ${e.message.slice(0,80)}`);
          }
        }
      } catch(e) {
        console.warn(`  ⚠ rename failed: ${e.message.slice(0,120)}`);
      }
      continue;
    }

    console.log(`➕ Creating ${schema.name}...`);
    try {
      await createTable(schema);
      console.log(`✓ ${schema.name} — created`);
      await sleep(500);
    } catch(e) {
      console.error(`✗ ${schema.name}: ${e.message.slice(0, 200)}`);
    }
  }

  // Seed default settings
  console.log('\n📋 Seeding default Settings...');
  const { readAll, batchInsert } = require('./airtable');
  try {
    const existing_settings = await readAll('Settings');
    const existingKeys = new Set(existing_settings.map(r => r.Setting));
    const toInsert = DEFAULT_SETTINGS.filter(s => !existingKeys.has(s.Setting));
    if (toInsert.length > 0) {
      await batchInsert('Settings', toInsert);
      console.log(`✓ Inserted ${toInsert.length} default settings`);
    } else {
      console.log('✓ Settings already seeded');
    }
  } catch(e) {
    console.warn('⚠ Could not seed settings:', e.message.slice(0,120));
  }

  console.log('\n✅ Setup complete!');
  console.log('Next steps:');
  console.log('  1. Add your IG accounts to the Accounts table');
  console.log('  2. Add content to ContentLibrary (Type = Story or Reel)');
  console.log('  3. Run: node daily_plan.js');
}

main().catch(e => { console.error(e); process.exit(1); });
