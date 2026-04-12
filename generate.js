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

const DAYS = 30;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function fetchPageViews() {
  const since = daysAgo(DAYS);
  const { data, error } = await db
    .from('page_views')
    .select('path, referrer, user_agent, country, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`page_views query failed: ${error.message}`);
  return data || [];
}

async function fetchAnalyticsEvents() {
  const since = daysAgo(DAYS);
  const { data, error } = await db
    .from('analytics_events')
    .select('event_name, event_category, properties, created_at, session_id, user_id')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`analytics_events query failed: ${error.message}`);
  return data || [];
}

function dateKey(iso) { return iso.slice(0, 10); }

function isMobile(ua) {
  if (/mobile|android.*mobile|iphone|ipod/i.test(ua)) return 'Mobile';
  if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

function getBrowser(ua) {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/opera|opr/i.test(ua)) return 'Opera';
  return 'Other';
}

function topN(counts, n) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function getAllDays() {
  const allDays = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    allDays.push(d.toISOString().slice(0, 10));
  }
  return allDays;
}

function processPageViews(rows) {
  const dailyViews = {};
  const dailyVisitors = {};
  const pageCounts = {};
  const referrerCounts = {};
  const countryCounts = {};
  const deviceCounts = { Mobile: 0, Tablet: 0, Desktop: 0 };
  const browserCounts = {};

  for (const row of rows) {
    const day = dateKey(row.created_at);
    dailyViews[day] = (dailyViews[day] || 0) + 1;
    const visitorKey = `${row.user_agent || 'unknown'}|${row.country || 'unknown'}`;
    if (!dailyVisitors[day]) dailyVisitors[day] = new Set();
    dailyVisitors[day].add(visitorKey);
    pageCounts[row.path] = (pageCounts[row.path] || 0) + 1;
    if (row.referrer) {
      try {
        const host = new URL(row.referrer).hostname;
        if (host && !host.includes('speakupcoach.com')) {
          referrerCounts[host] = (referrerCounts[host] || 0) + 1;
        }
      } catch {}
    }
    if (row.country) countryCounts[row.country] = (countryCounts[row.country] || 0) + 1;
    if (row.user_agent) {
      deviceCounts[isMobile(row.user_agent)]++;
      const browser = getBrowser(row.user_agent);
      browserCounts[browser] = (browserCounts[browser] || 0) + 1;
    }
  }

  const allDays = getAllDays();
  const hasData = rows.length > 0;

  return {
    hasData,
    totalViews: rows.length,
    dailyLabels: allDays,
    dailyViews: allDays.map(d => dailyViews[d] || 0),
    dailyVisitors: allDays.map(d => (dailyVisitors[d] ? dailyVisitors[d].size : 0)),
    topPages: topN(pageCounts, 10),
    topReferrers: topN(referrerCounts, 10),
    topCountries: topN(countryCounts, 10),
    devices: deviceCounts,
    browsers: browserCounts,
  };
}

