import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CLIENT_ID = process.env.FT_CLIENT_ID;
const CLIENT_SECRET = process.env.FT_CLIENT_SECRET;
const login = process.argv[2];

if (!login) {
  console.error("Usage: node --env-file=.env explore.mjs <login>");
  process.exit(1);
}
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing FT_CLIENT_ID / FT_CLIENT_SECRET in .env");
  process.exit(1);
}

const API = "https://api.intra.42.fr";
const PAGE_SIZE = 100;
// 42 API limit: 2 req/sec per app. 600ms between pages keeps us safely under.
const PAGE_DELAY_MS = 600;
const JSON_OUT = `web/public/${login}.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const { access_token } = await r.json();
  return access_token;
}

async function fetchAllPages(token, path, label) {
  const all = [];
  for (let page = 1; ; page++) {
    const url = `${API}${path}?page[size]=${PAGE_SIZE}&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`${label} p${page} ${r.status}: ${await r.text()}`);
    const batch = await r.json();
    all.push(...batch);
    console.error(`  [${label}] page ${page}: +${batch.length} (total ${all.length})`);
    if (batch.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }
  return all;
}

async function fetchUsersByLogin(token, logins) {
  const out = new Map();
  const BATCH = 80;
  for (let i = 0; i < logins.length; i += BATCH) {
    const batch = logins.slice(i, i + BATCH);
    const url = `${API}/v2/users?filter[login]=${batch.join(",")}&page[size]=${BATCH}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      console.error(`  [users] batch ${i / BATCH + 1} failed (${r.status}) — continuing without avatars for this batch`);
    } else {
      const users = await r.json();
      for (const u of users) out.set(u.login, u);
      console.error(`  [users] batch ${i / BATCH + 1}: +${users.length} (total ${out.size})`);
    }
    if (i + BATCH < logins.length) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

function buildPairs(received, given, selfLogin) {
  const recvCount = new Map();
  const givenCount = new Map();

  for (const e of received) {
    const c = e.corrector?.login;
    if (c && c !== selfLogin) recvCount.set(c, (recvCount.get(c) ?? 0) + 1);
  }
  for (const e of given) {
    for (const t of e.correcteds ?? []) {
      const peer = t.login;
      if (peer && peer !== selfLogin) givenCount.set(peer, (givenCount.get(peer) ?? 0) + 1);
    }
  }

  const peers = new Set([...recvCount.keys(), ...givenCount.keys()]);
  const pairs = [];
  for (const peer of peers) {
    const r = recvCount.get(peer) ?? 0;
    const g = givenCount.get(peer) ?? 0;
    pairs.push({ peer, received: r, given: g, reciprocal: Math.min(r, g), max: Math.max(r, g), total: r + g });
  }
  return pairs;
}

function tierFor(p) {
  if (p.reciprocal >= 3 || p.max >= 5) return "tight";
  if (p.reciprocal >= 2) return "reciprocal";
  if (p.max >= 3) return "lopsided";
  return "normal";
}

function pickAvatar(u) {
  return (
    u?.image?.versions?.small ??
    u?.image?.versions?.medium ??
    u?.image?.link ??
    null
  );
}

function enrich(pairs, users) {
  for (const p of pairs) {
    const u = users.get(p.peer);
    p.displayName = u?.displayname ?? u?.usual_full_name ?? p.peer;
    p.imageUrl = pickAvatar(u);
    p.tier = tierFor(p);
  }
}

function printTable(rows, title) {
  if (rows.length === 0) {
    console.log(`\n${title}: (none)`);
    return;
  }
  console.log(`\n${title}`);
  console.log(`  ${"peer".padEnd(18)} ${"recv".padStart(5)} ${"given".padStart(6)} ${"recip".padStart(6)} ${"max".padStart(4)} ${"tier".padStart(11)}`);
  console.log(`  ${"-".repeat(18)} ${"-".repeat(5)} ${"-".repeat(6)} ${"-".repeat(6)} ${"-".repeat(4)} ${"-".repeat(11)}`);
  for (const p of rows) {
    console.log(
      `  ${p.peer.padEnd(18)} ${String(p.received).padStart(5)} ${String(p.given).padStart(6)} ${String(p.reciprocal).padStart(6)} ${String(p.max).padStart(4)} ${p.tier.padStart(11)}`,
    );
  }
}

function summarize(pairs, received, given, selfLogin) {
  const totalRecv = received.length;
  const totalGiven = given.reduce((n, e) => n + (e.correcteds?.length ?? 0), 0);
  const uniqueRecv = new Set(pairs.filter((p) => p.received > 0).map((p) => p.peer)).size;
  const uniqueGiven = new Set(pairs.filter((p) => p.given > 0).map((p) => p.peer)).size;
  const overlap = pairs.filter((p) => p.received > 0 && p.given > 0).length;
  const tiers = { tight: 0, reciprocal: 0, lopsided: 0, normal: 0 };
  for (const p of pairs) tiers[p.tier]++;

  console.log(`\n== ${selfLogin} — evaluation map ==`);
  console.log(`Received : ${totalRecv} evals from ${uniqueRecv} unique peers`);
  console.log(`Given    : ${totalGiven} evals to ${uniqueGiven} unique peers`);
  console.log(`Overlap  : ${overlap} peers evaluated in both directions`);
  console.log(`Tiers    : tight=${tiers.tight}  reciprocal=${tiers.reciprocal}  lopsided=${tiers.lopsided}  normal=${tiers.normal}`);

  const flagged = pairs
    .filter((p) => p.tier !== "normal")
    .sort((a, b) => {
      const order = { tight: 3, reciprocal: 2, lopsided: 1, normal: 0 };
      return order[b.tier] - order[a.tier] || b.max - a.max || b.total - a.total;
    });
  printTable(flagged.slice(0, 20), "Flagged pairs (any non-normal tier):");

  return { totalRecv, totalGiven, uniqueRecv, uniqueGiven, overlap, tiers };
}

function exportJSON(pairs, stats, subjectUser, selfLogin, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const order = { tight: 3, reciprocal: 2, lopsided: 1, normal: 0 };
  const payload = {
    subject: {
      login: selfLogin,
      displayName: subjectUser?.displayname ?? subjectUser?.usual_full_name ?? selfLogin,
      imageUrl: pickAvatar(subjectUser),
    },
    generatedAt: new Date().toISOString(),
    stats,
    pairs: [...pairs].sort(
      (a, b) => order[b.tier] - order[a.tier] || b.max - a.max || b.total - a.total,
    ),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.error(`\nWrote ${outPath}`);
}

const token = await getToken();
console.error(`token ok. fetching evaluation history for ${login}...`);
const [received, given] = await Promise.all([
  fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrected`, "received"),
  fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrector`, "given"),
]);
const pairs = buildPairs(received, given, login);
console.error(`resolving ${pairs.length + 1} user profiles for avatars...`);
const users = await fetchUsersByLogin(token, [login, ...pairs.map((p) => p.peer)]);
enrich(pairs, users);
const stats = summarize(pairs, received, given, login);
exportJSON(pairs, stats, users.get(login), login, JSON_OUT);
