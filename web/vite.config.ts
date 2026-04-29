import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load repo-root .env so the dev server can authenticate with the 42 API.
// We run vite from web/, so .env lives one directory up.
try {
  const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".env");
  process.loadEnvFile(envPath);
} catch {
  // ok if not present — the middleware will error at probe time instead.
}

const API = "https://api.intra.42.fr";
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 600;

type Tier = "tight" | "reciprocal" | "lopsided" | "normal";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cachedToken: { value: string; expiresAt: number } | null = null;
async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;
  const id = process.env.FT_CLIENT_ID;
  const secret = process.env.FT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("FT_CLIENT_ID / FT_CLIENT_SECRET missing (check ../.env)");
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const { access_token, expires_in } = (await r.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in ?? 7200) * 1000 };
  return access_token;
}

async function fetchAllPages(token: string, path: string): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; ; page++) {
    const url = `${API}${path}?page[size]=${PAGE_SIZE}&page[number]=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`${path} p${page} ${r.status}: ${await r.text()}`);
    const batch = (await r.json()) as unknown[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }
  return all;
}

async function fetchUsers(token: string, logins: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const BATCH = 80;
  for (let i = 0; i < logins.length; i += BATCH) {
    const batch = logins.slice(i, i + BATCH);
    const url = `${API}/v2/users?filter[login]=${batch.join(",")}&page[size]=${BATCH}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const users = (await r.json()) as any[];
      for (const u of users) out.set(u.login, u);
    }
    if (i + BATCH < logins.length) await sleep(PAGE_DELAY_MS);
  }
  return out;
}

function pickAvatar(u: any): string | null {
  return u?.image?.versions?.small ?? u?.image?.versions?.medium ?? u?.image?.link ?? null;
}

function tierFor(recip: number, max: number): Tier {
  if (recip >= 3 || max >= 5) return "tight";
  if (recip >= 2) return "reciprocal";
  if (max >= 3) return "lopsided";
  return "normal";
}

