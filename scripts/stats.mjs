// Generates the profile README cards (SVG): activity + projects.
// Runs in GitHub Actions (or locally): STATS_TOKEN or GITHUB_TOKEN, GH_USER.
// No dependencies, Node 20+.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
const USER = process.env.GH_USER || "Zhodisov";
const OUT = process.env.OUT_DIR || "dist";
const list = (v) => new Set((v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
const EXCLUDE = list(process.env.EXCLUDE_REPOS);
// Repos kept in the stats but not listed in the projects table.
const HIDE = list(process.env.HIDE_PROJECTS);
// Repos forced to the top of the projects table, in this order.
// Own commit emails not linked to the GitHub account: GitHub credits them to no one.
const EXTRA_EMAILS = (process.env.EXTRA_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
const PIN = (process.env.PIN_PROJECTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!TOKEN) throw new Error("STATS_TOKEN or GITHUB_TOKEN required");

// Featured project: shown on top of the projects card, commits summed over its repos.
const FEATURED = {
  title: "Lushvae.xyz",
  url: "lushvae.xyz",
  desc: "Transformice menu · Free & paid plans (Core, Flow, Apex)",
  repos: ["Lushvae-private", "Lushvae"],
  // Site logo (lushvae.xyz/public/site/img/logo.svg), 100x100 viewBox.
  logo: `<path d="M50 4C80 20 95 50 81 76C70 95 38 99 22 84C6 69 10 38 50 4Z" fill="#F4F4F5"/>
    <path d="M47 24L42 72L70 67" fill="none" stroke="#0B0B0C" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M42 50L30 42M44 38L56 30" fill="none" stroke="#0B0B0C" stroke-width="3" stroke-linecap="round" opacity=".85"/>`,
};

const C = {
  bg: "#0B0E14", line: "#1B2436", faint: "#131A26",
  title: "#E6EDF3", text: "#9FB0C8", dim: "#5A6B85", mute: "#394A66",
  orange: "#FF6B35", cyan: "#64D2FF",
  heat: ["#141A24", "#3B2A1A", "#7A3F22", "#D35A2E", "#FF6B35"],
};
const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',monospace";

async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
      body: JSON.stringify({ query, variables }),
    });
    // Heavy queries sometimes time out with an HTML 502 page.
    const json = await res.json().catch(() => ({ errors: [`HTTP ${res.status}`] }));
    if (res.ok && !json.errors) return json.data;
    if (attempt === 3) throw new Error(JSON.stringify(json.errors || json));
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---------- data ----------
async function fetchUser() {
  const d = await gql(`query($login:String!){ user(login:$login){
    id createdAt followers{totalCount}
    contributionsCollection{ contributionYears }
  }}`, { login: USER });
  return d.user;
}

async function fetchRepos(uid) {
  const repos = [];
  const extraHistory = EXTRA_EMAILS.map((e, i) => `e${i}:history(first:1, author:{emails:${JSON.stringify([e])}}){ totalCount nodes{ author{ user{ login } } } }`).join(" ");
  let after = null;
  do {
    const d = await gql(`query($login:String!,$after:String,$uid:ID!){ user(login:$login){
      repositories(first:20, after:$after, ownerAffiliations:OWNER){
        pageInfo{hasNextPage endCursor}
        nodes{ name description isFork isPrivate stargazerCount forkCount pushedAt
          primaryLanguage{name color}
          languages(first:12, orderBy:{field:SIZE,direction:DESC}){ edges{size node{name color}} }
          defaultBranchRef{ target{ ... on Commit{ history(author:{id:$uid}){ totalCount } ${extraHistory} } } } }
      }}}`, { login: USER, after, uid });
    const page = d.user.repositories;
    repos.push(...page.nodes.map((r) => {
      const target = r.defaultBranchRef?.target;
      // Skip an email once it is linked: its commits are already in the author count.
      const extra = EXTRA_EMAILS.reduce((a, _, i) => a + (target?.[`e${i}`]?.nodes[0]?.author?.user ? 0 : target?.[`e${i}`]?.totalCount || 0), 0);
      return { ...r, extraCommits: extra, commits: (target?.history?.totalCount || 0) + extra };
    }));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return repos;
}

async function fetchYear(year) {
  const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
    contributionsCollection(from:$from,to:$to){
      totalCommitContributions restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }}}`, { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` });
  return d.user.contributionsCollection;
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => n.toLocaleString("en-US");
const monthYear = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const text = (x, y, s, { size = 13, fill = C.text, font = MONO, anchor = "start", weight = 400, spacing = 0 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}" font-weight="${weight}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${spacing ? ` letter-spacing="${spacing}"` : ""}>${s}</text>`;
const label = (x, y, s) => text(x, y, esc(s), { size: 11, fill: C.dim, spacing: 2.5 });

function svg(w, h, aria, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img" aria-label="${esc(aria)}">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.bg}" stroke="${C.line}"/>
${body}
</svg>
`;
}

