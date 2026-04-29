import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { ElementDefinition, StylesheetJson } from "cytoscape";
// @ts-expect-error — no types shipped with this plugin
import fcose from "cytoscape-fcose";
import "./App.css";

cytoscape.use(fcose);

type Tier = "tight" | "reciprocal" | "lopsided" | "normal";

type Pair = {
  peer: string;
  displayName: string;
  imageUrl: string | null;
  received: number;
  given: number;
  reciprocal: number;
  max: number;
  total: number;
  tier: Tier;
};

type Subject = { login: string; displayName: string; imageUrl: string | null };

type Data = {
  subject: Subject;
  generatedAt: string;
  stats: {
    totalRecv: number;
    totalGiven: number;
    uniqueRecv: number;
    uniqueGiven: number;
    overlap: number;
    tiers: Record<Tier, number>;
  };
  pairs: Pair[];
};

const TIERS: Tier[] = ["tight", "reciprocal", "lopsided", "normal"];

const MOCK_LOGINS = [
  "bsaeed", "jdoe", "asmith", "bwilson", "cclark", "ddavis", 
  "emartin", "fwhite", "ghall", "hlee", "iking", 
  "jwright", "kscott", "lgreen", "mbaker", "nadams",
  "onelson", "pcarter", "qmitchell", "rperez"
];

