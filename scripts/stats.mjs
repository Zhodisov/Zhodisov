// Generates themed stat cards (SVG) for the profile README.
// Runs in GitHub Actions (or locally): STATS_TOKEN or GITHUB_TOKEN, GH_USER.
// No dependencies, Node 20+.
import { mkdirSync, writeFileSync } from "node:fs";

const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
const USER = process.env.GH_USER || "Zhodisov";
const OUT = process.env.OUT_DIR || "dist";
const EXCLUDE = new Set((process.env.EXCLUDE_REPOS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
if (!TOKEN) throw new Error("STATS_TOKEN or GITHUB_TOKEN required");

const C = {
  bg0: "#0D1117", bg1: "#0A0D13", border: "#1B2436", grid: "#161C28",
  title: "#EEF2F8", text: "#9FB0C8", dim: "#5A6B85",
  orange: "#FF6B35", red: "#E63946", amber: "#FF8C42", cyan: "#64D2FF",
};
const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',monospace";

async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (res.ok && !json.errors) return json.data;
    if (attempt === 2) throw new Error(JSON.stringify(json.errors || json));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------- data ----------
async function fetchUser() {
  const d = await gql(`query($login:String!){ user(login:$login){
    login name createdAt
    followers{totalCount} following{totalCount}
    pullRequests{totalCount} issues{totalCount}
    mergedPRs: pullRequests(states:MERGED){totalCount}
    repositoriesContributedTo(contributionTypes:[COMMIT,PULL_REQUEST,ISSUE,REPOSITORY]){totalCount}
    contributionsCollection{ contributionYears }
  }}`, { login: USER });
  return d.user;
}

async function fetchRepos() {
  const repos = [];
  let after = null;
  do {
    const d = await gql(`query($login:String!,$after:String){ user(login:$login){
      repositories(first:100, after:$after, ownerAffiliations:OWNER){
        pageInfo{hasNextPage endCursor}
        nodes{ name isFork isPrivate isArchived stargazerCount forkCount description
          primaryLanguage{name color}
          languages(first:12, orderBy:{field:SIZE,direction:DESC}){ edges{size node{name color}} } }
      }}}`, { login: USER, after });
    const page = d.user.repositories;
    repos.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return repos;
}

async function fetchYear(year) {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
    contributionsCollection(from:$from,to:$to){
      totalCommitContributions restrictedContributionsCount
      totalPullRequestContributions totalIssueContributions totalPullRequestReviewContributions
      totalRepositoryContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }}}`, { login: USER, from, to });
  return d.user.contributionsCollection;
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "k" : n.toLocaleString("en-US"));
const fmtDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function frame(w, h, title, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img" aria-label="${esc(label || title)}">
  <style>
    .f{opacity:0;animation:in .6s ease-out forwards}
    @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    .g{transform-box:fill-box;transform-origin:left;animation:grow 1s cubic-bezier(.2,.8,.2,1) forwards;transform:scaleX(0)}
    @keyframes grow{to{transform:scaleX(1)}}
    .u{transform-box:fill-box;transform-origin:bottom;animation:up .9s cubic-bezier(.2,.8,.2,1) forwards;transform:scaleY(0)}
    @keyframes up{to{transform:scaleY(1)}}
    @media (prefers-reduced-motion:reduce){.f,.g,.u{animation:none;opacity:1;transform:none}}
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.orange}"/><stop offset="1" stop-color="${C.red}"/></linearGradient>
    <linearGradient id="accv" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.red}"/><stop offset="1" stop-color="${C.orange}"/></linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="url(#bg)" stroke="${C.border}"/>
  <text x="28" y="42" font-family="${SANS}" font-size="18" font-weight="700" fill="${C.title}">${esc(title)}</text>
  <rect x="28" y="52" width="40" height="3" rx="1.5" fill="url(#acc)"/>
${body}
</svg>
`;
}

// Inline 16px glyphs drawn with simple paths.
const ICON = {
  commit: `<circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M0 8h5M11 8h5" stroke="currentColor" stroke-width="1.6"/>`,
  star: `<path d="M8 1.5l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.1 4.1 13.3 5 9 1.7 6l4.4-.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  repo: `<path d="M3 2.5h8.5a1 1 0 011 1V13H4a1 1 0 01-1-1zM3 11.5a1 1 0 011-1h8.5" stroke="currentColor" stroke-width="1.4"/>`,
  lock: `<rect x="3" y="7" width="10" height="7" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.4"/>`,
  fork: `<circle cx="4" cy="3" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="3" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="13" r="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M4 4.6v1.4a2 2 0 002 2h4a2 2 0 002-2V4.6M8 8v3.4" stroke="currentColor" stroke-width="1.4"/>`,
  people: `<circle cx="6" cy="5" r="2.6" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 14c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5M11 2.8a2.4 2.4 0 010 4.6M12.5 9.8c1.3.6 2 1.9 2 4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  pr: `<circle cx="4" cy="3" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="4" cy="13" r="1.6" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="13" r="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M4 4.6v6.8M12 11.4V6a2 2 0 00-2-2H7m1.5-1.8L6.6 4l1.9 1.8" stroke="currentColor" stroke-width="1.4"/>`,
  issue: `<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/>`,
  pulse: `<path d="M1 8.5h3l2-5 3.5 9 2-4H15" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  cal: `<rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.4"/>`,
  flame: `<path d="M8 1.5c.5 2.5 4.5 4 4.5 8a4.5 4.5 0 01-9 0c0-2 1-3.2 2-4 .2 1.3.8 2 1.5 2.3C7 5.5 7.3 3.3 8 1.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  trophy: `<path d="M4.5 2h7v4a3.5 3.5 0 01-7 0zM4.5 3.5H2v1a2.5 2.5 0 002.6 2.5M11.5 3.5H14v1a2.5 2.5 0 01-2.6 2.5M8 9.5V12M5 14h6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  eye: `<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/>`,
};
const icon = (name, x, y, color) => `<g transform="translate(${x} ${y})" color="${color}">${ICON[name]}</g>`;

// ---------- cards ----------
function overviewCard(s) {
  const tiles = [
    ["pulse", "Contributions", s.totalContrib, C.orange],
    ["commit", "Commits", s.commits, C.orange],
    ["repo", "Public repos", s.publicRepos, C.cyan],
    ["lock", "Private repos", s.privateRepos, C.cyan],
    ["star", "Stars earned", s.stars, C.amber],
    ["fork", "Forks", s.forks, C.amber],
    ["people", "Followers", s.followers, C.red],
    ["pr", "Pull requests", s.prs, C.red],
  ];
  const cols = 4, tw = 224, th = 84, gap = 12, x0 = 28, y0 = 76;
  const body = tiles.map(([ic, label, val, col], i) => {
    const x = x0 + (i % cols) * (tw + gap), y = y0 + Math.floor(i / cols) * (th + gap);
    return `  <g class="f" style="animation-delay:${i * 70}ms">
    <rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="10" fill="#0F1520" stroke="${C.grid}"/>
    ${icon(ic, x + 18, y + 18, col)}
    <text x="${x + 42}" y="${y + 30}" font-family="${SANS}" font-size="13" fill="${C.text}">${label}</text>
    <text x="${x + 18}" y="${y + 66}" font-family="${SANS}" font-size="28" font-weight="700" fill="${C.title}">${fmt(val)}</text>
  </g>`;
  }).join("\n");
  const foot = `  <text class="f" style="animation-delay:600ms" x="28" y="294" font-family="${SANS}" font-size="12.5" fill="${C.dim}">On GitHub since ${fmtDate(s.createdAt.slice(0, 10))} · ${s.years} years · ${fmt(s.issues)} issues · ${fmt(s.mergedPRs)} merged PRs · ${fmt(s.reviews)} reviews · ${fmt(s.contributedTo)} repos contributed to · following ${fmt(s.following)}</text>`;
  return frame(1000, 316, "Overview", body + "\n" + foot, "GitHub overview statistics");
}

function streakCard(s) {
  const cols = [
    { x: 167, big: fmt(s.totalContrib), label: "Total contributions", sub: `${fmtDate(s.firstDay)} – Present`, col: C.text },
    { x: 500, big: fmt(s.current.len), label: "Current streak", sub: s.current.len ? `${fmtDate(s.current.start)} – ${fmtDate(s.current.end)}` : "Start one today", col: C.orange, ring: true },
    { x: 833, big: fmt(s.longest.len), label: "Longest streak", sub: s.longest.len ? `${fmtDate(s.longest.start)} – ${fmtDate(s.longest.end)}` : "—", col: C.text },
  ];
  const body = cols.map((c, i) => {
    const ring = c.ring
      ? `<circle cx="${c.x}" cy="118" r="46" stroke="${C.grid}" stroke-width="5"/>
    <circle cx="${c.x}" cy="118" r="46" stroke="url(#acc)" stroke-width="5" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 ${c.x} 118)"><animate attributeName="stroke-dashoffset" from="289" to="0" dur="1.2s" fill="freeze"/></circle>
    ${icon("flame", c.x - 8, 56, C.orange)}`
      : "";
    return `  <g class="f" style="animation-delay:${i * 120}ms" text-anchor="middle">
    ${ring}
    <text x="${c.x}" y="130" font-family="${SANS}" font-size="32" font-weight="700" fill="${C.title}">${c.big}</text>
    <text x="${c.x}" y="196" font-family="${SANS}" font-size="15" font-weight="600" fill="${c.col}">${c.label}</text>
    <text x="${c.x}" y="218" font-family="${SANS}" font-size="12" fill="${C.dim}">${c.sub}</text>
  </g>`;
  }).join("\n");
  const div = `  <line x1="333" y1="80" x2="333" y2="220" stroke="${C.grid}"/><line x1="666" y1="80" x2="666" y2="220" stroke="${C.grid}"/>`;
  return frame(1000, 246, "Streak", div + "\n" + body, `Current streak ${s.current.len} days, longest ${s.longest.len} days`);
}

function languagesCard(langs, totalRepos) {
  const top = langs.slice(0, 8);
  const W = 490, bx = 28, bw = W - 56;
  let acc = 0;
  const bar = top.map((l, i) => {
    const w = Math.max(2, (l.pct / 100) * bw), x = bx + acc;
    acc += (l.pct / 100) * bw;
    return `<rect class="g" style="animation-delay:${i * 60}ms" x="${x.toFixed(1)}" y="74" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
  }).join("");
  const list = top.map((l, i) => {
    const x = 28 + (i % 2) * 222, y = 118 + Math.floor(i / 2) * 30;
    return `  <g class="f" style="animation-delay:${200 + i * 60}ms">
    <circle cx="${x + 6}" cy="${y - 4}" r="5" fill="${l.color}"/>
    <text x="${x + 20}" y="${y}" font-family="${SANS}" font-size="13.5" fill="${C.title}">${esc(l.name)}</text>
    <text x="${x + 196}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="12" fill="${C.text}">${l.pct.toFixed(1)}%</text>
  </g>`;
  }).join("\n");
  const body = `  <clipPath id="bar"><rect x="${bx}" y="74" width="${bw}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)"><rect x="${bx}" y="74" width="${bw}" height="10" fill="${C.grid}"/>${bar}</g>
${list}
  <text x="28" y="${118 + 4 * 30 + 6}" font-family="${SANS}" font-size="12" fill="${C.dim}">By code size across ${totalRepos} repositories (forks excluded)</text>`;
  return frame(W, 270, "Top languages", body, "Top languages: " + top.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(", "));
}

function weekdayCard(days) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sums = Array(7).fill(0);
  for (const d of days) sums[new Date(d.date + "T00:00:00Z").getUTCDay()] += d.contributionCount;
  const max = Math.max(1, ...sums), best = sums.indexOf(max);
  const W = 490, x0 = 40, bw = 40, gap = (W - 80 - 7 * bw) / 6, base = 214, hmax = 120;
  const bars = sums.map((v, i) => {
    const h = Math.max(3, (v / max) * hmax), x = x0 + i * (bw + gap);
    const fill = i === best ? "url(#accv)" : "#233046";
    return `  <rect class="u" style="animation-delay:${i * 60}ms" x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="5" fill="${fill}"/>
  <text x="${x + bw / 2}" y="${base - h - 8}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${i === best ? C.orange : C.text}">${fmt(v)}</text>
  <text x="${x + bw / 2}" y="${base + 20}" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${C.dim}">${names[i]}</text>`;
  }).join("\n");
  return frame(W, 270, "Contributions by weekday", bars, `Most active on ${names[best]}`);
}

function yearsCard(perYear, monthly) {
  // Left: per-year bars. Right: last 12 months area chart.
  const years = Object.keys(perYear).sort();
  const maxY = Math.max(1, ...years.map((y) => perYear[y]));
  const yb = years.map((y, i) => {
    const w = Math.max(3, (perYear[y] / maxY) * 300), yy = 92 + i * 34;
    return `  <g class="f" style="animation-delay:${i * 80}ms">
    <text x="28" y="${yy + 13}" font-family="${MONO}" font-size="13" fill="${C.text}">${y}</text>
    <rect x="80" y="${yy}" width="300" height="18" rx="5" fill="#111824"/>
    <rect class="g" style="animation-delay:${i * 80}ms" x="80" y="${yy}" width="${w.toFixed(1)}" height="18" rx="5" fill="url(#acc)"/>
    <text x="390" y="${yy + 13}" font-family="${SANS}" font-size="13" font-weight="600" fill="${C.title}">${fmt(perYear[y])}</text>
  </g>`;
  }).join("\n");

  const cx0 = 480, cw = 492, cy0 = 92, ch = 118;
  const maxM = Math.max(1, ...monthly.map((m) => m.v));
  const pts = monthly.map((m, i) => [cx0 + (i / (monthly.length - 1)) * cw, cy0 + ch - (m.v / maxM) * ch]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${cx0 + cw} ${cy0 + ch} L${cx0} ${cy0 + ch} Z`;
  const len = Math.ceil(pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0));
  const grid = [0, 0.5, 1].map((t) => `<line x1="${cx0}" y1="${cy0 + ch * t}" x2="${cx0 + cw}" y2="${cy0 + ch * t}" stroke="${C.grid}" stroke-dasharray="3 4"/>`).join("");
  const labels = monthly.map((m, i) => (i % 2 === 0 || i === monthly.length - 1)
    ? `<text x="${pts[i][0].toFixed(1)}" y="${cy0 + ch + 20}" text-anchor="middle" font-family="${SANS}" font-size="11" fill="${C.dim}">${m.label}</text>` : "").join("");
  const peak = monthly.reduce((a, m, i) => (m.v > monthly[a].v ? i : a), 0);
  const chart = `  <text x="${cx0}" y="78" font-family="${SANS}" font-size="12.5" fill="${C.text}">Last 12 months</text>
  <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.orange}" stop-opacity=".35"/><stop offset="1" stop-color="${C.orange}" stop-opacity="0"/></linearGradient></defs>
  ${grid}
  <path class="f" style="animation-delay:500ms" d="${area}" fill="url(#area)"/>
  <path d="${line}" stroke="${C.orange}" stroke-width="2.2" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len}"><animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="1.4s" fill="freeze"/></path>
  <circle class="f" style="animation-delay:1200ms" cx="${pts[peak][0].toFixed(1)}" cy="${pts[peak][1].toFixed(1)}" r="4" fill="${C.orange}" stroke="${C.bg0}" stroke-width="2"/>
  <text class="f" style="animation-delay:1200ms" x="${pts[peak][0].toFixed(1)}" y="${(pts[peak][1] - 10).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${C.title}">${fmt(monthly[peak].v)}</text>
  ${labels}`;
  const h = Math.max(256, 92 + years.length * 34 + 20);
  return frame(1000, h, "Contributions per year", yb + "\n" + chart, "Contributions per year: " + years.map((y) => `${y}: ${perYear[y]}`).join(", "));
}

function reposCard(repos) {
  const top = repos.slice(0, 5);
  const W = 1000;
  const rows = top.map((r, i) => {
    const y = 80 + i * 44;
    const lang = r.primaryLanguage;
    return `  <g class="f" style="animation-delay:${i * 80}ms">
    <rect x="28" y="${y}" width="${W - 56}" height="36" rx="8" fill="#0F1520" stroke="${C.grid}"/>
    ${icon("repo", 42, y + 10, C.cyan)}
    <text x="66" y="${y + 23}" font-family="${SANS}" font-size="14" font-weight="600" fill="${C.title}">${esc(trunc(r.name, 34))}</text>
    <text x="330" y="${y + 23}" font-family="${SANS}" font-size="12.5" fill="${C.dim}">${esc(trunc(r.description || "", 62))}</text>
    ${lang ? `<circle cx="${W - 240}" cy="${y + 18}" r="5" fill="${lang.color || C.text}"/><text x="${W - 230}" y="${y + 23}" font-family="${SANS}" font-size="12.5" fill="${C.text}">${esc(trunc(lang.name, 12))}</text>` : ""}
    ${icon("star", W - 140, y + 10, C.amber)}<text x="${W - 120}" y="${y + 23}" font-family="${MONO}" font-size="12.5" fill="${C.title}">${fmt(r.stargazerCount)}</text>
    ${icon("fork", W - 84, y + 10, C.text)}<text x="${W - 64}" y="${y + 23}" font-family="${MONO}" font-size="12.5" fill="${C.title}">${fmt(r.forkCount)}</text>
  </g>`;
  }).join("\n");
  return frame(W, 80 + top.length * 44 + 14, "Most starred repositories", rows, "Most starred repositories: " + top.map((r) => r.name).join(", "));
}

// ---------- main ----------
function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  const list = days.filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let longest = { len: 0 }, run = { len: 0 };
  for (const d of list) {
    if (d.contributionCount > 0) {
      run = run.len ? { ...run, len: run.len + 1, end: d.date } : { len: 1, start: d.date, end: d.date };
      if (run.len > longest.len) longest = { ...run };
    } else run = { len: 0 };
  }
  // Today without contributions does not break the current streak yet.
  let current = { len: 0 };
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    if (d.contributionCount > 0) current = current.len ? { ...current, len: current.len + 1, start: d.date } : { len: 1, start: d.date, end: d.date };
    else if (i === list.length - 1 && d.date === today) continue;
    else break;
  }
  return { longest, current };
}

const user = await fetchUser();
const [repos, yearData] = await Promise.all([
  fetchRepos(),
  Promise.all(user.contributionsCollection.contributionYears.map(async (y) => [y, await fetchYear(y)])),
]);

const own = repos.filter((r) => !r.isFork && !EXCLUDE.has(r.name.toLowerCase()));
const langBytes = new Map();
for (const r of own) for (const e of r.languages.edges) {
  const cur = langBytes.get(e.node.name) || { name: e.node.name, color: e.node.color || C.text, size: 0 };
  cur.size += e.size;
  langBytes.set(e.node.name, cur);
}
const langTotal = [...langBytes.values()].reduce((a, l) => a + l.size, 0) || 1;
const langs = [...langBytes.values()].sort((a, b) => b.size - a.size).map((l) => ({ ...l, pct: (l.size / langTotal) * 100 }));

const days = yearData.flatMap(([, c]) => c.contributionCalendar.weeks.flatMap((w) => w.contributionDays));
const perYear = Object.fromEntries(yearData.map(([y, c]) => [y, c.contributionCalendar.totalContributions]));
const sum = (k) => yearData.reduce((a, [, c]) => a + c[k], 0);
const firstActive = days.filter((d) => d.contributionCount > 0).map((d) => d.date).sort()[0] || user.createdAt.slice(0, 10);

const monthly = [];
const now = new Date();
for (let i = 11; i >= 0; i--) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
  const key = d.toISOString().slice(0, 7);
  monthly.push({ key, label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), v: 0 });
}
for (const d of days) { const m = monthly.find((x) => x.key === d.date.slice(0, 7)); if (m) m.v += d.contributionCount; }

const stats = {
  createdAt: user.createdAt,
  years: Math.max(1, Math.floor((Date.now() - new Date(user.createdAt)) / 3.15576e10)),
  totalContrib: Object.values(perYear).reduce((a, b) => a + b, 0),
  // Private contributions are only exposed as an aggregate; count them with commits.
  commits: sum("totalCommitContributions") + sum("restrictedContributionsCount"),
  publicRepos: repos.filter((r) => !r.isPrivate).length,
  privateRepos: repos.filter((r) => r.isPrivate).length,
  stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
  forks: repos.reduce((a, r) => a + r.forkCount, 0),
  followers: user.followers.totalCount,
  following: user.following.totalCount,
  prs: user.pullRequests.totalCount,
  mergedPRs: user.mergedPRs.totalCount,
  issues: user.issues.totalCount,
  reviews: sum("totalPullRequestReviewContributions"),
  contributedTo: user.repositoriesContributedTo.totalCount,
  firstDay: firstActive,
  ...streaks(days),
};

const topRepos = repos.filter((r) => !r.isPrivate && !r.isFork && !EXCLUDE.has(r.name.toLowerCase()) && r.name.toLowerCase() !== USER.toLowerCase())
  .sort((a, b) => b.stargazerCount - a.stargazerCount || b.forkCount - a.forkCount);

mkdirSync(OUT, { recursive: true });
const files = {
  "stats-overview.svg": overviewCard(stats),
  "stats-streak.svg": streakCard(stats),
  "stats-languages.svg": languagesCard(langs, own.length),
  "stats-weekday.svg": weekdayCard(days),
  "stats-years.svg": yearsCard(perYear, monthly),
  "stats-repos.svg": reposCard(topRepos),
};
for (const [name, svg] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, svg);
console.log(`Wrote ${Object.keys(files).length} cards to ${OUT}/`, { ...stats, current: stats.current.len, longest: stats.longest.len });