// ---------- cards ----------
function activityCard(s) {
  const W = 1000;
  const parts = [label(32, 44, "ACTIVITY")];

  // Left: key / value list.
  const rows = [
    ["contributions", fmt(s.totalContrib)],
    ["commits", fmt(s.commits)],
    ["repositories", `${fmt(s.publicRepos)} public · ${fmt(s.privateRepos)} private`],
    ["current streak", `${s.current.len} days`],
    ["longest streak", `${s.longest.len} days`],
    ["best day", `${fmt(s.best.count)} on ${dayMonth(s.best.date)}`],
    ["most active", s.topWeekday],
    ["stars · followers", `${fmt(s.stars)} · ${fmt(s.followers)}`],
    ["member since", monthYear(s.createdAt)],
  ];
  rows.forEach(([k, v], i) => {
    const y = 84 + i * 26;
    parts.push(text(32, y, esc(k), { fill: C.dim }));
    parts.push(text(352, y, esc(v), { fill: C.title, anchor: "end" }));
  });
  parts.push(`<line x1="392" y1="64" x2="392" y2="300" stroke="${C.line}"/>`);

  // Right: last 53 weeks heatmap.
  const hx = 424, hy = 84, cell = 8, gap = 2, step = cell + gap;
  const weeks = s.lastWeeks;
  const max = Math.max(1, ...weeks.flat().map((d) => d.contributionCount));
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  let lastMonth = "";
  weeks.forEach((week, wi) => {
    const m = week[0].date.slice(5, 7);
    if (m !== lastMonth && wi < weeks.length - 2) {
      if (lastMonth) parts.push(text(hx + wi * step, hy - 8, monthYear(week[0].date + "T00:00:00Z").slice(0, 3), { size: 10, fill: C.dim }));
      lastMonth = m;
    }
    week.forEach((d) => {
      const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
      parts.push(`<rect x="${hx + wi * step}" y="${hy + dow * step}" width="${cell}" height="${cell}" rx="2" fill="${C.heat[level(d.contributionCount)]}"><title>${d.date}: ${d.contributionCount}</title></rect>`);
    });
  });
  const hBottom = hy + 7 * step;
  parts.push(text(hx, hBottom + 20, `${fmt(s.lastYearTotal)} contributions in the last year`, { size: 11, fill: C.dim }));
  const legendX = 968 - 32 - 5 * step;
  parts.push(text(legendX - 8, hBottom + 20, "less", { size: 10, fill: C.dim, anchor: "end" }));
  C.heat.forEach((c, i) => parts.push(`<rect x="${legendX + i * step}" y="${hBottom + 12}" width="${cell}" height="${cell}" rx="2" fill="${c}"/>`));
  parts.push(text(legendX + 5 * step + 4, hBottom + 20, "more", { size: 10, fill: C.dim }));

  // Right, below: contributions per year.
  const years = Object.keys(s.perYear).sort();
  const maxY = Math.max(...years.map((y) => s.perYear[y]));
  years.forEach((y, i) => {
    const yy = hBottom + 52 + i * 22, w = Math.max(2, (s.perYear[y] / maxY) * 400);
    parts.push(text(hx, yy + 4, y, { size: 12, fill: C.dim }));
    parts.push(`<rect x="${hx + 48}" y="${yy - 4}" width="${w.toFixed(1)}" height="6" rx="3" fill="${C.orange}" opacity="${0.45 + 0.55 * (s.perYear[y] / maxY)}"/>`);
    parts.push(text(968, yy + 4, fmt(s.perYear[y]), { size: 12, fill: C.title, anchor: "end" }));
  });

  // Bottom: languages.
  const ly = Math.max(316, hBottom + 52 + years.length * 22 + 8);
  parts.push(`<line x1="32" y1="${ly}" x2="968" y2="${ly}" stroke="${C.line}"/>`);
  parts.push(label(32, ly + 34, "LANGUAGES"));
  const top = s.langs.slice(0, 5);
  const other = Math.max(0, 100 - top.reduce((a, l) => a + l.pct, 0));
  const segs = [...top, { name: "Other", pct: other, color: C.mute }];
  const bx = 160, bw = 808;
  let acc = 0;
  parts.push(`<clipPath id="lb"><rect x="${bx}" y="${ly + 26}" width="${bw}" height="8" rx="4"/></clipPath><g clip-path="url(#lb)">`);
  for (const l of segs) {
    parts.push(`<rect x="${(bx + acc).toFixed(1)}" y="${ly + 26}" width="${((l.pct / 100) * bw + 0.5).toFixed(1)}" height="8" fill="${l.color}"/>`);
    acc += (l.pct / 100) * bw;
  }
  parts.push(`</g>`);
  let lx = bx;
  for (const l of segs) {
    parts.push(`<circle cx="${lx + 4}" cy="${ly + 58}" r="4" fill="${l.color}"/>`);
    const t = `${l.name} ${l.pct.toFixed(1)}%`;
    parts.push(text(lx + 14, ly + 62, esc(t), { size: 11.5, fill: C.text }));
    lx += 14 + t.length * 7.2 + 20;
  }
  return svg(W, ly + 84, `Activity: ${s.totalContrib} contributions, ${s.commits} commits`, parts.join("\n  "));
}

