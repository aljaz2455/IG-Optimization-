# IG Optimization System

Avtomatski dnevni plan postanja za Instagram račune. Pove VA točno kaj objaviti vsak dan na vsakem računu.

## Kaj sistem dela

- **5 storij/dan** — naključno iz content libraryja, cooldown 7 dni
- **1 nov reel/dan** — najnižji PostCount (še nepostan)
- **N trial reelev/dan** — repost najboljšega contentta, število se povečuje po tednih (nastavljivo)
- Plan se generira samo za **Live** račune (Warmup računi se preskočijo)

## Airtable baze

| Baza | Namen |
|---|---|
| `appYCG4Sfa4AI0s6W` | Glavna baza: ContentLibrary, DailyPlan, Performance, Settings |
| `appkOOpwWXWRxYjbH` | Računi: Instagram Accounts, Daily Stats, Posting log |

## Setup

```bash
npm install
node setup.js        # ustvari Airtable tabele + default settings
```

## Dnevni workflow

```bash
node daily_plan.js   # generiraj plan za danes
node feedback.js     # po postanju: posodobi stats
```

## Dashboard

Odpri `dashboard.html` lokalno ali na Render URL-ju.

**Tabi:**
- 📅 **Danes** — dnevni plan po računu (Storiji, Novi reeli, Trial reeli)
- 🔥 **Warmup** — računi v ogrevanju, progress bar, kdaj gredo v Live, trial schedule po tednih
- 🎬 **Content** — content library po računu, dni pokritja
- 📊 **Rezultati** — follower rast, performance charts
- ⚙️ **Settings** — konfiguracija sistema

## Ključne nastavitve (Airtable → Settings)

| Setting | Default | Opis |
|---|---|---|
| `StoriesPerDay` | 5 | Storiji na račun/dan |
| `ReelsNewPerDay` | 1 | Novi reeli na račun/dan |
| `TrialReelsPerWeek` | `0,0,1,2` | Trial reeli po tednih postanja (vejica) |
| `WarmupDurationDays` | 14 | Dni warmupa preden gre račun v Live |
| `StoryCooldownDays` | 7 | Min dni med ponovnim postanjem iste storije |
| `ReelNewCooldownDays` | 30 | Min dni med ponovnim postanjem istega reela kot "new" |

## Dodajanje contentta

V Airtable → `ContentLibrary`:
- `Account` = username (npr. `katja_petric1`, brez @)
- `Type` = `Story` ali `Reel`
- `FileURL` = link do fajla
- `Status` = `Available`