const MOCK_DATA: Data = {
  subject: { login: "bsaeed", displayName: "Bilal Saeed", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png" },
  generatedAt: new Date().toISOString(),
  stats: {
    totalRecv: 142, totalGiven: 138, uniqueRecv: 52, uniqueGiven: 48, overlap: 22,
    tiers: { tight: 4, reciprocal: 6, lopsided: 10, normal: 30 }
  },
  pairs: [
    ...Array.from({ length: 4 }).map((_, i) => ({ peer: MOCK_LOGINS[i], displayName: MOCK_LOGINS[i], imageUrl: `https://i.pravatar.cc/150?u=${MOCK_LOGINS[i]}`, received: 5, given: 5, reciprocal: 5, max: 5, total: 10, tier: "tight" as Tier })),
    ...Array.from({ length: 6 }).map((_, i) => ({ peer: MOCK_LOGINS[i+4], displayName: MOCK_LOGINS[i+4], imageUrl: `https://i.pravatar.cc/150?u=${MOCK_LOGINS[i+4]}`, received: 3, given: 3, reciprocal: 3, max: 3, total: 6, tier: "reciprocal" as Tier })),
    ...Array.from({ length: 10 }).map((_, i) => ({ peer: MOCK_LOGINS[i+10], displayName: MOCK_LOGINS[i+10], imageUrl: `https://i.pravatar.cc/150?u=${MOCK_LOGINS[i+10]}`, received: 4, given: 1, reciprocal: 1, max: 4, total: 5, tier: "lopsided" as Tier })),
    ...Array.from({ length: 30 }).map((_, i) => ({ peer: `student${i}`, displayName: `student${i}`, imageUrl: `https://i.pravatar.cc/150?u=student${i}`, received: 1, given: 1, reciprocal: 1, max: 1, total: 2, tier: "normal" as Tier }))
  ]
};

export default function App() {
  const [user, setUser] = useState<{ login: string; imageUrl: string | null } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [login, setLogin] = useState("");
  const [input, setInput] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pair | null>(null);
  const [hidden, setHidden] = useState<Set<Tier>>(new Set());
  const [loading, setLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userProfileRef = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<
    Array<{ login: string; displayName: string; imageUrl: string | null }>
  >([]);
  const [showResults, setShowResults] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        setUser(u);
        setAuthLoading(false);
        if (u) {
          setLogin(u.login);
          setInput(u.login);
        }
      })
      .catch(() => setAuthLoading(false));

    const onDocClick = (e: MouseEvent) => {
      if (searchFormRef.current && !searchFormRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
      if (userProfileRef.current && !userProfileRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const onSearchInput = (value: string) => {
    setInput(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      fetch(`/api/search/${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rs) => {
          setResults(Array.isArray(rs) ? rs : []);
          setShowResults(true);
        })
        .catch(() => setResults([]));
    }, 220);
  };

  const pickResult = (loginValue: string) => {
    setInput(loginValue);
    setLogin(loginValue);
    setShowResults(false);
    setResults([]);
  };

  const toggleTier = (t: Tier) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSelected(null);
    
    if (!user && !authLoading) {
      setData(MOCK_DATA);
      setLoading(false);
      return;
    }

    if (!user || !login) return;

    setLoading(true);
    fetch(`/api/probe/${encodeURIComponent(login)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `probe failed (${r.status})`);
        return body as Data;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [login, user, authLoading]);

  useEffect(() => {
    if (!data || !graphRef.current) return;
    const subject = data.subject;
    // For real data, hide peers with no avatar (bots). For mock data, show them.
    const visiblePairs = data === MOCK_DATA ? data.pairs : data.pairs.filter((p) => p.imageUrl !== null);
    const maxSize = Math.max(...visiblePairs.map((p) => p.max), 1);

    const elements: ElementDefinition[] = [
      {
        data: {
          id: subject.login,
          login: subject.login,
          label: subject.login,
          displayName: subject.displayName,
          ...(subject.imageUrl ? { imageUrl: subject.imageUrl } : {}),
          size: maxSize,
          tier: "self",
        },
      },
      ...visiblePairs.map((p) => ({
        data: {
          id: p.peer,
          login: p.peer,
          label: p.peer,
          displayName: p.displayName,
          ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
          size: p.max,
          received: p.received,
          given: p.given,
          reciprocal: p.reciprocal,
          total: p.total,
          tier: p.tier,
        },
      })),
      ...visiblePairs.map((p) => ({
        data: {
          id: `${subject.login}->${p.peer}`,
          source: subject.login,
          target: p.peer,
          weight: Math.max(0.6, (p.reciprocal + p.max / 3) * 0.9),
          tier: p.tier,
        },
      })),
    ];

    const style: StylesheetJson = [
      {
        selector: "node",
        style: {
          label: "data(login)",
          color: "#a0a8b8",
          "font-size": 10,
          "font-weight": 500,
          "text-valign": "bottom",
          "text-margin-y": 4,
          "text-outline-color": "#07080f",
          "text-outline-width": 3,
          width: 18,
          height: 18,
          "background-color": "#1c1f2a",
          "border-width": 1.5,
          "border-color": "#3a3f50",
        },
      },
      {
        selector: "node[imageUrl]",
        style: {
          "background-image": "data(imageUrl)",
          "background-fit": "cover",
          "background-image-containment": "over",
          "background-image-smoothing": "yes",
        },
      },
      {
        selector: 'node[tier="normal"]',
        style: { label: "", width: 42, height: 42, "border-width": 2 },
      },
      {
        selector: 'node[tier="lopsided"]',
        style: { "border-color": "#4ac9ff", "border-width": 3, width: 48, height: 48 },
      },
      {
        selector: 'node[tier="reciprocal"]',
        style: { "border-color": "#ffa544", "border-width": 3.5, width: 62, height: 62 },
      },
      {
        selector: 'node[tier="tight"]',
        style: { "border-color": "#ff3b68", "border-width": 4, width: 80, height: 80 },
      },
      {
        selector: 'node[tier="self"]',
        style: {
          "border-color": "#ffffff",
          "border-width": 4.5,
          width: 112,
          height: 112,
          color: "#ffffff",
          "font-size": 14,
          "font-weight": 700,
        },
      },
      {
        selector: "edge",
        style: {
          width: "data(weight)",
          "line-color": "#ffffff",
          opacity: 0.08,
          "curve-style": "straight",
        },
      },
      { selector: 'edge[tier="lopsided"]',   style: { opacity: 0.22 } },
      { selector: 'edge[tier="reciprocal"]', style: { opacity: 0.4 } },
      { selector: 'edge[tier="tight"]',      style: { opacity: 0.75 } },
      { selector: "node:selected", style: { "border-color": "#ffffff", "border-width": 5 } },
      { selector: "node:active",   style: { "overlay-opacity": 0 } },
    ];

    // Preset layout: place each ring at an exact pixel radius so the outer cloud
    // can sit right next to the lopsided ring regardless of bubble sizes.
    const positions: Record<string, { x: number; y: number }> = {};
    positions[subject.login] = { x: 0, y: 0 };
    const tight = visiblePairs.filter((p) => p.tier === "tight");
    const recip = visiblePairs.filter((p) => p.tier === "reciprocal");
    const lop = visiblePairs.filter((p) => p.tier === "lopsided");
    const norm = visiblePairs.filter((p) => p.tier === "normal");

    const placeRing = (peers: Pair[], radius: number, phase = 0) => {
      const n = peers.length;
      for (let i = 0; i < n; i++) {
        const angle = phase + (i / n) * 2 * Math.PI - Math.PI / 2;
        positions[peers[i].peer] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      }
    };

    placeRing(tight, 110);
    placeRing(recip, 180);
    placeRing(lop, 245);

    const NORMAL_RINGS = 5;
    const perRing = Math.ceil(norm.length / NORMAL_RINGS) || 1;
    for (let r = 0; r < NORMAL_RINGS; r++) {
      const slice = norm.slice(r * perRing, (r + 1) * perRing);
      // Stagger alternating rings so bubbles don't align into radial spokes.
      const phase = r % 2 === 0 ? 0 : Math.PI / (slice.length || 1);
      placeRing(slice, 310 + r * 48, phase);
    }

    const cy = cytoscape({
      container: graphRef.current,
      elements,
      style,
      layout: { name: "preset", positions, fit: true, padding: 20 } as cytoscape.LayoutOptions,
      minZoom: 0.25,
      maxZoom: 3,
    });

    // Scatter nodes to random start, then animate into the preset positions.
    // Gives the Bubblemaps drift-in spawn without fcose's overlapping behaviour.
    cy.nodes().forEach((n) => {
      n.position({ x: (Math.random() - 0.5) * 1400, y: (Math.random() - 0.5) * 1400 });
    });
    cy.layout({
      name: "preset",
      positions,
      animate: true,
      animationDuration: 1400,
      animationEasing: "ease-out-cubic",
      fit: true,
      padding: 20,
    } as cytoscape.LayoutOptions).run();

    cy.on("tap", "node", (evt) => {
      const n = evt.target;
      if (n.data("tier") === "self") {
        setSelected(null);
        return;
      }
      setSelected({
        peer: n.data("login"),
        displayName: n.data("displayName"),
        imageUrl: n.data("imageUrl") || null,
        received: n.data("received"),
        given: n.data("given"),
        reciprocal: n.data("reciprocal"),
        max: n.data("size"),
        total: n.data("total"),
        tier: n.data("tier"),
      });
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelected(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      for (const t of TIERS) {
        cy.$(`node[tier="${t}"]`).style("display", hidden.has(t) ? "none" : "element");
      }
    });
  }, [hidden, data]);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5.5" cy="12" r="2.6" fill="none" stroke="#ffffff" strokeWidth="1.3" />
            <circle cx="17.5" cy="6.5" r="2.1" fill="#ff3b68" stroke="none" />
            <circle cx="18.5" cy="17.5" r="2.1" fill="#4ac9ff" stroke="none" />
            <line x1="7.6" y1="11" x2="16.2" y2="7.4" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
            <line x1="7.6" y1="13" x2="17" y2="16.5" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
          </svg>
          <h1>evalchains</h1>
        </div>
        <form
          ref={searchFormRef}
          className="search"
          style={{ opacity: !user ? 0.5 : 1, pointerEvents: !user ? "none" : "auto" }}
          onSubmit={(e) => {
            e.preventDefault();
            const v = input.trim();
            if (v) {
              setLogin(v);
              setShowResults(false);
            }
          }}
        >
          <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={input}
            onChange={(e) => onSearchInput(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setShowResults(true);
            }}
            placeholder="search 42 login…"
            spellCheck={false}
            autoComplete="off"
            disabled={!user}
          />
          {showResults && results.length > 0 && (
            <div className="search-dropdown">
              {results.map((r) => (
                <button
                  key={r.login}
                  type="button"
                  className="search-result"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickResult(r.login);
                  }}
                >
                  {r.imageUrl ? (
                    <img className="search-result-avatar" src={r.imageUrl} alt="" />
                  ) : (
                    <div className="search-result-avatar fallback">{r.login.slice(0, 2)}</div>
                  )}
                  <div className="search-result-text">
                    <div className="search-result-name">{r.displayName}</div>
                    <div className="search-result-login">@{r.login}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </form>
        <div className="header-spacer" style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "flex-end" }}>
          <a href="https://github.com/Onesignature/evalchain" target="_blank" rel="noreferrer" className="github-link" title="Star on GitHub">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
            <span className="hide-mobile">GitHub</span>
          </a>
          <div 
            className="user-profile"
            ref={userProfileRef}
            onClick={() => user && setShowUserMenu(!showUserMenu)}
            style={{ opacity: !user ? 0.5 : 1, cursor: !user ? "default" : "pointer" }}
          >
            {user?.imageUrl ? (
              <img className="avatar" src={user.imageUrl} alt={user.login} />
            ) : (
              <div className="avatar fallback">{user ? user.login.slice(0, 2) : "??"}</div>
            )}
            <span className="user-login">{user ? user.login : "Guest"}</span>
            {user && (
              <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true" style={{ width: 12, height: 12, color: "#666c7c" }}>
                 <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            
            {showUserMenu && user && (
              <div className="user-dropdown">
                <a href="/api/auth/logout" className="logout-btn">
                  Logout
                </a>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="graph" ref={graphRef} style={{ opacity: !user && !authLoading ? 0.75 : 1, transition: "opacity 800ms ease", pointerEvents: !user && !authLoading ? "none" : "auto" }} />

      {!user && !authLoading && (
        <div className="landing-overlay">
          <div className="landing-hero">
            <svg className="hero-mark" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5.5" cy="12" r="2.6" fill="none" stroke="#ffffff" strokeWidth="1.3" />
              <circle cx="17.5" cy="6.5" r="2.1" fill="#ff3b68" stroke="none" />
              <circle cx="18.5" cy="17.5" r="2.1" fill="#4ac9ff" stroke="none" />
              <line x1="7.6" y1="11" x2="16.2" y2="7.4" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
              <line x1="7.6" y1="13" x2="17" y2="16.5" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1" />
            </svg>
            <h1 className="hero-title">evalchains</h1>
            <p className="hero-subtitle">
              The evaluation-pattern visualizer for the 42 Network.
            </p>
            
            <div className="hero-features">
              <div className="hero-feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span>Search any 42 login to build an interactive peer map.</span>
              </div>
              <div className="hero-feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
                <span>Analyze clustered and reciprocal evaluations instantly.</span>
              </div>
              <div className="hero-feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                <span>Break down complex relationships into readable tiers.</span>
              </div>
            </div>
            
            <a href="/api/auth/login" className="hero-login-btn">
              Authenticate with 42
            </a>
            <a href="https://github.com/Onesignature/evalchain" target="_blank" rel="noreferrer" className="hero-secondary-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
              View Source & Star on GitHub
            </a>
          </div>
        </div>
      )}

      {loading && user && (
        <div className="loading">
          <div className="spinner" />
          <div className="loading-title">
            probing <b>{login}</b>
          </div>
          <div className="loading-sub muted">first run takes 30–60s · cached after</div>
        </div>
      )}

      {error && <div className="msg error">{error}</div>}

      {data && !selected && (
        <div className="legend">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`legend-item tier-${t} ${hidden.has(t) ? "off" : ""}`}
              onClick={() => toggleTier(t)}
              title={hidden.has(t) ? `show ${t}` : `hide ${t}`}
            >
              <span className="dot" />
              <span className="tier-name">{t}</span>
              <span className="tier-count">
                {data.pairs.filter((p) => p.imageUrl && p.tier === t).length}
              </span>
            </button>
          ))}
        </div>
      )}

      {data && (
        <aside className="subject-card">
          <div className="panel-head">
            {data.subject.imageUrl ? (
              <img className="avatar lg" src={data.subject.imageUrl} alt={data.subject.login} />
            ) : (
              <div className="avatar lg fallback">{data.subject.login.slice(0, 2)}</div>
            )}
            <div>
              <div className="name">{data.subject.displayName}</div>
              <a
                className="login-link"
                href={`https://profile.intra.42.fr/users/${data.subject.login}`}
                target="_blank"
                rel="noreferrer"
              >
                @{data.subject.login}
              </a>
            </div>
          </div>
          <div className="stats-row">
            <div>
              <span className="muted">received</span> {data.stats.totalRecv}
              <span className="muted"> / {data.stats.uniqueRecv} peers</span>
            </div>
            <div>
              <span className="muted">given</span> {data.stats.totalGiven}
              <span className="muted"> / {data.stats.uniqueGiven} peers</span>
            </div>
            <div>
              <span className="muted">overlap</span> {data.stats.overlap}
            </div>
          </div>
          <button
            type="button"
            className="export-btn"
            onClick={() => {
              if (!cyRef.current) return;
              const b64 = cyRef.current.png({ full: true, scale: 2, bg: 'transparent' });
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement("canvas");
                const padTop = 180;
                const padBottom = 100;
                canvas.width = Math.max(img.width + 100, 1000);
                canvas.height = img.height + padTop + padBottom;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                
                // Draw dark background
                ctx.fillStyle = "#07080f";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw graph
                const dx = (canvas.width - img.width) / 2;
                ctx.drawImage(img, dx, padTop);
                
                // Draw Brand Logo
                ctx.save();
                ctx.translate(canvas.width / 2 - 140, 80);
                ctx.scale(2.2, 2.2);
                ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(12, -10);
                ctx.moveTo(-10, 2); ctx.lineTo(14, 10);
                ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.stroke();
                ctx.beginPath(); ctx.arc(-13, 0, 6, 0, Math.PI*2);
                ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.6; ctx.stroke();
                ctx.beginPath(); ctx.arc(11, -11, 4.2, 0, Math.PI*2);
                ctx.fillStyle = "#ff3b68"; ctx.fill();
                ctx.beginPath(); ctx.arc(13, 11, 4.2, 0, Math.PI*2);
                ctx.fillStyle = "#4ac9ff"; ctx.fill();
                ctx.restore();

                // Draw Brand Text
                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 52px Inter, system-ui, sans-serif";
                ctx.textAlign = "left";
                ctx.fillText("evalchains", canvas.width / 2 - 80, 96);
                
                // Draw Subtitle
                ctx.fillStyle = "#9aa5b4";
                ctx.font = "500 28px Inter, system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(`@${data.subject.login} — Evaluation Network`, canvas.width / 2, 148);
                
                // Draw Footer
                ctx.fillStyle = "#5a6272";
                ctx.font = "22px Inter, system-ui, sans-serif";
                ctx.fillText("generated at evalchains.com", canvas.width / 2, canvas.height - 40);
                
                const finalB64 = canvas.toDataURL("image/png");
                const a = document.createElement("a");
                a.href = finalB64;
                a.download = `${data.subject.login}_evalchains.png`;
                a.click();
              };
              img.src = b64;
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Export Map as Image
          </button>
        </aside>
      )}

      {selected && (
        <aside className={`detail tier-${selected.tier}`}>
          <div className="panel-head">
            {selected.imageUrl ? (
              <img className="avatar lg" src={selected.imageUrl} alt={selected.peer} />
            ) : (
              <div className="avatar lg fallback">{selected.peer.slice(0, 2)}</div>
            )}
            <div>
              <div className="name">{selected.displayName}</div>
              <a
                className="login-link"
                href={`https://profile.intra.42.fr/users/${selected.peer}`}
                target="_blank"
                rel="noreferrer"
              >
                @{selected.peer}
              </a>
            </div>
          </div>
          <div className="tier-badge">{selected.tier}</div>
          <button
            type="button"
            className="open-map-btn"
            onClick={() => {
              setInput(selected.peer);
              setLogin(selected.peer);
              setSelected(null);
            }}
          >
            open @{selected.peer}&rsquo;s map →
          </button>
          <div className="counts">
            <div>
              <span className="muted">they evaluated you</span> <b>{selected.received}</b>
            </div>
            <div>
              <span className="muted">you evaluated them</span> <b>{selected.given}</b>
            </div>
            <div>
              <span className="muted">reciprocal (min)</span> <b>{selected.reciprocal}</b>
            </div>
            <div>
              <span className="muted">peak direction (max)</span> <b>{selected.max}</b>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
