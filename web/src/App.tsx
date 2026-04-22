import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { ElementDefinition, StylesheetJson } from "cytoscape";
import "./App.css";

type Pair = {
  peer: string;
  received: number;
  given: number;
  reciprocal: number;
  total: number;
};

type Data = {
  subject: string;
  generatedAt: string;
  stats: { totalRecv: number; totalGiven: number; uniqueRecv: number; uniqueGiven: number; overlap: number };
  pairs: Pair[];
};

type Tier = "self" | "high" | "mid" | "low";

function tierFor(recip: number): Tier {
  if (recip >= 3) return "high";
  if (recip >= 2) return "mid";
  return "low";
}

export default function App() {
  const [login, setLogin] = useState("bsaeed");
  const [input, setInput] = useState("bsaeed");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pair | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError(null);
    setData(null);
    setSelected(null);
    fetch(`/${login}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`No data for "${login}" — run: node --env-file=.env explore.mjs ${login}`);
        return r.json() as Promise<Data>;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [login]);

  useEffect(() => {
    if (!data || !graphRef.current) return;
    const maxTotal = Math.max(...data.pairs.map((p) => p.total), 1);
    const elements: ElementDefinition[] = [
      {
        data: {
          id: data.subject,
          label: data.subject,
          total: maxTotal,
          tier: "self" satisfies Tier,
        },
      },
      ...data.pairs.map((p) => ({
        data: {
          id: p.peer,
          label: p.peer,
          total: p.total,
          received: p.received,
          given: p.given,
          reciprocal: p.reciprocal,
          tier: tierFor(p.reciprocal),
        },
      })),
      ...data.pairs.map((p) => ({
        data: {
          id: `${data.subject}->${p.peer}`,
          source: data.subject,
          target: p.peer,
          weight: Math.max(0.5, p.reciprocal * 1.5),
          recip: p.reciprocal,
        },
      })),
    ];

    const style: StylesheetJson = [
      {
        selector: "node",
        style: {
          "background-color": "#3b4252",
          label: "data(label)",
          color: "#8a93a3",
          "font-size": 9,
          "text-valign": "bottom",
          "text-margin-y": 3,
          width: "mapData(total, 1, 25, 16, 64)",
          height: "mapData(total, 1, 25, 16, 64)",
          "border-width": 1,
          "border-color": "#0a0a0c",
        },
      },
      {
        selector: 'node[tier="self"]',
        style: { "background-color": "#f0f0f0", color: "#f0f0f0", "font-size": 13, width: 64, height: 64 },
      },
      { selector: 'node[tier="mid"]', style: { "background-color": "#e9a02b", color: "#f0d9a8" } },
      { selector: 'node[tier="high"]', style: { "background-color": "#e63946", color: "#ffc5c9" } },
      {
        selector: "edge",
        style: {
          width: "data(weight)",
          "line-color": "#23232a",
          opacity: 0.35,
          "curve-style": "straight",
        },
      },
      { selector: "edge[recip >= 2]", style: { "line-color": "#e9a02b", opacity: 0.6 } },
      { selector: "edge[recip >= 3]", style: { "line-color": "#e63946", opacity: 0.8 } },
      { selector: "node:selected", style: { "border-width": 3, "border-color": "#f0f0f0" } },
    ];

    const cy = cytoscape({
      container: graphRef.current,
      elements,
      style,
      layout: {
        name: "cose",
        animate: false,
        padding: 40,
        idealEdgeLength: () => 110,
        nodeRepulsion: () => 9000,
      },
      wheelSensitivity: 0.2,
    });

    cy.on("tap", "node", (evt) => {
      const n = evt.target;
      if (n.data("tier") === "self") {
        setSelected(null);
        return;
      }
      setSelected({
        peer: n.data("label"),
        received: n.data("received"),
        given: n.data("given"),
        reciprocal: n.data("reciprocal"),
        total: n.data("total"),
      });
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelected(null);
    });

    return () => cy.destroy();
  }, [data]);

  return (
    <div className="app">
      <header>
        <h1>Evalchain</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = input.trim();
            if (v) setLogin(v);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="42 login"
            spellCheck={false}
          />
        </form>
        <div className="legend">
          <span className="dot low" /> recip &lt;2
          <span className="dot mid" /> recip ≥2
          <span className="dot high" /> recip ≥3
        </div>
      </header>

      <div className="graph" ref={graphRef} />

      {error && <div className="msg error">{error}</div>}

      {data && (
        <aside className="stats">
          <div className="stats-head">
            <b>{data.subject}</b>
            <span className="muted"> · {new Date(data.generatedAt).toLocaleDateString()}</span>
          </div>
          <div>received {data.stats.totalRecv} from {data.stats.uniqueRecv} peers</div>
          <div>given {data.stats.totalGiven} to {data.stats.uniqueGiven} peers</div>
          <div>overlap {data.stats.overlap}</div>
        </aside>
      )}

      {selected && (
        <aside className="detail">
          <div><b>{selected.peer}</b></div>
          <div>received from them: {selected.received}</div>
          <div>given to them: {selected.given}</div>
          <div>reciprocal: {selected.reciprocal}</div>
        </aside>
      )}
    </div>
  );
}