function projectsCard(featured, top) {
  const W = 1000;
  const parts = [label(32, 44, "PROJECTS")];

  // Featured row.
  const fy = 68, fh = 76;
  parts.push(`<rect x="32" y="${fy}" width="936" height="${fh}" rx="8" fill="${C.faint}" stroke="${C.line}"/>`);
  parts.push(`<g transform="translate(52 ${fy + 16}) scale(0.44)">${featured.logo}</g>`);
  parts.push(text(112, fy + 33, esc(featured.title), { size: 19, fill: C.title, font: SANS, weight: 700 }));
  parts.push(text(112, fy + 55, esc(featured.desc), { size: 13.5, fill: C.text, font: SANS }));
  parts.push(text(952, fy + 33, esc(featured.url) + " ↗", { size: 12, fill: C.cyan, anchor: "end" }));
  parts.push(text(952, fy + 55, esc(`${fmt(featured.commits)} commits · ${featured.lang} · active ${monthYear(featured.pushedAt)}`), { size: 12, fill: C.dim, anchor: "end" }));

  // Table of repositories by own commits.
  const ty = fy + fh + 38;
  const col = { name: 32, vis: 400, lang: 500, bar: 640, commits: 870, last: 968 };
  parts.push(text(col.name, ty, "REPOSITORY", { size: 10.5, fill: C.dim, spacing: 2 }));
  parts.push(text(col.vis, ty, "ACCESS", { size: 10.5, fill: C.dim, spacing: 2 }));
  parts.push(text(col.lang, ty, "LANGUAGE", { size: 10.5, fill: C.dim, spacing: 2 }));
  parts.push(text(col.commits, ty, "COMMITS", { size: 10.5, fill: C.dim, spacing: 2, anchor: "end" }));
  parts.push(text(col.last, ty, "LAST PUSH", { size: 10.5, fill: C.dim, spacing: 2, anchor: "end" }));
  const max = Math.max(...top.map((r) => r.commits));
  top.forEach((r, i) => {
    const y = ty + 22 + i * 32;
    parts.push(`<line x1="32" y1="${y - 6}" x2="968" y2="${y - 6}" stroke="${C.faint}"/>`);
    parts.push(text(col.name, y + 15, esc(trunc(r.name, 36)), { size: 13.5, fill: C.title, font: SANS, weight: 600 }));
    parts.push(text(col.vis, y + 15, r.isPrivate ? "private" : "public", { size: 12, fill: r.isPrivate ? C.dim : C.cyan }));
    if (r.primaryLanguage) {
      parts.push(`<circle cx="${col.lang + 4}" cy="${y + 11}" r="4" fill="${r.primaryLanguage.color || C.text}"/>`);
      parts.push(text(col.lang + 14, y + 15, esc(trunc(r.primaryLanguage.name, 14)), { size: 12, fill: C.text }));
    } else parts.push(text(col.lang, y + 15, "—", { size: 12, fill: C.mute }));
    parts.push(`<rect x="${col.bar}" y="${y + 8}" width="160" height="5" rx="2.5" fill="${C.faint}"/>`);
    parts.push(`<rect x="${col.bar}" y="${y + 8}" width="${Math.max(2, (r.commits / max) * 160).toFixed(1)}" height="5" rx="2.5" fill="${C.orange}"/>`);
    parts.push(text(col.commits, y + 15, fmt(r.commits), { size: 12.5, fill: C.title, anchor: "end" }));
    parts.push(text(col.last, y + 15, monthYear(r.pushedAt), { size: 12, fill: C.dim, anchor: "end" }));
  });
  return svg(W, ty + 22 + top.length * 32 + 18, `Projects: ${featured.title} and top repositories by commits`, parts.join("\n  "));
}

