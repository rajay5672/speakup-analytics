/**
 * SpeakUp Analytics Dashboard Generator
 * Produces a single self-contained index.html that closely mirrors the
 * Vercel Analytics UI: metric cards, area chart, top pages, referrers,
 * countries, devices, OS, events, and signup funnel.
 *
 * Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fetch 90 days so client-side filtering handles 7d / 30d / 90d
const FETCH_DAYS = 90;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function fetchAll(table, select, since) {
  const all = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db
      .from(table)
      .select(select)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main() {
  console.log('Fetching data from Supabase…');
  const since = daysAgo(FETCH_DAYS);

  const [pageViews, events] = await Promise.all([
    fetchAll(
      'page_views',
      'path,referrer,user_agent,country,visitor_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,created_at',
      since
    ),
    fetchAll('analytics_events', 'event_name,event_category,created_at,session_id,user_id', since),
  ]);

  console.log('  page_views:', pageViews.length, 'rows');
  console.log('  analytics_events:', events.length, 'rows');

  const html = buildHTML(pageViews, events);
  const outPath = path.join(__dirname, 'index.html');
  fs.writeFileSync(outPath, html);
  console.log('Dashboard written to:', outPath);
}

// ─── buildHTML ──────────────────────────────────────────────────────────────

function buildHTML(pageViews, events) {
  const generated = new Date().toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Compact row format embedded as JSON
  const pvData = pageViews.map(r => ({
    d: r.created_at.slice(0, 10),
    p: r.path,
    r: r.referrer || '',
    ua: r.user_agent || '',
    c: r.country || '',
    v: r.visitor_id || '',
    us: r.utm_source || '',
    um: r.utm_medium || '',
    uc: r.utm_campaign || '',
    ut: r.utm_content || '',
    uk: r.utm_term || '',
  }));

  const evData = events.map(r => ({
    d: r.created_at.slice(0, 10),
    n: r.event_name,
    cat: r.event_category || '',
    u: r.user_id || r.session_id || '',
  }));

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SpeakUp Analytics</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
/* ─── CSS Variables ─────────────────────────────────────────────────────── */
:root {
  --bg-100:#0a0a0a; --bg-200:#111; --bg-300:#1a1a1a;
  --border:rgba(255,255,255,.1); --border-2:rgba(255,255,255,.06);
  --text-1:#fff; --text-2:#888; --text-3:#555;
  --blue:#0070f3; --blue-dim:rgba(0,112,243,.15);
  --green:#0cce6b; --green-dim:rgba(12,206,107,.15);
  --red:#f85149;   --red-dim:rgba(248,81,73,.12);
  --accent-active:#0070f3;
  --card-radius:8px;
  --tab-active-border:#0070f3;
  --scrollbar:rgba(255,255,255,.08);
}
[data-theme="light"] {
  --bg-100:#fff; --bg-200:#fafafa; --bg-300:#f2f2f2;
  --border:rgba(0,0,0,.08); --border-2:rgba(0,0,0,.05);
  --text-1:#000; --text-2:#666; --text-3:#999;
  --blue:#0070f3; --blue-dim:rgba(0,112,243,.08);
  --green:#0cce6b; --green-dim:rgba(12,206,107,.08);
  --red:#f85149;   --red-dim:rgba(248,81,73,.08);
  --scrollbar:rgba(0,0,0,.08);
}

/* ─── Reset ─────────────────────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg-100);color:var(--text-1);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
button{font-family:inherit;cursor:pointer;border:none;background:none}
a{color:inherit;text-decoration:none}

/* ─── Layout ─────────────────────────────────────────────────────────────── */
.page{max-width:1200px;margin:0 auto;padding:0 24px 60px}

/* ─── Top nav bar ─────────────────────────────────────────────────────────── */
.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 0 0;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:16px;gap:12px;flex-wrap:wrap}
.topbar-left{display:flex;align-items:center;gap:10px}
.domain-dot{width:8px;height:8px;border-radius:50%;background:#0cce6b;flex-shrink:0}
.domain-name{font-size:15px;font-weight:600;letter-spacing:-.3px}
.domain-link{display:inline-flex;align-items:center;gap:4px;color:var(--text-2);font-size:12px;margin-left:4px;transition:color .15s}
.domain-link:hover{color:var(--text-1)}
.domain-link svg{width:11px;height:11px}
.topbar-right{display:flex;align-items:center;gap:8px}

/* ─── Combobox / Selects ─────────────────────────────────────────────────── */
.combo{display:inline-flex;align-items:center;gap:6px;background:var(--bg-200);border:1px solid var(--border);border-radius:6px;padding:5px 10px 5px 12px;font-size:12px;font-weight:500;color:var(--text-1);cursor:pointer;user-select:none;position:relative;transition:border-color .15s}
.combo:hover{border-color:rgba(255,255,255,.2)}
[data-theme="light"] .combo:hover{border-color:rgba(0,0,0,.18)}
.combo svg{color:var(--text-2);width:12px;height:12px;flex-shrink:0}
.combo select{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
.theme-btn{display:inline-flex;align-items:center;gap:6px;background:var(--bg-200);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;font-weight:500;color:var(--text-2);transition:all .15s}
.theme-btn:hover{border-color:rgba(255,255,255,.25);color:var(--text-1)}
[data-theme="light"] .theme-btn:hover{border-color:rgba(0,0,0,.2)}

/* ─── Metric Cards ────────────────────────────────────────────────────────── */
.metrics-row{display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:-1px}
.metric-card{background:var(--bg-100);border:1px solid var(--border);padding:20px 24px 0;cursor:pointer;transition:background .15s;position:relative;overflow:hidden}
.metric-card:first-child{border-radius:var(--card-radius) 0 0 0}
.metric-card:last-child{border-radius:0 var(--card-radius) 0 0}
.metric-card:not(:last-child){border-right:none}
.metric-card:hover{background:var(--bg-200)}
.metric-card.active{background:var(--bg-200)}
.metric-card.active::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--blue)}
.metric-label{font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}
.metric-value-row{display:flex;align-items:baseline;gap:10px;padding-bottom:20px}
.metric-value{font-size:32px;font-weight:700;letter-spacing:-1.5px;font-variant-numeric:tabular-nums;line-height:1}
.metric-badge{display:inline-flex;align-items:center;gap:2px;font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;letter-spacing:-.2px}
.badge-green{background:var(--green-dim);color:var(--green)}
.badge-red{background:var(--red-dim);color:var(--red)}
.badge-neutral{background:var(--bg-300);color:var(--text-2)}

