/**
 * Self-contained analytics dashboard generator.
 * Runs in GitHub Actions (plain Node.js + @supabase/supabase-js).
 *
 * Env vars required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

// Fetch 90 days so client-side filtering can do 7d/30d/90d
const FETCH_DAYS = 90;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function fetchAll(table, select, since) {
  // Supabase caps at 1000 rows per request — paginate
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
  console.log('Fetching data from Supabase...');
  const since = daysAgo(FETCH_DAYS);

  const [pageViews, events] = await Promise.all([
    fetchAll('page_views', 'path, referrer, user_agent, country, visitor_id, utm_source, utm_medium, utm_campaign, created_at', since),
    fetchAll('analytics_events', 'event_name, event_category, created_at, session_id, user_id', since),
  ]);

  console.log('  page_views:', pageViews.length, 'rows');
  console.log('  analytics_events:', events.length, 'rows');

  const html = buildHTML(pageViews, events);
  const outPath = path.join(__dirname, 'index.html');
  fs.writeFileSync(outPath, html);
  console.log('Dashboard written to:', outPath);
}

function buildHTML(pageViews, events) {
  const generated = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });

  // Embed raw data as JSON for client-side filtering
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
  }));

  const evData = events.map(r => ({
    d: r.created_at.slice(0, 10),
    n: r.event_name,
    cat: r.event_category,
    u: r.user_id || r.session_id || '',
  }));

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpeakUp Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
  <style>
    :root {
      --bg: #0d1117; --bg2: #161b22; --bg3: #1c2128; --border: #21262d;
      --text: #e6edf3; --text2: #8b949e; --text3: #484f58;
      --blue: #58a6ff; --green: #3fb950; --purple: #bc8cff;
      --orange: #d29922; --red: #f85149; --cyan: #39d2c0; --pink: #f778ba;
    }
    [data-theme="light"] {
      --bg: #f6f8fa; --bg2: #ffffff; --bg3: #f0f2f5; --border: #d0d7de;
      --text: #1f2328; --text2: #656d76; --text3: #8c959f;
      --blue: #0969da; --green: #1a7f37; --purple: #8250df;
      --orange: #bf8700; --red: #cf222e; --cyan: #0e8a7e; --pink: #bf3989;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    .wrap { max-width: 1140px; margin: 0 auto; padding: 28px 24px; }

    /* Header */
    .hdr { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
    .hdr h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.4px; }
    .hdr-right { display: flex; align-items: center; gap: 8px; }
    .subtitle { color: var(--text2); font-size: 12px; margin-top: 2px; }

    /* Controls */
    .controls { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill { background: var(--bg2); border: 1px solid var(--border); color: var(--text2); border-radius: 20px; padding: 5px 14px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .pill:hover { border-color: var(--blue); color: var(--text); }
    .pill.active { background: var(--blue); border-color: var(--blue); color: #fff; }
    .btn-icon { background: var(--bg2); border: 1px solid var(--border); color: var(--text2); border-radius: 8px; padding: 5px 10px; font-size: 14px; cursor: pointer; transition: all 0.15s; }
    .btn-icon:hover { border-color: var(--blue); color: var(--text); }

    /* Stats */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 20px; }
    .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
    .stat .lbl { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.5px; }
    .stat .val { font-size: 30px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .stat .sub { font-size: 11px; color: var(--text3); margin-top: 2px; }

    /* Section */
    .sec { font-size: 13px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.7px; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }

    /* Cards / Grid */
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }
    .grid.g1 { grid-template-columns: 1fr; }
    .grid.g3 { grid-template-columns: repeat(3, 1fr); }
    .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
    .card h3 { font-size: 12px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 14px; }
    .cw { position: relative; }
    .cw.h240 { height: 240px; }
    .cw.h280 { height: 280px; }
    .cw.h200 { height: 200px; }
    .cw canvas { width: 100% !important; height: 100% !important; }

    /* Tables */
    table { width: 100%; border-collapse: separate; border-spacing: 0; }
    th { text-align: left; padding: 8px 14px; font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 2px solid var(--border); }
    td { padding: 8px 14px; font-size: 13px; border-bottom: 1px solid var(--border); }
    td.n { font-variant-numeric: tabular-nums; font-weight: 500; text-align: right; }
    th:last-child { text-align: right; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg); }
    .empty { color: var(--text3); font-style: italic; padding: 40px 0; text-align: center; font-size: 13px; }

    /* Funnel */
    .funnel { display: flex; flex-direction: column; gap: 8px; }
    .fs { display: flex; align-items: center; gap: 14px; }
    .fl { font-size: 12px; font-weight: 500; color: var(--text2); min-width: 150px; text-align: right; }
    .fb { height: 34px; background: linear-gradient(90deg, var(--green), #2ea043); border-radius: 6px; display: flex; align-items: center; padding: 0 12px; font-size: 12px; font-weight: 600; color: #fff; white-space: nowrap; min-width: 50px; }

    /* Source list */
    .source-list { list-style: none; }
    .source-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
    .source-item:last-child { border-bottom: none; }
    .source-name { color: var(--text); }
    .source-bar-wrap { flex: 1; margin: 0 16px; height: 6px; background: var(--bg3); border-radius: 3px; overflow: hidden; }
    .source-bar { height: 100%; border-radius: 3px; }
    .source-count { font-variant-numeric: tabular-nums; font-weight: 500; color: var(--text2); min-width: 40px; text-align: right; }

    footer { text-align: center; color: var(--text3); font-size: 11px; margin-top: 40px; padding: 16px 0; border-top: 1px solid var(--border); }

    @media (max-width: 768px) {
      .grid, .grid.g3 { grid-template-columns: 1fr; }
      .wrap { padding: 14px; }
      .hdr { flex-direction: column; align-items: flex-start; }
      .fl { min-width: 100px; font-size: 11px; }
      .stats { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div>
      <h1>SpeakUp Analytics</h1>
      <div class="subtitle">Updated ${generated} MT</div>
    </div>
    <div class="hdr-right">
      <div class="controls" id="period-controls">
        <button class="pill" data-days="7">7d</button>
        <button class="pill active" data-days="30">30d</button>
        <button class="pill" data-days="90">90d</button>
      </div>
      <button class="btn-icon" onclick="toggleTheme()" title="Toggle theme" id="theme-btn">&#9789;</button>
    </div>
  </div>

  <div class="stats" id="stats-row"></div>

  <div class="sec">Traffic</div>
  <div class="grid" id="traffic-grid"></div>

  <div class="sec">Sources</div>
  <div class="grid g3" id="sources-grid"></div>

  <div class="sec">User Behavior</div>
  <div id="behavior-section"></div>

  <footer>SpeakUp Analytics &middot; Auto-generated</footer>
</div>

<script>
// ── Raw data ──
const PV = ${JSON.stringify(pvData)};
const EV = ${JSON.stringify(evData)};

// ── State ──
let currentDays = 30;

// ── Theme ──
function toggleTheme() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('su-theme', t);
  document.getElementById('theme-btn').innerHTML = t === 'dark' ? '\\u263D' : '\\u2600';
  render();
}
(function() {
  const s = localStorage.getItem('su-theme');
  if (s === 'light') { document.documentElement.setAttribute('data-theme', 'light'); document.getElementById('theme-btn').innerHTML = '\\u2600'; }
})();

// ── Period controls ──
document.getElementById('period-controls').addEventListener('click', e => {
  const btn = e.target.closest('.pill');
  if (!btn) return;
  document.querySelectorAll('#period-controls .pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentDays = parseInt(btn.dataset.days);
  render();
});

// ── Helpers ──
function getStyle(prop) { return getComputedStyle(document.documentElement).getPropertyValue(prop).trim(); }
function daysSince(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.floor((today - d) / 86400000);
}
function dateRange(days) {
  const arr = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    arr.push(d.toISOString().slice(0, 10));
  }
  return arr;
}
function fmtDate(d) {
  const [,m,day] = d.split('-');
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[parseInt(m)] + ' ' + parseInt(day);
}
function fmtEvent(n) { return n.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase()); }
function topN(obj, n) { return Object.entries(obj).sort((a,b) => b[1] - a[1]).slice(0, n); }
function isMobile(ua) {
  if (/mobile|android.*mobile|iphone|ipod/i.test(ua)) return 'Mobile';
  if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) return 'Tablet';
  return 'Desktop';
}
function getBrowser(ua) {
  if (/edg\\//i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  return 'Other';
}
function classifyReferrer(ref) {
  if (!ref) return 'Direct';
  try {
    const h = new URL(ref).hostname.toLowerCase();
    if (h.includes('speakupcoach.com')) return 'Direct';
    if (h.includes('google')) return 'Google';
    if (h.includes('instagram') || h.includes('ig.')) return 'Instagram';
    if (h.includes('facebook') || h.includes('fb.')) return 'Facebook';
    if (h.includes('twitter') || h.includes('t.co') || h.includes('x.com')) return 'X / Twitter';
    if (h.includes('linkedin')) return 'LinkedIn';
    if (h.includes('tiktok')) return 'TikTok';
    if (h.includes('youtube')) return 'YouTube';
    if (h.includes('reddit')) return 'Reddit';
    if (h.includes('bing')) return 'Bing';
    return h;
  } catch { return 'Other'; }
}

// ── Chart management ──
const charts = {};
function makeChart(id, config) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const canvas = document.getElementById(id);
  if (!canvas) return;
  charts[id] = new Chart(canvas, config);
}

// ── Source list builder ──
function sourceListHTML(items, color) {
  if (items.length === 0) return '<div class="empty">No data yet</div>';
  const max = items[0][1];
  return '<ul class="source-list">' + items.map(([name, count]) => {
    const pct = Math.max((count / max) * 100, 4);
    return '<li class="source-item"><span class="source-name">' + name + '</span><div class="source-bar-wrap"><div class="source-bar" style="width:' + pct + '%;background:' + color + '"></div></div><span class="source-count">' + count.toLocaleString() + '</span></li>';
  }).join('') + '</ul>';
}

// ── Main render ──
function render() {
  const days = dateRange(currentDays);
  const pv = PV.filter(r => daysSince(r.d) < currentDays);
  const ev = EV.filter(r => daysSince(r.d) < currentDays);

  const C = {
    blue: getStyle('--blue'), green: getStyle('--green'), purple: getStyle('--purple'),
    orange: getStyle('--orange'), red: getStyle('--red'), cyan: getStyle('--cyan'), pink: getStyle('--pink'),
    text: getStyle('--text2'), grid: getStyle('--border'),
  };
  const PALETTE = [C.blue, C.green, C.purple, C.orange, C.red, C.cyan, C.pink];

  Chart.defaults.color = C.text;
  Chart.defaults.borderColor = C.grid;

  // ── Compute stats ──
  const totalViews = pv.length;
  const uniqueVisitors = new Set(pv.map(r => r.v || (r.ua + '|' + r.c))).size;

  // Bounce rate: visitors who viewed only 1 page
  const visitorPages = {};
  pv.forEach(r => {
    const vid = r.v || (r.ua + '|' + r.c);
    if (!visitorPages[vid]) visitorPages[vid] = new Set();
    visitorPages[vid].add(r.d + r.p); // unique page per day
  });
  const totalSessions = Object.keys(visitorPages).length;
  const bouncedSessions = Object.values(visitorPages).filter(s => s.size === 1).length;
  const bounceRate = totalSessions > 0 ? Math.round((bouncedSessions / totalSessions) * 100) : 0;

  // Daily views/visitors
  const dailyViews = {};
  const dailyVisitors = {};
  pv.forEach(r => {
    dailyViews[r.d] = (dailyViews[r.d] || 0) + 1;
    if (!dailyVisitors[r.d]) dailyVisitors[r.d] = new Set();
    dailyVisitors[r.d].add(r.v || (r.ua + '|' + r.c));
  });

  // Behavior stats
  const evCounts = {};
  ev.forEach(r => { evCounts[r.n] = (evCounts[r.n] || 0) + 1; });
  const recStarted = evCounts['recording_started'] || 0;
  const recCompleted = evCounts['recording_completed'] || 0;
  const lesStarted = evCounts['lesson_started'] || 0;
  const lesCompleted = evCounts['lesson_completed'] || 0;

  // ── Stats row ──
  const hasPV = pv.length > 0;
  document.getElementById('stats-row').innerHTML = \`
    <div class="stat"><div class="lbl">Visitors</div><div class="val">\${hasPV ? uniqueVisitors.toLocaleString() : '--'}</div><div class="sub">\${hasPV ? 'Unique visitors' : 'Collecting...'}</div></div>
    <div class="stat"><div class="lbl">Page Views</div><div class="val">\${hasPV ? totalViews.toLocaleString() : '--'}</div><div class="sub">\${hasPV ? (totalViews / currentDays).toFixed(1) + '/day avg' : 'Collecting...'}</div></div>
    <div class="stat"><div class="lbl">Bounce Rate</div><div class="val">\${hasPV ? bounceRate + '%' : '--'}</div><div class="sub">\${hasPV ? bouncedSessions + ' of ' + totalSessions + ' sessions' : 'Collecting...'}</div></div>
    <div class="stat"><div class="lbl">Recordings</div><div class="val">\${recStarted > 0 ? recCompleted + '/' + recStarted : '--'}</div><div class="sub">\${recStarted > 0 ? Math.round(recCompleted/recStarted*100) + '% completed' : 'No recordings'}</div></div>
    <div class="stat"><div class="lbl">Lessons</div><div class="val">\${lesStarted > 0 ? lesCompleted + '/' + lesStarted : '--'}</div><div class="sub">\${lesStarted > 0 ? Math.round(lesCompleted/lesStarted*100) + '% completed' : 'No lessons'}</div></div>
  \`;

  // ── Traffic charts ──
  const labels = days.map(fmtDate);
  // Thin labels: show every Nth label
  const labelInterval = currentDays <= 7 ? 1 : currentDays <= 30 ? 3 : 7;

  document.getElementById('traffic-grid').innerHTML = \`
    <div class="card"><h3>Page Views & Visitors</h3><div class="cw h240"><canvas id="c-daily"></canvas></div></div>
    <div class="card"><h3>Top Pages</h3><div class="cw h280"><canvas id="c-pages"></canvas></div></div>
  \`;

  if (hasPV) {
    makeChart('c-daily', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Views', data: days.map(d => dailyViews[d] || 0), borderColor: C.blue, backgroundColor: C.blue + '18', fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
          { label: 'Visitors', data: days.map(d => dailyVisitors[d] ? dailyVisitors[d].size : 0), borderColor: C.green, backgroundColor: C.green + '18', fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 14, font: { size: 11 } } } },
        scales: {
          x: { grid: { color: C.grid }, ticks: { color: C.text, font: { size: 10 }, maxRotation: 0, callback: (v,i) => i % labelInterval === 0 ? labels[i] : '' } },
          y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.text, font: { size: 10 } } },
        },
      },
    });

    const pageCounts = {};
    pv.forEach(r => { pageCounts[r.p] = (pageCounts[r.p] || 0) + 1; });
    const topPages = topN(pageCounts, 10);

    makeChart('c-pages', {
      type: 'bar',
      data: {
        labels: topPages.map(p => p[0]),
        datasets: [{ data: topPages.map(p => p[1]), backgroundColor: C.blue + 'cc', borderRadius: 4, barThickness: 20 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw.toLocaleString() + ' views' } } },
        scales: { x: { grid: { color: C.grid }, ticks: { color: C.text } }, y: { grid: { display: false }, ticks: { color: C.text, font: { size: 11 } } } },
      },
    });
  }

  // ── Sources ──
  const referrerCounts = {};
  const utmSourceCounts = {};
  const countryCounts = {};
  pv.forEach(r => {
    const src = classifyReferrer(r.r);
    referrerCounts[src] = (referrerCounts[src] || 0) + 1;
    if (r.us) utmSourceCounts[r.us] = (utmSourceCounts[r.us] || 0) + 1;
    if (r.c) countryCounts[r.c] = (countryCounts[r.c] || 0) + 1;
  });

  document.getElementById('sources-grid').innerHTML = \`
    <div class="card"><h3>Referrers</h3>\${hasPV ? sourceListHTML(topN(referrerCounts, 10), C.blue) : '<div class="empty">No data yet</div>'}</div>
    <div class="card"><h3>UTM Sources</h3>\${hasPV && Object.keys(utmSourceCounts).length > 0 ? sourceListHTML(topN(utmSourceCounts, 10), C.purple) : '<div class="empty">' + (hasPV ? 'No UTM-tagged traffic yet' : 'No data yet') + '</div>'}</div>
    <div class="card"><h3>Countries</h3>\${hasPV && Object.keys(countryCounts).length > 0 ? sourceListHTML(topN(countryCounts, 10), C.cyan) : '<div class="empty">No data yet</div>'}</div>
  \`;

  // ── Devices & browsers (only if data) ──
  const deviceCounts = {};
  const browserCounts = {};
  pv.forEach(r => {
    if (r.ua) {
      const dev = isMobile(r.ua);
      deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;
      const br = getBrowser(r.ua);
      browserCounts[br] = (browserCounts[br] || 0) + 1;
    }
  });

  // ── Behavior section ──
  const hasEV = ev.length > 0;
  const dailyActiveUsers = {};
  ev.forEach(r => {
    if (!dailyActiveUsers[r.d]) dailyActiveUsers[r.d] = new Set();
    dailyActiveUsers[r.d].add(r.u);
  });

  const funnel = [
    ['Landing Page', evCounts['landing_page_view'] || 0],
    ['Signup Page', evCounts['signup_page_view'] || 0],
    ['Signup Complete', evCounts['signup_complete'] || 0],
    ['Onboarding Done', evCounts['onboarding_complete'] || 0],
  ];
  const funnelMax = Math.max(funnel[0][1], 1);

  const catCounts = {};
  ev.forEach(r => { catCounts[r.cat] = (catCounts[r.cat] || 0) + 1; });

  const topEvents = topN(evCounts, 15);

  let behaviorHTML = '';

  if (hasPV) {
    behaviorHTML += '<div class="grid"><div class="card"><h3>Devices</h3><div class="cw h200"><canvas id="c-devices"></canvas></div></div><div class="card"><h3>Browsers</h3><div class="cw h200"><canvas id="c-browsers"></canvas></div></div></div>';
  }

  if (hasEV) {
    const funnelBars = funnel.map(([label, count], i) => {
      const pct = Math.max((count / funnelMax) * 100, 8);
      const conv = i > 0 && funnel[i-1][1] > 0 ? ' (' + Math.round(count / funnel[i-1][1] * 100) + '%)' : '';
      return '<div class="fs"><span class="fl">' + label + '</span><div class="fb" style="width:' + pct + '%">' + count + conv + '</div></div>';
    }).join('');

    behaviorHTML += \`
      <div class="grid g1"><div class="card"><h3>Signup Funnel</h3><div class="funnel">\${funnelBars}</div></div></div>
      <div class="grid">
        <div class="card"><h3>Daily Active Users</h3><div class="cw h240"><canvas id="c-dau"></canvas></div></div>
        <div class="card"><h3>Events by Category</h3><div class="cw h240"><canvas id="c-cats"></canvas></div></div>
      </div>
      <div class="grid g1"><div class="card"><h3>Top Events</h3>
        <table><thead><tr><th>Event</th><th>Count</th></tr></thead><tbody>
          \${topEvents.map(([n, c]) => '<tr><td>' + fmtEvent(n) + '</td><td class="n">' + c.toLocaleString() + '</td></tr>').join('')}
        </tbody></table>
      </div></div>
    \`;
  } else {
    behaviorHTML += '<div class="grid g1"><div class="card"><div class="empty">No user behavior events in this period.</div></div></div>';
  }

  document.getElementById('behavior-section').innerHTML = behaviorHTML;

  // Render charts that depend on behavior section DOM
  if (hasPV && Object.values(deviceCounts).some(v => v > 0)) {
    const filteredDevices = Object.entries(deviceCounts).filter(([,v]) => v > 0);
    makeChart('c-devices', {
      type: 'doughnut',
      data: { labels: filteredDevices.map(d => d[0]), datasets: [{ data: filteredDevices.map(d => d[1]), backgroundColor: [C.blue, C.green, C.purple], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { size: 11 } } } } },
    });
  }
  if (hasPV && Object.keys(browserCounts).length > 0) {
    makeChart('c-browsers', {
      type: 'doughnut',
      data: { labels: Object.keys(browserCounts), datasets: [{ data: Object.values(browserCounts), backgroundColor: PALETTE.slice(0, Object.keys(browserCounts).length), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { size: 11 } } } } },
    });
  }

  if (hasEV) {
    makeChart('c-dau', {
      type: 'line',
      data: {
        labels,
        datasets: [{ label: 'Users', data: days.map(d => dailyActiveUsers[d] ? dailyActiveUsers[d].size : 0), borderColor: C.green, backgroundColor: C.green + '18', fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: C.grid }, ticks: { color: C.text, font: { size: 10 }, maxRotation: 0, callback: (v,i) => i % labelInterval === 0 ? labels[i] : '' } },
          y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.text, font: { size: 10 } } },
        },
      },
    });

    makeChart('c-cats', {
      type: 'bar',
      data: {
        labels: Object.keys(catCounts).map(fmtEvent),
        datasets: [{ data: Object.values(catCounts), backgroundColor: PALETTE.slice(0, Object.keys(catCounts).length).map(c => c + 'cc'), borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { color: C.text, font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.text } } },
      },
    });
  }
}

// Initial render
render();
<\/script>
</body>
</html>`;
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