function publicCard(repos) {
  const W = 1000;
  const parts = [label(32, 44, "PUBLIC REPOSITORIES")];
  const ty = 84;
  const col = { name: 32, desc: 330, lang: 700, stars: 900, forks: 968 };
  parts.push(text(col.name, ty, "REPOSITORY", { size: 10.5, fill: C.dim, spacing: 2 }));
  parts.push(text(col.desc, ty, "DESCRIPTION", { size: 10.5, fill: C.dim, spacing: 2 }));
  parts.push(text(col.lang, ty, "LANGUAGE", { size: 10.5, fill: C.dim, spacing: 2 }));
  parts.push(text(col.stars, ty, "STARS", { size: 10.5, fill: C.dim, spacing: 2, anchor: "end" }));
  parts.push(text(col.forks, ty, "FORKS", { size: 10.5, fill: C.dim, spacing: 2, anchor: "end" }));
  repos.forEach((r, i) => {
    const y = ty + 22 + i * 32;
    parts.push(`<line x1="32" y1="${y - 6}" x2="968" y2="${y - 6}" stroke="${C.faint}"/>`);
    parts.push(text(col.name, y + 15, esc(trunc(r.name, 34)), { size: 13.5, fill: C.title, font: SANS, weight: 600 }));
    parts.push(text(col.desc, y + 15, esc(trunc(r.description || "—", 46)), { size: 12.5, fill: r.description ? C.text : C.mute, font: SANS }));
    if (r.primaryLanguage) {
      parts.push(`<circle cx="${col.lang + 4}" cy="${y + 11}" r="4" fill="${r.primaryLanguage.color || C.text}"/>`);
      parts.push(text(col.lang + 14, y + 15, esc(trunc(r.primaryLanguage.name, 14)), { size: 12, fill: C.text }));
    } else parts.push(text(col.lang, y + 15, "—", { size: 12, fill: C.mute }));
    parts.push(text(col.stars, y + 15, fmt(r.stargazerCount), { size: 12.5, fill: r.stargazerCount ? C.orange : C.dim, anchor: "end" }));
    parts.push(text(col.forks, y + 15, fmt(r.forkCount), { size: 12.5, fill: r.forkCount ? C.title : C.dim, anchor: "end" }));
  });
  return svg(W, ty + 22 + repos.length * 32 + 18, "Public repositories: " + repos.map((r) => r.name).join(", "), parts.join("\n  "));
}