/* ─── Main Chart ──────────────────────────────────────────────────────────── */
.chart-wrap{border:1px solid var(--border);border-top:none;border-radius:0 0 var(--card-radius) var(--card-radius);background:var(--bg-200);padding:20px 24px 16px;margin-bottom:24px}
.chart-area{position:relative;height:200px}

/* ─── Two-column panel row ─────────────────────────────────────────────────── */
.panel-row{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:0;border:1px solid var(--border);border-radius:var(--card-radius);overflow:hidden;margin-bottom:12px}
.panel{background:var(--bg-200);overflow:hidden}
.panel:first-child{border-right:1px solid var(--border)}
.panel-header{padding:16px 20px 0}
.panel-title{font-size:12px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px}

/* Bottom 3-col row */
.panel-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1px solid var(--border);border-radius:var(--card-radius);overflow:hidden;margin-bottom:12px}
.panel-row-3 .panel:not(:last-child){border-right:1px solid var(--border)}

/* Single wide panel */
.panel-single{background:var(--bg-200);border:1px solid var(--border);border-radius:var(--card-radius);overflow:hidden;margin-bottom:12px}

/* ─── Tabs ────────────────────────────────────────────────────────────────── */
.tabs{display:flex;border-bottom:1px solid var(--border);padding:0 20px}
.tab{font-size:12px;font-weight:500;padding:10px 12px;cursor:pointer;color:var(--text-2);border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s;white-space:nowrap}
.tab:hover{color:var(--text-1)}
.tab.active{color:var(--text-1);border-bottom-color:var(--tab-active-border)}
.sub-tabs{display:flex;padding:8px 20px 0;gap:0;border-bottom:1px solid var(--border)}
.sub-tab{font-size:11px;font-weight:500;padding:6px 10px;cursor:pointer;color:var(--text-2);border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s}
.sub-tab:hover{color:var(--text-1)}
.sub-tab.active{color:var(--text-1);border-bottom-color:var(--tab-active-border)}

/* ─── Bar List ────────────────────────────────────────────────────────────── */
.bar-list{padding:0}
.bar-item{display:flex;align-items:center;padding:9px 20px;gap:10px;transition:background .1s;min-height:38px}
.bar-item:hover{background:var(--bg-300)}
.bar-item-label{display:flex;align-items:center;gap:7px;font-size:13px;min-width:0;flex:1;overflow:hidden}
.bar-item-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-item-favicon{width:14px;height:14px;border-radius:2px;flex-shrink:0;object-fit:contain}
.bar-item-flag{font-size:14px;line-height:1;flex-shrink:0}
.bar-bg{flex:2;height:6px;background:var(--bg-300);border-radius:3px;overflow:hidden;min-width:40px}
.bar-fill{height:100%;border-radius:3px;background:var(--blue);opacity:.7;transition:width .3s}
.bar-item-count{font-size:12px;font-weight:500;color:var(--text-2);min-width:36px;text-align:right;font-variant-numeric:tabular-nums}
.bar-empty{padding:32px 20px;color:var(--text-3);font-size:13px;text-align:center}

/* Panel footer toolbar */
.panel-footer{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-top:1px solid var(--border);background:var(--bg-100)}
.panel-footer-btn{font-size:11px;color:var(--text-2);cursor:pointer;transition:color .15s;padding:2px 0}
.panel-footer-btn:hover{color:var(--text-1)}

