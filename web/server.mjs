import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load repo-root .env so the server can authenticate with the 42 API.
try {
  const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".env");
  process.loadEnvFile(envPath);
} catch {
  // ok if not present in prod (will rely on real env vars)
}

const API = "https://api.intra.42.fr";
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;
async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;
  const id = process.env.FT_CLIENT_ID;
  const secret = process.env.FT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FT_CLIENT_ID / FT_CLIENT_SECRET missing");
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const { access_token, expires_in } = await r.json();
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in ?? 7200) * 1000 };
  return access_token;
}

async function fetchAllPages(token, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const url = `${API}${path}?page[size]=${PAGE_SIZE}&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`${path} p${page} ${r.status}: ${await r.text()}`);
    const batch = await r.json();
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }
  return all;
}

async function fetchUsers(token, logins) {
  const out = new Map();
  const BATCH = 80;
  for (let i = 0; i < logins.length; i += BATCH) {
    const batch = logins.slice(i, i + BATCH);
    const url = `${API}/v2/users?filter[login]=${batch.join(",")}&page[size]=${BATCH}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const users = await r.json();
      for (const u of users) out.set(u.login, u);
    }
    if (i + BATCH < logins.length) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

function pickAvatar(u) {
  return u?.image?.versions?.small ?? u?.image?.versions?.medium ?? u?.image?.link ?? null;
}

function tierFor(recip, max) {
  if (recip >= 3 || max >= 5) return "tight";
  if (recip >= 2) return "reciprocal";
  if (max >= 3) return "lopsided";
  return "normal";
}

async function probe(login) {
  const token = await getToken();
  const [received, given] = await Promise.all([
    fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrected`),
    fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrector`),
  ]);

  const recvCount = new Map();
  const givenCount = new Map();
  for (const e of received) {
    const c = e.corrector?.login;
    if (c && c !== login) recvCount.set(c, (recvCount.get(c) ?? 0) + 1);
  }
  for (const e of given) {
    for (const t of e.correcteds ?? []) {
      if (t.login && t.login !== login) givenCount.set(t.login, (givenCount.get(t.login) ?? 0) + 1);
    }
  }

  const peerLogins = [...new Set([...recvCount.keys(), ...givenCount.keys()])];
  const users = await fetchUsers(token, [login, ...peerLogins]);
  const subjectUser = users.get(login);

  const pairs = peerLogins.map((peer) => {
    const r = recvCount.get(peer) ?? 0;
    const g = givenCount.get(peer) ?? 0;
    const max = Math.max(r, g);
    const reciprocal = Math.min(r, g);
    const u = users.get(peer);
    return {
      peer,
      displayName: u?.displayname ?? u?.usual_full_name ?? peer,
      imageUrl: pickAvatar(u),
      received: r,
      given: g,
      reciprocal,
      max,
      total: r + g,
      tier: tierFor(reciprocal, max),
    };
  });

  const order = { tight: 3, reciprocal: 2, lopsided: 1, normal: 0 };
  pairs.sort((a, b) => order[b.tier] - order[a.tier] || b.max - a.max || b.total - a.total);

  const tiers = { tight: 0, reciprocal: 0, lopsided: 0, normal: 0 };
  for (const p of pairs) tiers[p.tier]++;

  return {
    subject: {
      login,
      displayName: subjectUser?.displayname ?? subjectUser?.usual_full_name ?? login,
      imageUrl: pickAvatar(subjectUser),
    },
    generatedAt: new Date().toISOString(),
    stats: {
      totalRecv: received.length,
      totalGiven: given.reduce((n, e) => n + (e.correcteds?.length ?? 0), 0),
      uniqueRecv: recvCount.size,
      uniqueGiven: givenCount.size,
      overlap: pairs.filter((p) => p.received > 0 && p.given > 0).length,
      tiers,
    },
    pairs,
  };
}

const app = express();
const port = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// The 'public' directory is inside 'dist' in production, or 'public' in dev
const dataDir = process.env.NODE_ENV === "production" ? join(__dirname, ".cache") : join(__dirname, "public");

