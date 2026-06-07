// =============================================================================
// SankeyView.jsx — Budget money-flow Sankey (income → budget → expenses → subs)
// thrive UI — alternate "View" for the Category Breakdown report
//
// Flows: each income category → a central Budget node → each expense parent →
// its subcategories (with a "(direct)" leaf for parent spend not in any sub).
// Any income left over after expenses flows to a Leftover node.
// =============================================================================
import { Component, useEffect, useRef } from "react";
import { Chart, Tooltip, LinearScale } from "chart.js";
import { SankeyController, Flow } from "chartjs-chart-sankey";

Chart.register(SankeyController, Flow, Tooltip, LinearScale);

const PALETTE = [
  "#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7",
  "#14b8a6","#ec4899","#f97316","#84cc16","#94a3b8",
];
const usd = (n) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BUDGET = "budget";

// turn the breakdown payload into sankey links + node labels/colors
function buildSankey(data) {
  const links = [];          // { from, to, flow }
  const labels = {};         // nodeId -> display name
  const colors = {};         // nodeId -> hex
  const c2d = (c) => (c || 0) / 100;
  if (!data) return { links, labels, colors };

  labels[BUDGET] = "Budget";
  colors[BUDGET] = "#e8e6e0";

  (data.income?.categories || []).forEach((cat, i) => {
    const id = `inc:${cat.id}`;
    labels[id] = cat.name;
    colors[id] = PALETTE[i % PALETTE.length];
    if (cat.total_cents > 0) links.push({ from: id, to: BUDGET, flow: c2d(cat.total_cents) });
  });

  (data.expenses?.categories || []).forEach((cat, i) => {
    const pid = `exp:${cat.id}`;
    const hue = PALETTE[i % PALETTE.length];
    labels[pid] = cat.name;
    colors[pid] = hue;
    if (cat.total_cents > 0) links.push({ from: BUDGET, to: pid, flow: c2d(cat.total_cents) });

    const subs = cat.subcategories || [];
    const subTotal = subs.reduce((s, x) => s + x.total_cents, 0);
    const direct   = cat.total_cents - subTotal;
    subs.forEach((sub) => {
      const sid = `sub:${sub.id}`;
      labels[sid] = sub.name;
      colors[sid] = hue;
      if (sub.total_cents > 0) links.push({ from: pid, to: sid, flow: c2d(sub.total_cents) });
    });
    if (subs.length && direct > 0) {
      const did = `direct:${cat.id}`;
      labels[did] = cat.name + " (direct)";
      colors[did] = hue;
      links.push({ from: pid, to: did, flow: c2d(direct) });
    }
  });

  const leftover = (data.income?.total_cents || 0) - (data.expenses?.total_cents || 0);
  if (leftover > 0) {
    labels.leftover = "Leftover";
    colors.leftover = "#22c55e";
    links.push({ from: BUDGET, to: "leftover", flow: c2d(leftover) });
  }

  return { links, labels, colors };
}

function SankeyChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const { links, labels, colors } = buildSankey(data);
    if (!links.length) return;

    const nodeColor = (id) => colors[id] || "#94a3b8";
    // chart.js scriptable context: prefer the raw flow item, never throw
    const flowOf = (c) => (c && c.raw) || (c && c.dataset && c.dataset.data[c.dataIndex]) || {};

    chartRef.current = new Chart(canvasRef.current, {
      type: "sankey",
      data: {
        datasets: [{
          data: links,
          labels,
          colorFrom: (c) => nodeColor(flowOf(c).from),
          colorTo:   (c) => nodeColor(flowOf(c).to),
          colorMode: "gradient",
          color: "#e8e6e0",          // node label text
          borderWidth: 0,
          nodeWidth: 14,
          nodePadding: 14,
          font: { family: "monospace", size: 11 },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 8 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const f = flowOf(ctx);
                return `${labels[f.from] || f.from} → ${labels[f.to] || f.to}: ${usd(f.flow)}`;
              },
            },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [data]);

  if (!buildSankey(data).links.length) {
    return (
      <div style={{ textAlign: "center", padding: "3rem", fontSize: 12, color: "var(--text-tertiary,#888)" }}>
        No flow data for this range
      </div>
    );
  }

  return (
    <div style={{ height: 540, padding: 8 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// Keep a chart failure from blanking the whole reports page; show the error.
class SankeyBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: "2rem", fontSize: 12, color: "var(--color-danger,#ef4444)", fontFamily: "monospace" }}>
          Sankey failed to render: {String(this.state.err.message || this.state.err)}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SankeyView({ data }) {
  return (
    <SankeyBoundary>
      <SankeyChart data={data} />
    </SankeyBoundary>
  );
}