/* ─── Events Table ────────────────────────────────────────────────────────── */
.ev-table{width:100%;border-collapse:collapse}
.ev-table thead tr{border-bottom:1px solid var(--border)}
.ev-table th{padding:10px 20px;font-size:11px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.5px;text-align:left}
.ev-table th:not(:first-child){text-align:right}
.ev-table td{padding:10px 20px;font-size:13px;border-bottom:1px solid var(--border-2)}
.ev-table td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums;color:var(--text-2)}
.ev-table tr:last-child td{border-bottom:none}
.ev-table tr:hover td{background:var(--bg-300)}
.ev-name{font-weight:500;color:var(--text-1)}
.ev-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:8px;background:var(--blue);vertical-align:middle}

/* ─── Funnel ──────────────────────────────────────────────────────────────── */
.funnel-wrap{padding:20px}
.funnel-step{margin-bottom:16px}
.funnel-step-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px}
.funnel-step-name{font-weight:500;color:var(--text-1)}
.funnel-step-meta{color:var(--text-2);display:flex;gap:12px}
.funnel-bar-track{height:8px;background:var(--bg-300);border-radius:4px;overflow:hidden}
.funnel-bar-fill{height:100%;border-radius:4px;background:var(--blue);transition:width .4s}
.funnel-conv{font-size:11px;color:var(--text-3);margin-top:3px}

/* ─── Misc ────────────────────────────────────────────────────────────────── */
.section-gap{height:12px}
.no-data{padding:40px 20px;text-align:center;color:var(--text-3);font-size:13px}
.generated-note{font-size:11px;color:var(--text-3);text-align:center;padding:24px 0 0}

/* ─── Responsive ─────────────────────────────────────────────────────────── */
@media(max-width:860px){
  .metrics-row{grid-template-columns:1fr}
  .metric-card:first-child{border-radius:var(--card-radius) var(--card-radius) 0 0}
  .metric-card:last-child{border-radius:0}
  .metric-card:not(:last-child){border-right:1px solid var(--border);border-bottom:none}
  .panel-row,.panel-row-3{grid-template-columns:1fr}
  .panel:first-child{border-right:none;border-bottom:1px solid var(--border)}
  .panel-row-3 .panel:not(:last-child){border-right:none;border-bottom:1px solid var(--border)}
  .page{padding:0 14px 40px}
  .topbar{padding-bottom:12px}
}
</style>
</head>
<body>
<div class="page">

  <!-- Top nav -->
  <div class="topbar">
    <div class="topbar-left">
      <div class="domain-dot"></div>
      <span class="domain-name">speakupcoach.com</span>
      <a class="domain-link" href="https://speakupcoach.com" target="_blank" rel="noopener">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M7.5 1H11m0 0v3.5M11 1L5.5 6.5"/></svg>
        Visit
      </a>
    </div>
    <div class="topbar-right">
      <!-- Environment (display only) -->
      <div class="combo">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="4.5"/><path d="M6 1.5S4 4 4 6s2 4.5 2 4.5M6 1.5S8 4 8 6s-2 4.5-2 4.5M1.5 6h9"/></svg>
        Production
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4.5l3.5 3 3.5-3"/></svg>
      </div>
      <!-- Period selector -->
      <div class="combo" id="period-combo">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="9" height="8" rx="1"/><path d="M1.5 5h9M4 1v3M8 1v3"/></svg>
        <span id="period-label">Last 30 Days</span>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 4.5l3.5 3 3.5-3"/></svg>
        <select id="period-select">
          <option value="7">Last 7 Days</option>
          <option value="30" selected>Last 30 Days</option>
          <option value="90">Last 90 Days</option>
        </select>
      </div>
      <!-- Theme toggle -->
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()">
        <svg id="theme-icon-dark" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12.5 8.2A5.5 5.5 0 015.8 1.5a5.5 5.5 0 106.7 6.7z"/></svg>
        <svg id="theme-icon-light" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" style="display:none"><circle cx="7" cy="7" r="3"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M3 3l1 1M10 10l1 1M3 11l1-1M10 4l1-1"/></svg>
      </button>
    </div>
  </div>

  <!-- Metric cards -->
  <div class="metrics-row" id="metrics-row">
    <div class="metric-card active" data-metric="visitors" onclick="selectMetric('visitors')">
      <div class="metric-label">Visitors</div>
      <div class="metric-value-row">
        <div class="metric-value" id="mv-visitors">—</div>
        <span class="metric-badge badge-neutral" id="mb-visitors"></span>
      </div>
    </div>
    <div class="metric-card" data-metric="pageviews" onclick="selectMetric('pageviews')">
      <div class="metric-label">Page Views</div>
      <div class="metric-value-row">
        <div class="metric-value" id="mv-pageviews">—</div>
        <span class="metric-badge badge-neutral" id="mb-pageviews"></span>
      </div>
    </div>
    <div class="metric-card" data-metric="bounce" onclick="selectMetric('bounce')">
      <div class="metric-label">Bounce Rate</div>
      <div class="metric-value-row">
        <div class="metric-value" id="mv-bounce">—</div>
        <span class="metric-badge badge-neutral" id="mb-bounce"></span>
      </div>
    </div>
  </div>

  <!-- Main chart -->
  <div class="chart-wrap">
    <div class="chart-area">
      <canvas id="main-chart"></canvas>
    </div>
  </div>

  <!-- Top Pages + Referrers -->
  <div class="panel-row">
    <!-- Pages -->
    <div class="panel">
      <div class="tabs" id="pages-tabs">
        <div class="tab active" data-tab="pages-tab" onclick="switchTab('pages','pages')">Pages</div>
        <div class="tab" data-tab="routes-tab" onclick="switchTab('pages','routes')">Routes</div>
      </div>
      <div id="pages-content"></div>
      <div class="panel-footer">
        <span class="panel-footer-btn" onclick="">View All</span>
        <span class="panel-footer-btn" style="color:var(--text-3)">Split by</span>
      </div>
    </div>
    <!-- Referrers -->
    <div class="panel">
      <div class="tabs" id="ref-tabs">
        <div class="tab active" data-tab="ref-tab" onclick="switchTab('ref','referrers')">Referrers</div>
        <div class="tab" data-tab="utm-tab" onclick="switchTab('ref','utm')">UTM Parameters</div>
      </div>
      <div id="ref-sub-tabs" style="display:none">
        <div class="sub-tabs">
          <div class="sub-tab active" onclick="switchUTM('source')">Source</div>
          <div class="sub-tab" onclick="switchUTM('medium')">Medium</div>
          <div class="sub-tab" onclick="switchUTM('campaign')">Campaign</div>
          <div class="sub-tab" onclick="switchUTM('content')">Content</div>
          <div class="sub-tab" onclick="switchUTM('term')">Term</div>
        </div>
      </div>
      <div id="ref-content"></div>
      <div class="panel-footer">
        <span class="panel-footer-btn">View All</span>
        <span class="panel-footer-btn" style="color:var(--text-3)">Split by</span>
      </div>
    </div>
  </div>

  <!-- Countries + Devices + OS -->
  <div class="panel-row-3">
    <div class="panel">
      <div class="tabs">
        <div class="tab active">Countries</div>
      </div>
      <div id="countries-content"></div>
    </div>
    <div class="panel">
      <div class="tabs" id="dev-tabs">
        <div class="tab active" onclick="switchTab('dev','devices')">Devices</div>
        <div class="tab" onclick="switchTab('dev','browsers')">Browsers</div>
      </div>
      <div id="dev-content"></div>
    </div>
    <div class="panel">
      <div class="tabs">
        <div class="tab active">OS</div>
      </div>
      <div id="os-content"></div>
    </div>
  </div>

  <!-- Events + Funnel -->
  <div class="panel-row">
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Events</div></div>
      <div id="events-content"></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Signup Funnel</div></div>
      <div id="funnel-content"></div>
    </div>
  </div>

  <div class="generated-note">Updated ${generated} MT &middot; speakupcoach.com analytics</div>
