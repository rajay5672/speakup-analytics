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

  const allDays = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    allDays.push(d.toISOString().slice(0, 10));
  }

  return {
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

  const allDays = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    allDays.push(d.toISOString().slice(0, 10));
  }

  return {
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

function generateHTML(traffic, events) {
  const generated = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SpeakUp Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 { font-size: 28px; margin-bottom: 4px; color: #fff; }
    .subtitle { color: #8b949e; margin-bottom: 32px; font-size: 14px; }
    h2 { font-size: 18px; color: #c9d1d9; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #21262d; }
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
    .stat-card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #fff; margin-top: 4px; }
    .stat-card .sub { font-size: 12px; color: #8b949e; margin-top: 2px; }
    .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .chart-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
    .chart-card h3 { font-size: 14px; color: #c9d1d9; margin-bottom: 12px; }
    canvas { width: 100% !important; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; font-size: 13px; }
    th { color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { color: #c9d1d9; }
    .funnel { display: flex; flex-direction: column; gap: 8px; }
    .funnel-step { display: flex; align-items: center; gap: 12px; }
    .funnel-bar { height: 32px; background: linear-gradient(90deg, #238636, #2ea043); border-radius: 4px; display: flex; align-items: center; padding: 0 12px; font-size: 13px; font-weight: 600; color: #fff; min-width: 40px; }
    .funnel-label { font-size: 13px; color: #8b949e; min-width: 140px; }
    footer { text-align: center; color: #484f58; font-size: 12px; margin-top: 48px; padding: 16px 0; border-top: 1px solid #21262d; }
    @media (max-width: 600px) { .chart-grid { grid-template-columns: 1fr; } body { padding: 12px; } }
  </style>
</head>
<body>
  <h1>SpeakUp Analytics</h1>
  <p class="subtitle">Last ${DAYS} days &middot; Generated ${generated} MT</p>

  <div class="stats-row">
    <div class="stat-card"><div class="label">Total Page Views</div><div class="value">${traffic.totalViews.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Avg Daily Views</div><div class="value">${Math.round(traffic.totalViews / DAYS).toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Recording Completion</div><div class="value">${events.recordingRate}%</div><div class="sub">${events.recordingsCompleted} / ${events.recordingsStarted}</div></div>
    <div class="stat-card"><div class="label">Lesson Completion</div><div class="value">${events.lessonRate}%</div><div class="sub">${events.lessonsCompleted} / ${events.lessonsStarted}</div></div>
  </div>

  <h2>Traffic</h2>
  <div class="chart-grid">
    <div class="chart-card"><h3>Daily Page Views &amp; Visitors</h3><canvas id="dailyTraffic"></canvas></div>
    <div class="chart-card"><h3>Top Pages</h3><canvas id="topPages"></canvas></div>
  </div>
  <div class="chart-grid">
    <div class="chart-card"><h3>Top Referrers</h3>${traffic.topReferrers.length > 0 ? '<canvas id="topReferrers"></canvas>' : '<p style="color:#484f58;font-size:13px;padding:24px 0;">No external referrers yet</p>'}</div>
    <div class="chart-card"><h3>Devices &amp; Browsers</h3><div style="display:flex;gap:16px;"><div style="flex:1;"><canvas id="devices"></canvas></div><div style="flex:1;"><canvas id="browsers"></canvas></div></div></div>
  </div>
  ${traffic.topCountries.length > 0 ? '<div class="chart-grid"><div class="chart-card"><h3>Top Countries</h3><canvas id="topCountries"></canvas></div><div class="chart-card"></div></div>' : ''}

  <h2>User Behavior</h2>
  <div class="chart-card" style="margin-bottom:16px;">
    <h3>Signup Funnel</h3>
    <div class="funnel">
      ${[['Landing Page', events.funnel.landing], ['Signup Page', events.funnel.signupPage], ['Signup Complete', events.funnel.signupComplete], ['Onboarding Complete', events.funnel.onboardingComplete]]
        .map(([label, count]) => {
          const max = Math.max(events.funnel.landing, 1);
          const pct = Math.max((count / max) * 100, 5);
          return '<div class="funnel-step"><span class="funnel-label">' + label + '</span><div class="funnel-bar" style="width:' + pct + '%">' + count + '</div></div>';
        }).join('')}
    </div>
  </div>
  <div class="chart-grid">
    <div class="chart-card"><h3>Daily Active Users</h3><canvas id="dailyDAU"></canvas></div>
    <div class="chart-card"><h3>Events by Category</h3><canvas id="eventCategories"></canvas></div>
  </div>
  <div class="chart-card" style="margin-top:16px;">
    <h3>Top Events</h3>
    <table><thead><tr><th>Event</th><th>Count</th></tr></thead><tbody>
      ${events.topEvents.map(([name, count]) => '<tr><td>' + name + '</td><td>' + count + '</td></tr>').join('')}
    </tbody></table>
  </div>

  <footer>SpeakUp Analytics Dashboard &middot; Auto-generated ${generated} MT</footer>

  <script>
    const COLORS = { blue: '#58a6ff', green: '#3fb950', purple: '#bc8cff', orange: '#d29922', red: '#f85149', cyan: '#39d2c0', pink: '#f778ba' };
    const PALETTE = [COLORS.blue, COLORS.green, COLORS.purple, COLORS.orange, COLORS.red, COLORS.cyan, COLORS.pink];
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#21262d';
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    new Chart(document.getElementById('dailyTraffic'), {
      type: 'line',
      data: { labels: ${JSON.stringify(traffic.dailyLabels.map(d => d.slice(5)))}, datasets: [
        { label: 'Page Views', data: ${JSON.stringify(traffic.dailyViews)}, borderColor: COLORS.blue, backgroundColor: 'rgba(88,166,255,0.1)', fill: true, tension: 0.3 },
        { label: 'Unique Visitors', data: ${JSON.stringify(traffic.dailyVisitors)}, borderColor: COLORS.green, backgroundColor: 'rgba(63,185,80,0.1)', fill: true, tension: 0.3 }
      ]},
      options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('topPages'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(traffic.topPages.map(p => p[0]))}, datasets: [{ label: 'Views', data: ${JSON.stringify(traffic.topPages.map(p => p[1]))}, backgroundColor: COLORS.blue }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
    });

    ${traffic.topReferrers.length > 0 ? `new Chart(document.getElementById('topReferrers'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(traffic.topReferrers.map(r => r[0]))}, datasets: [{ label: 'Visits', data: ${JSON.stringify(traffic.topReferrers.map(r => r[1]))}, backgroundColor: COLORS.purple }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
    });` : ''}

    new Chart(document.getElementById('devices'), {
      type: 'doughnut',
      data: { labels: ${JSON.stringify(Object.keys(traffic.devices))}, datasets: [{ data: ${JSON.stringify(Object.values(traffic.devices))}, backgroundColor: [COLORS.blue, COLORS.green, COLORS.purple] }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Devices' } } }
    });

    new Chart(document.getElementById('browsers'), {
      type: 'doughnut',
      data: { labels: ${JSON.stringify(Object.keys(traffic.browsers))}, datasets: [{ data: ${JSON.stringify(Object.values(traffic.browsers))}, backgroundColor: PALETTE.slice(0, ${Object.keys(traffic.browsers).length}) }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Browsers' } } }
    });

    ${traffic.topCountries.length > 0 ? `new Chart(document.getElementById('topCountries'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(traffic.topCountries.map(c => c[0]))}, datasets: [{ label: 'Views', data: ${JSON.stringify(traffic.topCountries.map(c => c[1]))}, backgroundColor: COLORS.cyan }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
    });` : ''}

    new Chart(document.getElementById('dailyDAU'), {
      type: 'line',
      data: { labels: ${JSON.stringify(events.dailyLabels.map(d => d.slice(5)))}, datasets: [{ label: 'Active Users', data: ${JSON.stringify(events.dailyActiveUsers)}, borderColor: COLORS.green, backgroundColor: 'rgba(63,185,80,0.1)', fill: true, tension: 0.3 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    new Chart(document.getElementById('eventCategories'), {
      type: 'bar',
      data: { labels: ${JSON.stringify(Object.keys(events.categories))}, datasets: [{ label: 'Events', data: ${JSON.stringify(Object.values(events.categories))}, backgroundColor: PALETTE.slice(0, ${Object.keys(events.categories).length}) }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
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
