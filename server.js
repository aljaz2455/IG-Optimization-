const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');

try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch(_) {}

const app  = express();
const PORT = process.env.PORT || 3120;

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const DASHBOARD_USER   = process.env.DASHBOARD_USER || 'aljaz';
const DASHBOARD_PASS   = process.env.DASHBOARD_PASS || '#Test123';
const SESSION_SECRET   = process.env.SESSION_SECRET || 'ig-opt-secret-2026';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// ── Login page ────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.auth) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IG Optimizer — Login</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f1117; color: #e8eaf6; font-family: 'Segoe UI', system-ui, sans-serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #1a1d27; border: 1px solid #2e3350; border-radius: 16px;
          padding: 40px 36px; width: 380px; max-width: 90vw; }
  .logo { width: 48px; height: 48px; border-radius: 12px;
          background: linear-gradient(45deg, #fd1d1d, #e1306c, #833ab4);
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  h1 span { background: linear-gradient(90deg,#e1306c,#c77dff);
            -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .sub { font-size: 13px; color: #7b82a8; margin-bottom: 28px; }
  label { font-size: 11px; font-weight: 600; color: #7b82a8; text-transform: uppercase;
          letter-spacing: .6px; display: block; margin-bottom: 6px; }
  input { width: 100%; background: #0f1117; border: 1px solid #2e3350; border-radius: 8px;
          color: #e8eaf6; padding: 10px 14px; font-size: 14px; margin-bottom: 16px; }
  input:focus { outline: 1px solid #e1306c; }
  button { width: 100%; background: linear-gradient(90deg,#e1306c,#833ab4);
           border: none; color: #fff; padding: 12px; border-radius: 8px;
           font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 4px; }
  button:hover { opacity: .9; }
  .error { background: rgba(255,77,109,.15); border: 1px solid rgba(255,77,109,.3);
           border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #ff4d6d;
           margin-bottom: 16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">📸</div>
    <h1>IG <span>Optimizer</span></h1>
    <div class="sub">Prijavi se za dostop do dashboarda</div>
    ${req.query.err ? '<div class="error">Napačno geslo ali uporabniško ime.</div>' : ''}
    <form method="POST" action="/login">
      <label>Uporabniško ime</label>
      <input type="text" name="username" autocomplete="username" required>
      <label>Geslo</label>
      <input type="password" name="password" autocomplete="current-password" required>
      <button type="submit">Prijava →</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === DASHBOARD_USER && password === DASHBOARD_PASS) {
    req.session.auth = true;
    res.redirect('/');
  } else {
    res.redirect('/login?err=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── Auth middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.auth) return next();
  res.redirect('/login');
}

// ── Dashboard — inject API key into HTML ──────────────────────────────────
app.get('/', requireAuth, (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
  // Inject API key as a global before </head>
  const inject = `<script>window.__IG_API_KEY__ = '${AIRTABLE_API_KEY}';</script>`;
  html = html.replace('</head>', inject + '\n</head>');
  res.send(html);
});

app.listen(PORT, () => console.log(`IG Optimizer running on port ${PORT}`));
