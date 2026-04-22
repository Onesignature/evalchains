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
    await new Promise((res) => setTimeout(res, PAGE_DELAY_MS));
  }
  return all;
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
    pairs.push({ peer, received: r, given: g, reciprocal: Math.min(r, g), total: r + g });
  }
  return pairs;
}

function printTable(rows, title) {
  if (rows.length === 0) {
    console.log(`\n${title}: (none)`);
    return;
  }
  console.log(`\n${title}`);
  console.log(`  ${"peer".padEnd(18)} ${"recv".padStart(5)} ${"given".padStart(6)} ${"recip".padStart(6)} ${"total".padStart(6)}`);
  console.log(`  ${"-".repeat(18)} ${"-".repeat(5)} ${"-".repeat(6)} ${"-".repeat(6)} ${"-".repeat(6)}`);
  for (const p of rows) {
    console.log(
      `  ${p.peer.padEnd(18)} ${String(p.received).padStart(5)} ${String(p.given).padStart(6)} ${String(p.reciprocal).padStart(6)} ${String(p.total).padStart(6)}`,
    );
  }
}

function summarize(pairs, received, given, selfLogin) {
  const totalRecv = received.length;
  const totalGiven = given.reduce((n, e) => n + (e.correcteds?.length ?? 0), 0);
  const uniqueRecv = new Set(pairs.filter((p) => p.received > 0).map((p) => p.peer)).size;
  const uniqueGiven = new Set(pairs.filter((p) => p.given > 0).map((p) => p.peer)).size;
  const overlap = pairs.filter((p) => p.received > 0 && p.given > 0).length;

  console.log(`\n== ${selfLogin} — evaluation map ==`);
  console.log(`Received : ${totalRecv} evals from ${uniqueRecv} unique peers`);
  console.log(`Given    : ${totalGiven} evals to ${uniqueGiven} unique peers`);
  console.log(`Overlap  : ${overlap} peers evaluated in both directions`);

  const reciprocal = pairs
    .filter((p) => p.reciprocal > 0)
    .sort((a, b) => b.reciprocal - a.reciprocal || b.total - a.total);
  printTable(reciprocal.slice(0, 15), "Top reciprocal pairs (both directions, sorted by min count):");

  const tight = reciprocal.filter((p) => p.reciprocal >= 2);
  if (tight.length > 0) {
    console.log(
      `\n${tight.length} peer${tight.length === 1 ? "" : "s"} with reciprocal >= 2 ` +
        `(both evaluated each other at least twice). These are the edges worth visualizing.`,
    );
  } else {
    console.log(`\nNo peers with reciprocal >= 2. Clean profile.`);
  }
}

const token = await getToken();
console.error(`token ok. fetching evaluation history for ${login}...`);
const [received, given] = await Promise.all([
  fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrected`, "received"),
  fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrector`, "given"),
]);
const pairs = buildPairs(received, given, login);
summarize(pairs, received, given, login);