</div>

<script>
// ═══════════════════════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════════════════════
const PV = ${JSON.stringify(pvData)};
const EV = ${JSON.stringify(evData)};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
let currentDays   = 30;
let currentMetric = 'visitors'; // 'visitors' | 'pageviews' | 'bounce'
let pagesTab      = 'pages';
let refTab        = 'referrers';
let utmDim        = 'source';
let devTab        = 'devices';
let mainChart     = null;

// ═══════════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════════
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('su-theme', next);
  applyThemeIcons(next);
  render();
}
function applyThemeIcons(t) {
  document.getElementById('theme-icon-dark').style.display  = t === 'dark'  ? '' : 'none';
  document.getElementById('theme-icon-light').style.display = t === 'light' ? '' : 'none';
}
(function() {
  const saved = localStorage.getItem('su-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    applyThemeIcons(saved);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════
// PERIOD SELECT
// ═══════════════════════════════════════════════════════════════════════════
document.getElementById('period-select').addEventListener('change', function() {
  currentDays = parseInt(this.value);
  const labels = {'7':'Last 7 Days','30':'Last 30 Days','90':'Last 90 Days'};
  document.getElementById('period-label').textContent = labels[this.value];
  render();
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function daysSince(dateStr) {
  // Compare date strings without timezone issues
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const a = new Date(todayStr + 'T00:00:00Z');
  const b = new Date(dateStr  + 'T00:00:00Z');
  return Math.round((a - b) / 86400000);
}

function dateRange(days) {
  const arr = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    arr.push(d.toISOString().slice(0, 10));
  }
  return arr;
}

function fmtDateShort(d) {
  // "Apr 5"
  const [, m, day] = d.split('-');
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(m)] + '\\u00a0' + parseInt(day);
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/,'') + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1).replace(/\\.0$/,'') + 'K';
  return n.toLocaleString();
}

function pct(a, b) {
  // percent change from b to a
  if (b === 0) return a > 0 ? 100 : 0;
  return Math.round(((a - b) / b) * 100);
}

function topN(obj, n) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ─── Device / Browser / OS ───────────────────────────────────────────────
function getDevice(ua) {
  if (!ua) return 'Unknown';
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|iemobile/i.test(ua)) return 'Mobile';
  if (/tablet|ipad|android(?!.*mobile)|silk/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

function getBrowser(ua) {
  if (!ua) return 'Other';
  if (/edg\\/|edgA\\/|edgios/i.test(ua)) return 'Edge';
  if (/opr\\/|opera/i.test(ua)) return 'Opera';
  if (/samsung/i.test(ua)) return 'Samsung';
  if (/chrome|crios|crmo/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/msie|trident/i.test(ua)) return 'IE';
  return 'Other';
}

function getOS(ua) {
  if (!ua) return 'Unknown';
  if (/iphone|ipod|ipad/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/macintosh|mac os x/i.test(ua) && !/iphone|ipad/i.test(ua)) return 'macOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

// ─── Referrer parsing ─────────────────────────────────────────────────────
function classifyReferrer(ref) {
  if (!ref) return { name: 'Direct / None', host: '' };
  try {
    const url = new URL(ref);
    const h = url.hostname.replace(/^www\\./, '').toLowerCase();
    if (h.includes('speakupcoach.com')) return { name: 'Direct / None', host: '' };
    const known = {
      'google.com':'Google','google.co':'Google',
      'bing.com':'Bing','yahoo.com':'Yahoo',
      'duckduckgo.com':'DuckDuckGo','baidu.com':'Baidu',
      'instagram.com':'Instagram','ig.me':'Instagram',
      'facebook.com':'Facebook','fb.me':'Facebook','m.facebook.com':'Facebook',
      't.co':'X / Twitter','twitter.com':'X / Twitter','x.com':'X / Twitter',
      'linkedin.com':'LinkedIn','lnkd.in':'LinkedIn',
      'tiktok.com':'TikTok',
      'youtube.com':'YouTube','youtu.be':'YouTube',
      'reddit.com':'Reddit','redd.it':'Reddit',
      'github.com':'GitHub',
      'pinterest.com':'Pinterest',
      'snapchat.com':'Snapchat',
    };
    for (const [k, v] of Object.entries(known)) {
      if (h === k || h.endsWith('.' + k)) return { name: v, host: k };
    }
    return { name: h, host: h };
  } catch {
    return { name: 'Other', host: '' };
  }
}

// ─── Country code → name + flag ───────────────────────────────────────────
const COUNTRY_NAMES = {
  US:'United States',CA:'Canada',GB:'United Kingdom',AU:'Australia',
  DE:'Germany',FR:'France',IN:'India',JP:'Japan',BR:'Brazil',MX:'Mexico',
  NL:'Netherlands',SE:'Sweden',NO:'Norway',DK:'Denmark',FI:'Finland',
  CH:'Switzerland',AT:'Austria',ES:'Spain',IT:'Italy',PT:'Portugal',
  PL:'Poland',RU:'Russia',CN:'China',KR:'South Korea',SG:'Singapore',
  NZ:'New Zealand',ZA:'South Africa',AR:'Argentina',CL:'Chile',CO:'Colombia',
  PH:'Philippines',ID:'Indonesia',MY:'Malaysia',TH:'Thailand',VN:'Vietnam',
  EG:'Egypt',NG:'Nigeria',KE:'Kenya',IL:'Israel',SA:'Saudi Arabia',
  AE:'UAE',TR:'Turkey',UA:'Ukraine',IE:'Ireland',BE:'Belgium',
  HK:'Hong Kong',TW:'Taiwan',CZ:'Czech Republic',HU:'Hungary',RO:'Romania',
};
function countryName(code) { return COUNTRY_NAMES[code] || code; }
function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  // Regional indicator letters: 'A' = 0x1F1E6
  const offset = 0x1F1E6 - 65;
  return String.fromCodePoint(code.charCodeAt(0) + offset, code.charCodeAt(1) + offset);
}

// Favicon URL helper
function faviconUrl(host) {
  if (!host) return '';
  return 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://' + host + '&size=32';
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB SWITCHERS
// ═══════════════════════════════════════════════════════════════════════════
function switchTab(group, value) {
  if (group === 'pages') {
    pagesTab = value;
    document.querySelectorAll('#pages-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('onclick').includes("'" + value + "'"));
    });
    renderPages();
  } else if (group === 'ref') {
    refTab = value;
    document.querySelectorAll('#ref-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('onclick').includes("'" + value + "'"));
    });
    document.getElementById('ref-sub-tabs').style.display = value === 'utm' ? '' : 'none';
    renderRef();
  } else if (group === 'dev') {
    devTab = value;
    document.querySelectorAll('#dev-tabs .tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('onclick').includes("'" + value + "'"));
    });
    renderDev();
  }
}