// 1. Auth routes
app.get("/api/auth/login", (req, res) => {
  const id = process.env.FT_CLIENT_ID;
  const redirectUri = process.env.PUBLIC_URL 
    ? `${process.env.PUBLIC_URL}/api/auth/callback` 
    : `http://${req.headers.host}/api/auth/callback`;
  const url = `${API}/oauth/authorize?client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(url);
});

app.get("/api/auth/callback", async (req, res) => {
  const code = req.query.code;
  const id = process.env.FT_CLIENT_ID;
  const secret = process.env.FT_CLIENT_SECRET;
  const redirectUri = process.env.PUBLIC_URL 
    ? `${process.env.PUBLIC_URL}/api/auth/callback` 
    : `http://${req.headers.host}/api/auth/callback`;
    
  try {
    const r = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: id,
        client_secret: secret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!r.ok) throw new Error(`auth callback failed: ${await r.text()}`);
    const { access_token } = await r.json();
    
    res.cookie("evalchains_session", access_token, { path: "/", httpOnly: true, maxAge: 86400 * 1000 });
    res.redirect("/");
  } catch (err) {
    res.status(500).send(String(err));
  }
});

app.get("/api/auth/me", async (req, res) => {
  const cookies = req.headers.cookie || "";
  const sessionMatch = cookies.match(/evalchains_session=([^;]+)/);
  if (!sessionMatch) return res.status(401).json({ error: "Unauthorized" });
  
  try {
    const r = await fetch(`${API}/v2/me`, {
      headers: { Authorization: `Bearer ${sessionMatch[1]}` }
    });
    if (!r.ok) throw new Error("Invalid token");
    const user = await r.json();
    res.json({ login: user.login, imageUrl: pickAvatar(user) });
  } catch {
    res.cookie("evalchains_session", "", { path: "/", httpOnly: true, maxAge: 0 });
    res.status(401).json({ error: "Invalid session" });
  }
});

app.get("/api/auth/logout", (req, res) => {
  res.cookie("evalchains_session", "", { path: "/", httpOnly: true, maxAge: 0 });
  res.redirect("/");
});

// Staff API - Export tight peers for blacklisting in peer-matching
app.get("/api/staff/blacklist/:login", async (req, res) => {
  // const apiKey = req.headers["x-api-key"];
  // if (apiKey !== process.env.STAFF_API_KEY) return res.status(403).end();
  
  const login = decodeURIComponent(req.params.login);
  try {
    const data = await probe(login);
    const blacklist = data.pairs.filter(p => p.tier === "tight").map(p => p.peer);
    res.json({ target: login, reason: "Highly concentrated evaluations (tight tier)", blacklist });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Protect frontend API routes
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  const cookies = req.headers.cookie || "";
  if (!cookies.includes("evalchains_session=")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// /api/search/<query>
app.get("/api/search/:query", async (req, res) => {
  const query = decodeURIComponent(req.params.query);
  try {
    const token = await getToken();
    const url = `${API}/v2/users?search[login]=${encodeURIComponent(query)}&page[size]=8&sort=login`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`search ${r.status}: ${await r.text()}`);
    const users = await r.json();
    const results = users.map((u) => ({
      login: u.login,
      displayName: u.displayname ?? u.usual_full_name ?? u.login,
      imageUrl: pickAvatar(u),
    }));
    res.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

app.get("/api/probe/:login", async (req, res) => {
  const login = decodeURIComponent(req.params.login);
  const fresh = req.query.fresh === "1";
  const cachePath = join(dataDir, `${login}.json`);

  try {
    if (!fresh && existsSync(cachePath)) {
      res.setHeader("X-Cache", "hit");
      return res.json(JSON.parse(readFileSync(cachePath, "utf-8")));
    }
    console.log(`[evalchain] probing ${login}...`);
    const payload = await probe(login);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(payload, null, 2));
    console.log(`[evalchain] ${login} done (${payload.pairs.length} peers, ${payload.stats.tiers.tight} tight)`);
    res.setHeader("X-Cache", "miss");
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[evalchain] probe ${login} failed: ${msg}`);
    res.status(msg.includes("404") ? 404 : 502).json({ error: msg });
  }
});

// Serve static frontend files in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(join(__dirname, "dist")));
  app.use((req, res) => {
    res.sendFile(join(__dirname, "dist", "index.html"));
  });
}

app.listen(port, () => {
  console.log(`🚀 Production Server running at http://localhost:${port}`);
});