const TOOLBOX = [
  ["Languages", [["TypeScript", "#3178C6"], ["Python", "#3572A5"], ["Rust", "#DEA584"], ["C++", "#F34B7D"], ["C#", "#178600"], ["Go", "#00ADD8"], ["Kotlin", "#A97BFF"], ["Lua", "#4F6BF2"], ["ActionScript", "#882B0F"]]],
  ["Web & apps", [["Next.js", "#E6EDF3"], ["React", "#61DAFB"], ["Node.js", "#5FA04E"], ["Tailwind", "#38BDF8"], ["Vite", "#FFD62E"], ["Stripe", "#635BFF"]]],
  ["Data & infra", [["PostgreSQL", "#4169E1"], ["Drizzle", "#C5F74F"], ["SQLite", "#5BA4D9"], ["Turso", "#4FF8D2"], ["Redis", "#DC382D"], ["Docker", "#2496ED"], ["Caddy", "#1F88C0"]]],
  ["Reverse eng.", [["Ghidra", "#FF6B35"], ["IDA Pro", "#9FB0C8"], ["Frida", "#E63946"], ["x64dbg", "#9FB0C8"], ["Cheat Engine", "#B01030"], ["Wireshark", "#1679A7"], ["Burp Suite", "#FF6633"], ["Fiddler", "#1E5B97"]]],
  ["Tooling", [["Git", "#F05032"], ["Linux", "#FCC624"], ["VS Code", "#0A66C2"], ["Visual Studio", "#8661C5"], ["pnpm", "#F69220"], ["esbuild", "#FFCF00"], ["Postman", "#FF6C37"], ["GitHub Actions", "#2088FF"]]],
];

// Simple Icons paths (24x24), vendored in scripts/icons.json; tools without one get a dot.
const ICONS = JSON.parse(readFileSync(new URL("./icons.json", import.meta.url), "utf8"));

function toolboxCard() {
  const W = 1000, rowH = 44, x0 = 160, charW = 7.1;
  const parts = [label(32, 44, "TOOLBOX")];
  TOOLBOX.forEach(([cat, items], i) => {
    const y = 72 + i * rowH;
    if (i) parts.push(`<line x1="32" y1="${y - 8}" x2="968" y2="${y - 8}" stroke="${C.faint}"/>`);
    parts.push(text(32, y + 19, esc(cat.toLowerCase()), { fill: C.dim }));
    let x = x0;
    for (const [name, color] of items) {
      const w = Math.round(name.length * charW + 38);
      parts.push(`<rect x="${x}" y="${y + 2}" width="${w}" height="26" rx="6" fill="${C.faint}" stroke="${C.line}"/>`);
      if (ICONS[name]) parts.push(`<path transform="translate(${x + 8} ${y + 8}) scale(0.5834)" d="${ICONS[name]}" fill="${color}"/>`);
      else parts.push(`<circle cx="${x + 15}" cy="${y + 15}" r="3.5" fill="${color}"/>`);
      parts.push(text(x + 28, y + 19.5, esc(name), { size: 12.5, fill: C.title }));
      x += w + 8;
    }
  });
  return svg(W, 72 + TOOLBOX.length * rowH + 12, "Toolbox: " + TOOLBOX.map(([c, it]) => `${c}: ${it.map((t) => t[0]).join(", ")}`).join("; "), parts.join("\n  "));
}

// ---------- main ----------
function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  const list = days.filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let longest = { len: 0 }, run = { len: 0 };
  for (const d of list) {
    if (d.contributionCount > 0) {
      run = { len: run.len + 1 };
      if (run.len > longest.len) longest = { ...run };
    } else run = { len: 0 };
  }
  // Today without contributions does not break the current streak yet.
  let current = { len: 0 };
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].contributionCount > 0) current.len++;
    else if (i === list.length - 1 && list[i].date === today) continue;
    else break;
  }
  return { longest, current };
}

const user = await fetchUser();
const [repos, yearData] = await Promise.all([
  fetchRepos(user.id),
  Promise.all(user.contributionsCollection.contributionYears.map(async (y) => [y, await fetchYear(y)])),
]);

const own = repos.filter((r) => !r.isFork && !EXCLUDE.has(r.name.toLowerCase()));
const langScore = new Map();
for (const r of own) for (const e of r.languages.edges) {
  const cur = langScore.get(e.node.name) || { name: e.node.name, color: e.node.color || C.text, size: 0 };
  // sqrt damps repos with huge generated/vendored files.
  cur.size += Math.sqrt(e.size);
  langScore.set(e.node.name, cur);
}
const langTotal = [...langScore.values()].reduce((a, l) => a + l.size, 0) || 1;
const langs = [...langScore.values()].sort((a, b) => b.size - a.size).map((l) => ({ ...l, pct: (l.size / langTotal) * 100 }));