function processEvents(rows) {
  const eventCounts = {};
  const categoryCounts = {};
  const dailyActiveUsers = {};

  for (const row of rows) {
    eventCounts[row.event_name] = (eventCounts[row.event_name] || 0) + 1;
    categoryCounts[row.event_category] = (categoryCounts[row.event_category] || 0) + 1;
    if (row.user_id || row.session_id) {
      const day = dateKey(row.created_at);
      if (!dailyActiveUsers[day]) dailyActiveUsers[day] = new Set();
      dailyActiveUsers[day].add(row.user_id || row.session_id);
    }
  }

  const funnel = {
    landing: eventCounts['landing_page_view'] || 0,
    signupPage: eventCounts['signup_page_view'] || 0,
    signupComplete: eventCounts['signup_complete'] || 0,
    onboardingComplete: eventCounts['onboarding_complete'] || 0,
  };

  const recordingsStarted = eventCounts['recording_started'] || 0;
  const recordingsCompleted = eventCounts['recording_completed'] || 0;
  const lessonsStarted = eventCounts['lesson_started'] || 0;
  const lessonsCompleted = eventCounts['lesson_completed'] || 0;

  const allDays = getAllDays();
  const hasData = rows.length > 0;

  return {
    hasData,
    totalEvents: rows.length,
    topEvents: topN(eventCounts, 15),
    categories: categoryCounts,
    funnel,
    recordingRate: recordingsStarted > 0 ? Math.round((recordingsCompleted / recordingsStarted) * 100) : 0,
    lessonRate: lessonsStarted > 0 ? Math.round((lessonsCompleted / lessonsStarted) * 100) : 0,
    recordingsStarted, recordingsCompleted, lessonsStarted, lessonsCompleted,
    dailyLabels: allDays,
    dailyActiveUsers: allDays.map(d => (dailyActiveUsers[d] ? dailyActiveUsers[d].size : 0)),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────

function fmtEvent(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtLabel(d) {
  const [, m, day] = d.split('-');
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[parseInt(m)] + ' ' + parseInt(day);
}

// ── HTML generation ───────────────────────────────────────────────────

function generateHTML(traffic, events) {
  const generated = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
  const shortLabels = JSON.stringify(traffic.dailyLabels.map(fmtLabel));

  // Empty state helper
  function emptyState(msg) {
    return '<div class="empty-state">' + msg + '</div>';
  }

  // Build funnel HTML
  const funnelSteps = [
    ['Landing Page', events.funnel.landing],
    ['Signup Page', events.funnel.signupPage],
    ['Signup Complete', events.funnel.signupComplete],
    ['Onboarding Complete', events.funnel.onboardingComplete],
  ];
  const funnelMax = Math.max(events.funnel.landing, 1);
  const funnelHTML = funnelSteps.map(([label, count], i) => {
    const pct = Math.max((count / funnelMax) * 100, 8);
    const convRate = i > 0 && funnelSteps[i - 1][1] > 0
      ? ' (' + Math.round((count / funnelSteps[i - 1][1]) * 100) + '%)'
      : '';
    return '<div class="funnel-step">'
      + '<span class="funnel-label">' + label + '</span>'
      + '<div class="funnel-bar" style="width:' + pct + '%"><span class="funnel-count">' + count + convRate + '</span></div>'
      + '</div>';
  }).join('');

  // Build top events table
  const eventsTableHTML = events.topEvents.map(([name, count]) =>
    '<tr><td>' + fmtEvent(name) + '</td><td class="num">' + count.toLocaleString() + '</td></tr>'
  ).join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpeakUp Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
  <style>
    :root {
      --bg: #0d1117;
      --bg-card: #161b22;
      --border: #21262d;
      --text: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #484f58;
      --accent: #58a6ff;
      --accent-green: #3fb950;
      --accent-purple: #bc8cff;
      --accent-orange: #d29922;
      --accent-red: #f85149;
      --accent-cyan: #39d2c0;
      --accent-pink: #f778ba;
      --funnel-start: #238636;
      --funnel-end: #2ea043;
    }

    [data-theme="light"] {
      --bg: #f6f8fa;
      --bg-card: #ffffff;
      --border: #d0d7de;
      --text: #1f2328;
      --text-secondary: #656d76;
      --text-muted: #8c959f;
      --accent: #0969da;
      --accent-green: #1a7f37;
      --accent-purple: #8250df;
      --accent-orange: #bf8700;
      --accent-red: #cf222e;
      --accent-cyan: #0e8a7e;
      --accent-pink: #bf3989;
      --funnel-start: #1a7f37;
      --funnel-end: #2da44e;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }

    .container {
      max-width: 1140px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .header .subtitle {
      color: var(--text-secondary);
      font-size: 13px;
      margin-top: 4px;
    }
    .theme-toggle {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .theme-toggle:hover {
      border-color: var(--accent);
      color: var(--text);
    }

    /* ── Section headers ── */
    .section-header {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin: 36px 0 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    /* ── Stat cards ── */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
    }
    .stat-card .label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    .stat-card .value {
      font-size: 32px;
      font-weight: 700;
      color: var(--text);
      margin-top: 6px;
      font-variant-numeric: tabular-nums;
    }
    .stat-card .sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* ── Chart cards ── */
    .chart-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 12px;
    }
    .chart-grid.single { grid-template-columns: 1fr; }
    .chart-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
    }
    .chart-card h3 {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    .chart-wrapper {
      position: relative;
      width: 100%;
    }
    .chart-wrapper.line-chart { height: 240px; }
    .chart-wrapper.bar-chart { height: 280px; }
    .chart-wrapper.pie-chart { height: 220px; max-width: 220px; margin: 0 auto; }
    .chart-wrapper canvas { width: 100% !important; height: 100% !important; }

    .pie-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .pie-section { text-align: center; }
    .pie-section h4 {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }

    /* ── Table ── */
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    th {
      text-align: left;
      padding: 10px 16px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid var(--border);
    }
    td {
      padding: 10px 16px;
      font-size: 14px;
      color: var(--text);
      border-bottom: 1px solid var(--border);
    }
    td.num {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
      text-align: right;
    }
    th:last-child { text-align: right; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg); }

    /* ── Funnel ── */
    .funnel { display: flex; flex-direction: column; gap: 10px; }
    .funnel-step { display: flex; align-items: center; gap: 16px; }
    .funnel-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      min-width: 160px;
      text-align: right;
    }
    .funnel-bar {
      height: 36px;
      background: linear-gradient(90deg, var(--funnel-start), var(--funnel-end));
      border-radius: 6px;
      display: flex;
      align-items: center;
      padding: 0 14px;
      transition: width 0.4s ease;
    }
    .funnel-count {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
    }

    /* ── Empty state ── */
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 180px;
      color: var(--text-muted);
      font-size: 14px;
      font-style: italic;
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      margin-top: 48px;
      padding: 20px 0;
      border-top: 1px solid var(--border);
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .chart-grid { grid-template-columns: 1fr; }
      .pie-row { grid-template-columns: 1fr; }
      .container { padding: 16px; }
      .header { flex-direction: column; gap: 12px; }
      .funnel-label { min-width: 100px; font-size: 12px; }
      .stats-row { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>SpeakUp Analytics</h1>
        <div class="subtitle">Last ${DAYS} days &middot; Updated ${generated} MT</div>
      </div>
      <button class="theme-toggle" onclick="toggleTheme()">
        <span id="theme-icon">&#9789;</span> <span id="theme-label">Light</span>
      </button>
    </div>

    <!-- ── Summary Stats ── -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="label">Page Views</div>
        <div class="value">${traffic.hasData ? traffic.totalViews.toLocaleString() : '--'}</div>
        ${!traffic.hasData ? '<div class="sub">Collecting data...</div>' : '<div class="sub">Last 30 days</div>'}
      </div>
      <div class="stat-card">
        <div class="label">Total Events</div>
        <div class="value">${events.totalEvents.toLocaleString()}</div>
        <div class="sub">User interactions</div>
      </div>
      <div class="stat-card">
        <div class="label">Recording Completion</div>
        <div class="value">${events.recordingsStarted > 0 ? events.recordingRate + '%' : '--'}</div>
        <div class="sub">${events.recordingsStarted > 0 ? events.recordingsCompleted + ' of ' + events.recordingsStarted + ' completed' : 'No recordings yet'}</div>
      </div>
      <div class="stat-card">
        <div class="label">Lesson Completion</div>
        <div class="value">${events.lessonsStarted > 0 ? events.lessonRate + '%' : '--'}</div>
        <div class="sub">${events.lessonsStarted > 0 ? events.lessonsCompleted + ' of ' + events.lessonsStarted + ' completed' : 'No lessons yet'}</div>
      </div>
    </div>

    <!-- ── Traffic ── -->
    <div class="section-header">Traffic</div>

    ${traffic.hasData ? `
    <div class="chart-grid">
      <div class="chart-card">
        <h3>Daily Page Views & Visitors</h3>
        <div class="chart-wrapper line-chart"><canvas id="dailyTraffic"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>Top Pages</h3>
        <div class="chart-wrapper bar-chart"><canvas id="topPages"></canvas></div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <h3>Referrers</h3>
        ${traffic.topReferrers.length > 0
          ? '<div class="chart-wrapper bar-chart"><canvas id="topReferrers"></canvas></div>'
          : emptyState('No external referrers recorded yet')}
      </div>
      <div class="chart-card">
        <h3>Devices & Browsers</h3>
        <div class="pie-row">
          <div class="pie-section">
            <h4>Devices</h4>
            <div class="chart-wrapper pie-chart"><canvas id="devices"></canvas></div>
          </div>
          <div class="pie-section">
            <h4>Browsers</h4>
            <div class="chart-wrapper pie-chart"><canvas id="browsers"></canvas></div>
          </div>
        </div>
      </div>
    </div>

    ${traffic.topCountries.length > 0 ? `
    <div class="chart-grid single">
      <div class="chart-card">
        <h3>Top Countries</h3>
        <div class="chart-wrapper bar-chart"><canvas id="topCountries"></canvas></div>
      </div>
    </div>` : ''}
    ` : `
    <div class="chart-grid single">
      <div class="chart-card">
        ${emptyState('Page view tracking was just enabled. Data will appear within 24 hours.')}
      </div>
    </div>
    `}

    <!-- ── User Behavior ── -->
    <div class="section-header">User Behavior</div>

    ${events.hasData ? `
    <div class="chart-grid single">
      <div class="chart-card">
        <h3>Signup Funnel</h3>
        <div class="funnel">${funnelHTML}</div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <h3>Daily Active Users</h3>
        <div class="chart-wrapper line-chart"><canvas id="dailyDAU"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>Events by Category</h3>
        <div class="chart-wrapper bar-chart"><canvas id="eventCategories"></canvas></div>
      </div>
    </div>

    <div class="chart-grid single">
      <div class="chart-card">
        <h3>Top Events</h3>
        <table>
          <thead><tr><th>Event</th><th>Count</th></tr></thead>
          <tbody>${eventsTableHTML}</tbody>
        </table>
      </div>
    </div>
    ` : `
    <div class="chart-grid single">
      <div class="chart-card">
        ${emptyState('No user behavior events recorded in the last 30 days.')}
      </div>
    </div>
    `}

    <footer>SpeakUp Analytics &middot; Auto-generated ${generated} MT</footer>
  </div>

  <script>
    // ── Theme toggle ──
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('speakup-theme', next);
      document.getElementById('theme-icon').innerHTML = next === 'dark' ? '\\u263D' : '\\u2600';
      document.getElementById('theme-label').textContent = next === 'dark' ? 'Light' : 'Dark';
      updateChartColors(next);
    }

    // Restore saved theme
    (function() {
      const saved = localStorage.getItem('speakup-theme');
      if (saved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        document.getElementById('theme-icon').innerHTML = '\\u2600';
        document.getElementById('theme-label').textContent = 'Dark';
      }
    })();

    // ── Chart.js setup ──
    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

    function getChartColors() {
      return {
        text: isDark() ? '#8b949e' : '#656d76',
        grid: isDark() ? '#21262d' : '#d0d7de',
        blue: isDark() ? '#58a6ff' : '#0969da',
        green: isDark() ? '#3fb950' : '#1a7f37',
        purple: isDark() ? '#bc8cff' : '#8250df',
        orange: isDark() ? '#d29922' : '#bf8700',
        red: isDark() ? '#f85149' : '#cf222e',
        cyan: isDark() ? '#39d2c0' : '#0e8a7e',
        pink: isDark() ? '#f778ba' : '#bf3989',
      };
    }

    const allCharts = [];
    function updateChartColors(theme) {
      const c = getChartColors();
      Chart.defaults.color = c.text;
      Chart.defaults.borderColor = c.grid;
      allCharts.forEach(chart => {
        if (chart.options.scales) {
          Object.values(chart.options.scales).forEach(scale => {
            if (scale.grid) scale.grid.color = c.grid;
            if (scale.ticks) scale.ticks.color = c.text;
          });
        }
        chart.update('none');
      });
    }

    const C = getChartColors();
    Chart.defaults.color = C.text;
    Chart.defaults.borderColor = C.grid;
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.animation.duration = 600;

    const PALETTE = [C.blue, C.green, C.purple, C.orange, C.red, C.cyan, C.pink];

    function baseScales(yTitle) {
      return {
        x: { grid: { color: C.grid, drawBorder: false }, ticks: { color: C.text, maxRotation: 45, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: C.grid, drawBorder: false }, ticks: { color: C.text, font: { size: 11 } }, title: yTitle ? { display: true, text: yTitle, color: C.text, font: { size: 11 } } : undefined },
      };
    }

    ${traffic.hasData ? `
    // ── Daily Traffic ──
    allCharts.push(new Chart(document.getElementById('dailyTraffic'), {
      type: 'line',
      data: {
        labels: ${shortLabels},
        datasets: [
          { label: 'Page Views', data: ${JSON.stringify(traffic.dailyViews)}, borderColor: C.blue, backgroundColor: C.blue + '18', fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 },
          { label: 'Unique Visitors', data: ${JSON.stringify(traffic.dailyVisitors)}, borderColor: C.green, backgroundColor: C.green + '18', fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } } }, scales: baseScales() }
    }));

    // ── Top Pages ──
    allCharts.push(new Chart(document.getElementById('topPages'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(traffic.topPages.map(p => p[0]))},
        datasets: [{ data: ${JSON.stringify(traffic.topPages.map(p => p[1]))}, backgroundColor: C.blue + 'cc', borderRadius: 4, barThickness: 18 }]
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: C.grid }, ticks: { color: C.text } }, y: { grid: { display: false }, ticks: { color: C.text, font: { size: 12 } } } } }
    }));

    ${traffic.topReferrers.length > 0 ? `
    allCharts.push(new Chart(document.getElementById('topReferrers'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(traffic.topReferrers.map(r => r[0]))},
        datasets: [{ data: ${JSON.stringify(traffic.topReferrers.map(r => r[1]))}, backgroundColor: C.purple + 'cc', borderRadius: 4, barThickness: 18 }]
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: C.grid }, ticks: { color: C.text } }, y: { grid: { display: false }, ticks: { color: C.text } } } }
    }));` : ''}

    // ── Devices ──
    ${Object.values(traffic.devices).some(v => v > 0) ? `
    allCharts.push(new Chart(document.getElementById('devices'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(Object.keys(traffic.devices).filter(k => traffic.devices[k] > 0))},
        datasets: [{ data: ${JSON.stringify(Object.entries(traffic.devices).filter(([,v]) => v > 0).map(([,v]) => v))}, backgroundColor: [C.blue, C.green, C.purple], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { size: 11 } } } } }
    }));` : ''}

    // ── Browsers ──
    ${Object.keys(traffic.browsers).length > 0 ? `
    allCharts.push(new Chart(document.getElementById('browsers'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(Object.keys(traffic.browsers))},
        datasets: [{ data: ${JSON.stringify(Object.values(traffic.browsers))}, backgroundColor: PALETTE.slice(0, ${Object.keys(traffic.browsers).length}), borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { size: 11 } } } } }
    }));` : ''}

    ${traffic.topCountries.length > 0 ? `
    allCharts.push(new Chart(document.getElementById('topCountries'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(traffic.topCountries.map(c => c[0]))},
        datasets: [{ data: ${JSON.stringify(traffic.topCountries.map(c => c[1]))}, backgroundColor: C.cyan + 'cc', borderRadius: 4, barThickness: 18 }]
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: C.grid }, ticks: { color: C.text } }, y: { grid: { display: false }, ticks: { color: C.text } } } }
    }));` : ''}
    ` : '// No traffic data yet'}

    ${events.hasData ? `
    // ── Daily Active Users ──
    allCharts.push(new Chart(document.getElementById('dailyDAU'), {
      type: 'line',
      data: {
        labels: ${shortLabels},
        datasets: [{
          label: 'Active Users',
          data: ${JSON.stringify(events.dailyActiveUsers)},
          borderColor: C.green,
          backgroundColor: C.green + '18',
          fill: true, tension: 0.35, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false } }, scales: baseScales('Users') }
    }));

    // ── Event Categories ──
    allCharts.push(new Chart(document.getElementById('eventCategories'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(Object.keys(events.categories).map(fmtEvent))},
        datasets: [{ data: ${JSON.stringify(Object.values(events.categories))}, backgroundColor: PALETTE.slice(0, ${Object.keys(events.categories).length}).map(c => c + 'cc'), borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: baseScales('Events') }
    }));
    ` : '// No event data yet'}
  <\/script>
</body>
</html>`;
}

async function main() {
  console.log('Fetching data from Supabase...');
  const [pageViews, analyticsEvents] = await Promise.all([fetchPageViews(), fetchAnalyticsEvents()]);
  console.log('  page_views:', pageViews.length, 'rows');
  console.log('  analytics_events:', analyticsEvents.length, 'rows');

  const traffic = processPageViews(pageViews);
  const events = processEvents(analyticsEvents);
  const html = generateHTML(traffic, events);

  const outPath = path.join(__dirname, 'index.html');
  fs.writeFileSync(outPath, html);
  console.log('Dashboard written to:', outPath);
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