async function probe(login: string) {
  const token = await getToken();
  const [received, given] = await Promise.all([
    fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrected`),
    fetchAllPages(token, `/v2/users/${login}/scale_teams/as_corrector`),
  ]);

  const recvCount = new Map<string, number>();
  const givenCount = new Map<string, number>();
  for (const e of received as any[]) {
    const c = e.corrector?.login;
    if (c && c !== login) recvCount.set(c, (recvCount.get(c) ?? 0) + 1);
  }
  for (const e of given as any[]) {
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

  const order: Record<Tier, number> = { tight: 3, reciprocal: 2, lopsided: 1, normal: 0 };
  pairs.sort((a, b) => order[b.tier] - order[a.tier] || b.max - a.max || b.total - a.total);

  const tiers: Record<Tier, number> = { tight: 0, reciprocal: 0, lopsided: 0, normal: 0 };
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
      totalGiven: (given as any[]).reduce((n, e) => n + (e.correcteds?.length ?? 0), 0),
      uniqueRecv: recvCount.size,
      uniqueGiven: givenCount.size,
      overlap: pairs.filter((p) => p.received > 0 && p.given > 0).length,
      tiers,
    },
    pairs,
  };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "evalchain-api",
      configureServer(server) {
        const publicDir = join(server.config.root, "public");
        server.middlewares.use(async (req, res, next) => {
          // 1. Auth routes
          const authLoginMatch = req.url?.match(/^\/api\/auth\/login$/);
          if (authLoginMatch) {
            const id = process.env.FT_CLIENT_ID;
            const redirectUri = "http://localhost:5173/api/auth/callback";
            const url = `${API}/oauth/authorize?client_id=${id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
            res.statusCode = 302;
            res.setHeader("Location", url);
            res.end();
            return;
          }

          const authCallbackMatch = req.url?.match(/^\/api\/auth\/callback\?code=([^&]+)/);
          if (authCallbackMatch) {
            const code = authCallbackMatch[1];
            const id = process.env.FT_CLIENT_ID;
            const secret = process.env.FT_CLIENT_SECRET;
            const redirectUri = "http://localhost:5173/api/auth/callback";
            try {
              const r = await fetch(`${API}/oauth/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  client_id: id!,
                  client_secret: secret!,
                  code,
                  redirect_uri: redirectUri,
                }),
              });
              if (!r.ok) throw new Error(`auth callback failed: ${await r.text()}`);
              const { access_token } = await r.json() as any;
              
              res.setHeader("Set-Cookie", `evalchains_session=${access_token}; Path=/; HttpOnly; Max-Age=86400`);
              res.statusCode = 302;
              res.setHeader("Location", "/");
              res.end();
            } catch (err) {
              res.statusCode = 500;
              res.end(String(err));
            }
            return;
          }

          const authMeMatch = req.url?.match(/^\/api\/auth\/me$/);
          if (authMeMatch) {
            const cookies = req.headers.cookie || "";
            const sessionMatch = cookies.match(/evalchains_session=([^;]+)/);
            if (!sessionMatch) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: "Unauthorized" }));
              return;
            }
            try {
              const r = await fetch(`${API}/v2/me`, {
                headers: { Authorization: `Bearer ${sessionMatch[1]}` }
              });
              if (!r.ok) throw new Error("Invalid token");
              const user = (await r.json()) as any;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ login: user.login, imageUrl: pickAvatar(user) }));
            } catch {
              res.setHeader("Set-Cookie", `evalchains_session=; Path=/; HttpOnly; Max-Age=0`);
              res.statusCode = 401;
              res.end(JSON.stringify({ error: "Invalid session" }));
            }
            return;
          }

          const authLogoutMatch = req.url?.match(/^\/api\/auth\/logout$/);
          if (authLogoutMatch) {
            res.setHeader("Set-Cookie", `evalchains_session=; Path=/; HttpOnly; Max-Age=0`);
            res.statusCode = 302;
            res.setHeader("Location", "/");
            res.end();
            return;
          }

          // Staff API - Export tight peers for blacklisting in peer-matching
          const staffBlacklistMatch = req.url?.match(/^\/api\/staff\/blacklist\/([^?]+)(\?.*)?$/);
          if (staffBlacklistMatch) {
            // In a real environment, you'd check a staff token here
            // const apiKey = req.headers["x-api-key"];
            // if (apiKey !== process.env.STAFF_API_KEY) { res.statusCode = 403; return res.end(); }
            
            const login = decodeURIComponent(staffBlacklistMatch[1]);
            try {
              const data = await probe(login);
              // Extract the logins of 'tight' peers to be blacklisted
              const blacklist = data.pairs
                .filter(p => p.tier === "tight")
                .map(p => p.peer);
              
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({
                 target: login,
                 reason: "Highly concentrated evaluations (tight tier)",
                 blacklist
              }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
            return;
          }

          // Protect frontend API routes
          if (req.url?.startsWith("/api/") && !req.url.startsWith("/api/auth/")) {
            const cookies = req.headers.cookie || "";
            if (!cookies.includes("evalchains_session=")) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: "Unauthorized" }));
              return;
            }
          }

          // /api/search/<query> — type-ahead user search for the dropdown
          const searchMatch = req.url?.match(/^\/api\/search\/([^?]+)(\?.*)?$/);
          if (searchMatch) {
            const query = decodeURIComponent(searchMatch[1]);
            try {
              const token = await getToken();
              const url = `${API}/v2/users?search[login]=${encodeURIComponent(query)}&page[size]=8&sort=login`;
              const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
              if (!r.ok) throw new Error(`search ${r.status}: ${await r.text()}`);
              const users = (await r.json()) as any[];
              const results = users.map((u) => ({
                login: u.login,
                displayName: u.displayname ?? u.usual_full_name ?? u.login,
                imageUrl: pickAvatar(u),
              }));
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(results));
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: msg }));
            }
            return;
          }

          const m = req.url?.match(/^\/api\/probe\/([a-zA-Z0-9._-]+)(\?.*)?$/);
          if (!m) return next();
          const login = m[1];
          const fresh = /(^|[?&])fresh=1/.test(req.url ?? "");
          const cachePath = join(publicDir, `${login}.json`);

          try {
            if (!fresh && existsSync(cachePath)) {
              res.setHeader("Content-Type", "application/json");
              res.setHeader("X-Cache", "hit");
              res.end(readFileSync(cachePath, "utf-8"));
              return;
            }
            console.log(`[evalchain] probing ${login}...`);
            const payload = await probe(login);
            mkdirSync(publicDir, { recursive: true });
            writeFileSync(cachePath, JSON.stringify(payload, null, 2));
            console.log(`[evalchain] ${login} done (${payload.pairs.length} peers, ${payload.stats.tiers.tight} tight)`);
            res.setHeader("Content-Type", "application/json");
            res.setHeader("X-Cache", "miss");
            res.end(JSON.stringify(payload));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[evalchain] probe ${login} failed: ${msg}`);
            res.statusCode = msg.includes("404") ? 404 : 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: msg }));
          }
        });
      },
    },
  ],
});