const today = new Date().toISOString().slice(0, 10);
const days = yearData.flatMap(([, c]) => c.contributionCalendar.weeks.flatMap((w) => w.contributionDays))
  .filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
const perYear = Object.fromEntries(yearData.map(([y, c]) => [y, c.contributionCalendar.totalContributions]));
const sum = (k) => yearData.reduce((a, [, c]) => a + c[k], 0);

// Last 53 weeks, aligned on Sundays like GitHub's calendar.
const start = new Date(Date.now() - 364 * 864e5);
start.setUTCDate(start.getUTCDate() - start.getUTCDay());
const startIso = start.toISOString().slice(0, 10);
const recent = days.filter((d) => d.date >= startIso);
const lastWeeks = [];
for (const d of recent) {
  const wi = Math.floor((new Date(d.date + "T00:00:00Z") - new Date(startIso + "T00:00:00Z")) / (7 * 864e5));
  (lastWeeks[wi] ||= []).push(d);
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const wd = Array(7).fill(0);
for (const d of days) wd[new Date(d.date + "T00:00:00Z").getUTCDay()] += d.contributionCount;

const extraCommits = repos.reduce((a, r) => a + r.extraCommits, 0);
const stats = {
  createdAt: user.createdAt,
  totalContrib: Object.values(perYear).reduce((a, b) => a + b, 0) + extraCommits,
  // Private contributions are only exposed as an aggregate; count them with commits.
  commits: sum("totalCommitContributions") + sum("restrictedContributionsCount") + extraCommits,
  publicRepos: repos.filter((r) => !r.isPrivate).length,
  privateRepos: repos.filter((r) => r.isPrivate).length,
  stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
  followers: user.followers.totalCount,
  best: days.reduce((a, d) => (d.contributionCount > a.count ? { count: d.contributionCount, date: d.date } : a), { count: 0, date: today }),
  topWeekday: weekdays[wd.indexOf(Math.max(...wd))],
  perYear,
  lastWeeks: lastWeeks.filter(Boolean),
  lastYearTotal: recent.reduce((a, d) => a + d.contributionCount, 0),
  langs,
  ...streaks(days),
};

const featuredSet = new Set(FEATURED.repos.map((n) => n.toLowerCase()));
const featuredRepos = repos.filter((r) => featuredSet.has(r.name.toLowerCase()));
const featured = {
  ...FEATURED,
  commits: featuredRepos.reduce((a, r) => a + r.commits, 0),
  lang: featuredRepos.map((r) => r.primaryLanguage?.name).find(Boolean) || "—",
  pushedAt: featuredRepos.map((r) => r.pushedAt).sort().pop() || new Date().toISOString(),
};
const rank = (r) => { const i = PIN.indexOf(r.name.toLowerCase()); return i < 0 ? PIN.length : i; };
const topRepos = own
  .filter((r) => (PIN.includes(r.name.toLowerCase()) || !featuredSet.has(r.name.toLowerCase())) && !HIDE.has(r.name.toLowerCase()) && r.name.toLowerCase() !== USER.toLowerCase() && r.commits > 0)
  .sort((a, b) => rank(a) - rank(b) || b.commits - a.commits)
  .slice(0, Number(process.env.PROJECTS_COUNT) || 8);

const publicRepos = own
  .filter((r) => !r.isPrivate && !HIDE.has(r.name.toLowerCase()) && !featuredSet.has(r.name.toLowerCase()) && r.name.toLowerCase() !== USER.toLowerCase())
  .sort((a, b) => b.stargazerCount - a.stargazerCount || b.forkCount - a.forkCount || b.commits - a.commits)
  .slice(0, Number(process.env.PUBLIC_COUNT) || 6);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/activity.svg`, activityCard(stats));
writeFileSync(`${OUT}/projects.svg`, projectsCard(featured, topRepos));
writeFileSync(`${OUT}/public.svg`, publicCard(publicRepos));
writeFileSync(`${OUT}/toolbox.svg`, toolboxCard());
console.log("Wrote activity.svg, projects.svg", {
  contributions: stats.totalContrib, commits: stats.commits, streak: stats.current.len, longest: stats.longest.len,
  featured: featured.commits, public: publicRepos.map((r) => r.name).join(" "), top: topRepos.map((r) => `${r.name}:${r.commits}`).join(" "),
});