function switchUTM(dim) {
  utmDim = dim;
  document.querySelectorAll('.sub-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('onclick').includes("'" + dim + "'"));
  });
  renderRef();
}

function selectMetric(m) {
  currentMetric = m;
  document.querySelectorAll('.metric-card').forEach(c => {
    c.classList.toggle('active', c.dataset.metric === m);
  });
  renderChart();
}

// ═══════════════════════════════════════════════════════════════════════════
// BAR LIST HTML
// ═══════════════════════════════════════════════════════════════════════════
function barListHTML(items, { showFavicon = false, showFlag = false, total = 0 } = {}) {
  if (!items || items.length === 0) {
    return '<div class="bar-empty">No data for this period</div>';
  }
  const max = items[0][1];
  return items.map(([name, count, meta]) => {
    const pctW = max > 0 ? Math.max((count / max) * 100, 3) : 0;
    let prefixHTML = '';
    if (showFavicon) {
      const host = meta || '';
      if (host) {
        prefixHTML = '<img class="bar-item-favicon" src="' + faviconUrl(host) + '" onerror="this.style.display=\'none\'" alt="">';
      } else {
        prefixHTML = '<svg class="bar-item-favicon" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" style="color:var(--text-3)"><circle cx="7" cy="7" r="5.5"/><path d="M7 1.5S5 4 5 7s2 5.5 2 5.5M7 1.5S9 4 9 7s-2 5.5-2 5.5M1.5 7h11"/></svg>';
      }
    }
    if (showFlag) {
      prefixHTML = '<span class="bar-item-flag">' + countryFlag(meta || '') + '</span>';
    }
    const pctDisplay = total > 0 ? ' <span style="color:var(--text-3);font-size:11px">(' + Math.round(count/total*100) + '%)</span>' : '';
    return '<div class="bar-item">' +
      '<div class="bar-item-label">' + prefixHTML + '<span title="' + name + '">' + name + '</span></div>' +
      '<div class="bar-bg"><div class="bar-fill" style="width:' + pctW + '%"></div></div>' +
      '<div class="bar-item-count">' + fmtNum(count) + pctDisplay + '</div>' +
    '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE METRICS FOR A DATE RANGE
// ═══════════════════════════════════════════════════════════════════════════
function computeMetrics(rows) {
  const total = rows.length;
  const visitors = new Set(rows.map(r => r.v || (r.ua + '|' + r.c))).size;

  // Bounce rate: a "session" = same visitor_id on same calendar day
  const sessions = {};
  rows.forEach(r => {
    const vid = r.v || (r.ua + '|' + r.c);
    const key = r.d + '|' + vid;
    if (!sessions[key]) sessions[key] = new Set();
    sessions[key].add(r.p);
  });
  const sessionCount  = Object.keys(sessions).length;
  const bounced       = Object.values(sessions).filter(s => s.size === 1).length;
  const bounceRate    = sessionCount > 0 ? Math.round((bounced / sessionCount) * 100) : 0;

  return { total, visitors, bounceRate, sessionCount };
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER METRIC CARDS + BADGE
// ═══════════════════════════════════════════════════════════════════════════
function renderMetrics(curr, prev) {
  const metrics = [
    { id: 'visitors', curr: curr.visitors, prev: prev.visitors, fmt: fmtNum, higherGood: true },
    { id: 'pageviews', curr: curr.total,   prev: prev.total,   fmt: fmtNum, higherGood: true },
    { id: 'bounce',   curr: curr.bounceRate, prev: prev.bounceRate, fmt: v => v + '%', higherGood: false },
  ];

  metrics.forEach(({ id, curr: c, prev: p, fmt, higherGood }) => {
    document.getElementById('mv-' + id).textContent = fmt(c);
    const badge  = document.getElementById('mb-' + id);
    const change = pct(c, p);
    if (p === 0 || change === 0) {
      badge.textContent = '—';
      badge.className = 'metric-badge badge-neutral';
    } else {
      const up = change > 0;
      const isGood = higherGood ? up : !up;
      badge.textContent = (up ? '▲' : '▼') + ' ' + Math.abs(change) + '%';
      badge.className = 'metric-badge ' + (isGood ? 'badge-green' : 'badge-red');
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER MAIN CHART
// ═══════════════════════════════════════════════════════════════════════════
function renderChart() {
  const days  = dateRange(currentDays);
  const today = new Date().toISOString().slice(0, 10);
  const pv    = PV.filter(r => daysSince(r.d) < currentDays);

  // Daily counts
  const dailyViews     = {};
  const dailyVisitors  = {};
  const dailySessions  = {};
  const dailyBounces   = {};

  pv.forEach(r => {
    const vid = r.v || (r.ua + '|' + r.c);
    dailyViews[r.d] = (dailyViews[r.d] || 0) + 1;
    if (!dailyVisitors[r.d]) dailyVisitors[r.d] = new Set();
    dailyVisitors[r.d].add(vid);

    // sessions per day
    const sessKey = r.d + '|' + vid;
    if (!dailySessions[r.d]) dailySessions[r.d] = {};
    if (!dailySessions[r.d][sessKey]) dailySessions[r.d][sessKey] = new Set();
    dailySessions[r.d][sessKey].add(r.p);
  });

  days.forEach(d => {
    if (!dailySessions[d]) { dailyBounces[d] = 0; return; }
    const sess = dailySessions[d];
    const total   = Object.keys(sess).length;
    const bounced = Object.values(sess).filter(s => s.size === 1).length;
    dailyBounces[d] = total > 0 ? Math.round((bounced / total) * 100) : 0;
  });

  // Group into weekly buckets for 90d view
  const useWeekly = currentDays > 30;
  let labels, dataPoints;

  if (useWeekly) {
    // Aggregate by week
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      weeks.push(chunk);
    }
    labels = weeks.map(chunk => fmtDateShort(chunk[0]));
    dataPoints = weeks.map(chunk => {
      if (currentMetric === 'visitors') {
        const vis = new Set();
        chunk.forEach(d => dailyVisitors[d] && dailyVisitors[d].forEach(v => vis.add(v)));
        return vis.size;
      } else if (currentMetric === 'pageviews') {
        return chunk.reduce((s, d) => s + (dailyViews[d] || 0), 0);
      } else {
        const vals = chunk.map(d => dailyBounces[d]).filter(v => v !== undefined && !isNaN(v));
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      }
    });
  } else {
    const skip = currentDays <= 7 ? 1 : 3;
    labels = days.map((d, i) => i % skip === 0 ? fmtDateShort(d) : '');
    dataPoints = days.map(d => {
      if (currentMetric === 'visitors') return dailyVisitors[d] ? dailyVisitors[d].size : 0;
      if (currentMetric === 'pageviews') return dailyViews[d] || 0;
      return dailyBounces[d] !== undefined ? dailyBounces[d] : 0;
    });
  }

  // Identify the "current" (incomplete) day
  const todayIdx = useWeekly ? -1 : days.indexOf(today);

  const blue     = css('--blue');
  const gridCol  = css('--border');
  const textCol  = css('--text-2');
  const bgFill   = css('--blue-dim');

  if (mainChart) { mainChart.destroy(); mainChart = null; }

  const ctx = document.getElementById('main-chart');
  if (!ctx) return;

  // Create segment styles: dashed for today's partial data
  const borderDash = dataPoints.map((_, i) => i === todayIdx ? [4, 3] : []);
  const pointStyle = dataPoints.map((_, i) => i === todayIdx ? 'circle' : 'circle');

  mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: dataPoints,
        borderColor: blue,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return bgFill;
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, blue + '33');
          gradient.addColorStop(1, blue + '00');
          return gradient;
        },
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: blue,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        segment: {
          borderDash: ctx2 => ctx2.p0DataIndex === todayIdx - 1 ? [4, 3] : [],
        },
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--bg-300'),
          borderColor: gridCol,
          borderWidth: 1,
          titleColor: css('--text-1'),
          bodyColor: textCol,
          padding: 10,
          callbacks: {
            label: ctx2 => {
              const v = ctx2.raw;
              if (currentMetric === 'bounce') return ' Bounce Rate: ' + v + '%';
              if (currentMetric === 'visitors') return ' Visitors: ' + v.toLocaleString();
              return ' Page Views: ' + v.toLocaleString();
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridCol, drawBorder: false },
          border: { display: false },
          ticks: {
            color: textCol,
            font: { size: 11 },
            maxRotation: 0,
            autoSkip: false,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: gridCol, drawBorder: false },
          border: { display: false },
          ticks: {
            color: textCol,
            font: { size: 11 },
            maxTicksLimit: 5,
            callback: v => currentMetric === 'bounce' ? v + '%' : fmtNum(v),
          },
        },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER PAGES PANEL
// ═══════════════════════════════════════════════════════════════════════════
function renderPages() {
  const pv = PV.filter(r => daysSince(r.d) < currentDays);
  const counts = {};

  if (pagesTab === 'pages') {
    pv.forEach(r => { counts[r.p] = (counts[r.p] || 0) + 1; });
  } else {
    // Routes: strip dynamic segments (UUIDs, numeric ids)
    pv.forEach(r => {
      const route = r.p.replace(/\\/[0-9a-f-]{8,}/gi, '/[id]').replace(/\\/\\d+(?=\\/|$)/g, '/[id]');
      counts[route] = (counts[route] || 0) + 1;
    });
  }

  const items = topN(counts, 10);
  document.getElementById('pages-content').innerHTML = barListHTML(items);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER REFERRERS PANEL
// ═══════════════════════════════════════════════════════════════════════════
function renderRef() {
  const pv = PV.filter(r => daysSince(r.d) < currentDays);

  if (refTab === 'referrers') {
    const counts = {};
    const hosts  = {};
    pv.forEach(r => {
      const { name, host } = classifyReferrer(r.r);
      counts[name] = (counts[name] || 0) + 1;
      if (!hosts[name]) hosts[name] = host;
    });
    const items = topN(counts, 10).map(([name, count]) => [name, count, hosts[name]]);
    document.getElementById('ref-content').innerHTML = barListHTML(items, { showFavicon: true });
  } else {
    // UTM dimensions
    const dimKey = { source:'us', medium:'um', campaign:'uc', content:'ut', term:'uk' }[utmDim];
    const counts = {};
    pv.forEach(r => {
      const val = r[dimKey];
      if (val) counts[val] = (counts[val] || 0) + 1;
    });
    const items = topN(counts, 10);
    document.getElementById('ref-content').innerHTML = barListHTML(items);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER COUNTRIES
// ═══════════════════════════════════════════════════════════════════════════
function renderCountries() {
  const pv     = PV.filter(r => daysSince(r.d) < currentDays);
  const counts = {};
  pv.forEach(r => { if (r.c) counts[r.c] = (counts[r.c] || 0) + 1; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const items = topN(counts, 10).map(([code, count]) => [countryName(code), count, code]);
  document.getElementById('countries-content').innerHTML = barListHTML(items, { showFlag: true, total });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER DEVICES / BROWSERS
// ═══════════════════════════════════════════════════════════════════════════
function renderDev() {
  const pv     = PV.filter(r => daysSince(r.d) < currentDays);
  const counts = {};
  pv.forEach(r => {
    const key = devTab === 'devices' ? getDevice(r.ua) : getBrowser(r.ua);
    counts[key] = (counts[key] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const items = topN(counts, 8);
  document.getElementById('dev-content').innerHTML = barListHTML(items, { total });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER OS
// ═══════════════════════════════════════════════════════════════════════════
function renderOS() {
  const pv     = PV.filter(r => daysSince(r.d) < currentDays);
  const counts = {};
  pv.forEach(r => {
    const os = getOS(r.ua);
    counts[os] = (counts[os] || 0) + 1;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const items = topN(counts, 8);
  document.getElementById('os-content').innerHTML = barListHTML(items, { total });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER EVENTS
// ═══════════════════════════════════════════════════════════════════════════
function renderEvents() {
  const ev = EV.filter(r => daysSince(r.d) < currentDays);
  if (ev.length === 0) {
    document.getElementById('events-content').innerHTML = '<div class="no-data">No events in this period</div>';
    return;
  }

  const totalCounts   = {};
  const visitorCounts = {};
  ev.forEach(r => {
    totalCounts[r.n]  = (totalCounts[r.n] || 0) + 1;
    if (!visitorCounts[r.n]) visitorCounts[r.n] = new Set();
    if (r.u) visitorCounts[r.n].add(r.u);
  });

  const rows = topN(totalCounts, 15);

  const html = '<table class="ev-table">' +
    '<thead><tr><th>Event</th><th>Visitors</th><th>Total</th></tr></thead>' +
    '<tbody>' +
    rows.map(([name, count]) => {
      const vis = visitorCounts[name] ? visitorCounts[name].size : 0;
      const label = name.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase());
      return '<tr><td><span class="ev-dot"></span><span class="ev-name">' + label + '</span></td>' +
        '<td>' + fmtNum(vis) + '</td>' +
        '<td>' + fmtNum(count) + '</td></tr>';
    }).join('') +
    '</tbody></table>';

  document.getElementById('events-content').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER FUNNEL
// ═══════════════════════════════════════════════════════════════════════════
function renderFunnel() {
  const ev = EV.filter(r => daysSince(r.d) < currentDays);
  const counts = {};
  ev.forEach(r => { counts[r.n] = (counts[r.n] || 0) + 1; });

  const steps = [
    { key: 'landing_page_view',   label: 'Landing Page View' },
    { key: 'signup_page_view',    label: 'Signup Page' },
    { key: 'signup_complete',     label: 'Signed Up' },
    { key: 'onboarding_complete', label: 'Onboarding Complete' },
  ];

  const values = steps.map(s => counts[s.key] || 0);
  const top    = Math.max(values[0], 1);

  if (values.every(v => v === 0)) {
    document.getElementById('funnel-content').innerHTML = '<div class="no-data">No funnel events in this period</div>';
    return;
  }

  const html = '<div class="funnel-wrap">' +
    steps.map((step, i) => {
      const val     = values[i];
      const barPct  = Math.max((val / top) * 100, val > 0 ? 4 : 0);
      const prevVal = i > 0 ? values[i - 1] : null;
      const convStr = prevVal !== null && prevVal > 0
        ? Math.round((val / prevVal) * 100) + '% from prev step'
        : '';
      const topStr  = top > 0 && i > 0 ? Math.round((val / top) * 100) + '% of top' : '';
      return '<div class="funnel-step">' +
        '<div class="funnel-step-header">' +
        '<span class="funnel-step-name">' + step.label + '</span>' +
        '<span class="funnel-step-meta">' +
        (val > 0 ? '<span>' + val.toLocaleString() + '</span>' : '<span style="color:var(--text-3)">0</span>') +
        '</span>' +
        '</div>' +
        '<div class="funnel-bar-track"><div class="funnel-bar-fill" style="width:' + barPct + '%"></div></div>' +
        (convStr || topStr ? '<div class="funnel-conv">' + [convStr, topStr].filter(Boolean).join(' &middot; ') + '</div>' : '') +
        '</div>';
    }).join('') +
    '</div>';

  document.getElementById('funnel-content').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL RENDER
// ═══════════════════════════════════════════════════════════════════════════
function render() {
  const days = currentDays;

  // Current period
  const pvCurr = PV.filter(r => daysSince(r.d) < days);
  // Previous period (same length, immediately before current)
  const pvPrev = PV.filter(r => {
    const d = daysSince(r.d);
    return d >= days && d < days * 2;
  });

  const curr = computeMetrics(pvCurr);
  const prev = computeMetrics(pvPrev);

  renderMetrics(curr, prev);
  renderChart();
  renderPages();
  renderRef();
  renderCountries();
  renderDev();
  renderOS();
  renderEvents();
  renderFunnel();
}

// ─── Boot ─────────────────────────────────────────────────────────────────
render();
<\/script>
</body>
</html>`;
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
