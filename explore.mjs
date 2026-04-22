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

async function fetchAllEvals(token, login) {
  const all = [];
  for (let page = 1; ; page++) {
    const url = `${API}/v2/users/${login}/scale_teams/as_corrected?page[size]=${PAGE_SIZE}&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`scale_teams p${page} ${r.status}: ${await r.text()}`);
    const batch = await r.json();
    all.push(...batch);
    console.error(`  page ${page}: +${batch.length} (total ${all.length})`);
    if (batch.length < PAGE_SIZE) break;
    await new Promise((res) => setTimeout(res, PAGE_DELAY_MS));
  }
  return all;
}

function summarize(evals, login) {
  const counts = new Map();
  for (const e of evals) {
    const corrector = e.corrector?.login ?? "(unknown)";
    counts.set(corrector, (counts.get(corrector) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = evals.length;
  const unique = counts.size;
  const diversity = total > 0 ? unique / total : 0;
  const repeatRate = 1 - diversity;

  console.log(`\n== ${login} — evaluation summary ==`);
  console.log(`Total evaluations received : ${total}`);
  console.log(`Unique evaluators          : ${unique}`);
  console.log(`Diversity (unique/total)   : ${diversity.toFixed(3)}`);
  console.log(`Repeat-evaluator score     : ${repeatRate.toFixed(3)}`);
  console.log(`\nTop evaluators:`);
  for (const [corrector, count] of sorted.slice(0, 15)) {
    const pct = ((count / total) * 100).toFixed(1).padStart(5);
    console.log(`  ${corrector.padEnd(20)} ${String(count).padStart(3)}  (${pct}%)`);
  }
}

const token = await getToken();
console.error(`token ok, fetching evals for ${login}...`);
const evals = await fetchAllEvals(token, login);
summarize(evals, login);
