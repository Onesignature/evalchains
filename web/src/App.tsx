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

export default function App() {
  const [login, setLogin] = useState("bsaeed");
  const [input, setInput] = useState("bsaeed");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pair | null>(null);
  const [hidden, setHidden] = useState<Set<Tier>>(new Set());
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<
    Array<{ login: string; displayName: string; imageUrl: string | null }>
  >([]);
  const [showResults, setShowResults] = useState(false);
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchFormRef.current && !searchFormRef.current.contains(e.target as Node)) {
        setShowResults(false);
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
    setData(null);
    setSelected(null);
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
  }, [login]);

  useEffect(() => {
    if (!data || !graphRef.current) return;
    const subject = data.subject;
    // Hide peers with no avatar — these are team/bot accounts (e.g. 3b3-*) that
    // the 42 user lookup can't resolve, and they just pollute the map with edges
    // to non-humans.
    const visiblePairs = data.pairs.filter((p) => p.imageUrl !== null);
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
          <h1>evalchain</h1>
        </div>
        <form
          ref={searchFormRef}
          className="search"
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
        <div className="header-spacer" />
      </header>

      <div className="graph" ref={graphRef} />

      {loading && (
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
