// =============================================================================
// CategoryBreakdown.jsx — Spending & income by parent / subcategory (donut)
// thrive UI
// =============================================================================
import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

const API = "/reports/category-breakdown";

// ── colour palette ──────────────────────────────────────────────────────────
const PALETTE = [
  "#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7",
  "#14b8a6","#ec4899","#f97316","#84cc16","#94a3b8",
];
const color  = (i) => PALETTE[i % PALETTE.length];
const fmtUSD = (cents) =>
  "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (part, total) =>
  total ? ((part / total) * 100).toFixed(1) + "%" : "0%";

// ── SVG donut helpers ────────────────────────────────────────────────────────
const CX = 150, CY = 150;
const O_OUT = 130, O_IN = 95;   // outer ring radii
const I_OUT =  90, I_IN = 58;   // inner ring radii

function pt(r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return `${(CX + r * Math.cos(rad)).toFixed(3)} ${(CY + r * Math.sin(rad)).toFixed(3)}`;
}
function arc(rOut, rIn, a1, a2) {
  const sweep = Math.min(a2 - a1, 359.99);
  const large = sweep > 180 ? 1 : 0;
  const a2c = a1 + sweep;
  return [
    `M ${pt(rOut, a1)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${pt(rOut, a2c)}`,
    `L ${pt(rIn,  a2c)}`,
    `A ${rIn}  ${rIn}  0 ${large} 0 ${pt(rIn, a1)}`,
    "Z",
  ].join(" ");
}

// ── donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ categories, totalCents, title }) {
  const [hov, setHov] = useState(null); // {name, total_cents, pct}

  if (!categories.length) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", fontSize: 12, color: "var(--text-tertiary,#888)" }}>
        {title}: no data
      </div>
    );
  }

  const total = totalCents || categories.reduce((s, c) => s + c.total_cents, 0);

  // ── build slice data ──
  const outerSlices = []; // { path, color, cat, startDeg, endDeg }
  const innerSlices = []; // { path, color, cat, sub, isDirectSpend }
  let cursor = 0;

  categories.forEach((cat, ci) => {
    const sweep = (cat.total_cents / total) * 360;
    const a1 = cursor, a2 = cursor + sweep;
    const c = color(ci);
    outerSlices.push({ path: arc(O_OUT, O_IN, a1, a2), color: c, cat, a1, a2 });

    if (cat.subcategories.length === 0) {
      // no real subs — fill inner ring with the same category (lighter)
      innerSlices.push({ path: arc(I_OUT, I_IN, a1, a2), color: c, cat, sub: null, opacity: 0.45 });
    } else {
      let subCursor = a1;
      const subTotal = cat.subcategories.reduce((s, x) => s + x.total_cents, 0);
      const directSpend = cat.total_cents - subTotal;

      // direct-spend slice if any
      if (directSpend > 0) {
        const subSweep = (directSpend / cat.total_cents) * sweep;
        innerSlices.push({ path: arc(I_OUT, I_IN, subCursor, subCursor + subSweep), color: c, cat, sub: { name: cat.name + " (direct)", total_cents: directSpend }, opacity: 0.35 });
        subCursor += subSweep;
      }

      cat.subcategories.forEach((sub) => {
        const subSweep = (sub.total_cents / cat.total_cents) * sweep;
        innerSlices.push({ path: arc(I_OUT, I_IN, subCursor, subCursor + subSweep), color: c, cat, sub, opacity: 0.75 });
        subCursor += subSweep;
      });
    }
    cursor = a2;
  });

  const centerText = hov ? hov : { name: title, total_cents: total, pct: null };

  return (
    <div>
      {/* chart */}
      <svg viewBox="0 0 300 300" style={{ width: "100%", maxWidth: 300, display: "block", margin: "0 auto" }}>
        {/* outer ring */}
        {outerSlices.map((s, i) => (
          <path key={`o${i}`} d={s.path} fill={s.color}
            stroke="var(--bg-primary,#0f0f0f)" strokeWidth="1.5"
            style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            opacity={hov && hov !== s.catHov ? 0.65 : 1}
            onMouseEnter={() => setHov({ name: s.cat.name, total_cents: s.cat.total_cents, pct: fmtPct(s.cat.total_cents, total) })}
            onMouseLeave={() => setHov(null)}
          />
        ))}
        {/* inner ring */}
        {innerSlices.map((s, i) => (
          <path key={`i${i}`} d={s.path} fill={s.color}
            fillOpacity={s.opacity}
            stroke="var(--bg-primary,#0f0f0f)" strokeWidth="1"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => {
              const item = s.sub || s.cat;
              setHov({ name: item.name, total_cents: item.total_cents, pct: fmtPct(item.total_cents, total) });
            }}
            onMouseLeave={() => setHov(null)}
          />
        ))}
        {/* center text */}
        <text x={CX} y={CY - 10} textAnchor="middle"
          style={{ fill: "var(--text-tertiary,#888)", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>
          {centerText.pct ? centerText.pct : title.split(" ")[0]}
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle"
          style={{ fill: "var(--text-primary,#e8e6e0)", fontSize: 18, fontWeight: 600, fontFamily: "monospace" }}>
          {fmtUSD(centerText.total_cents)}
        </text>
        <text x={CX} y={CY + 30} textAnchor="middle"
          style={{ fill: "var(--text-secondary,#aaa)", fontSize: 10, fontFamily: "var(--font-body)" }}>
          {centerText.name.length > 22 ? centerText.name.slice(0, 22) + "…" : centerText.name}
        </text>
      </svg>

      {/* legend */}
      <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
        {categories.map((cat, ci) => (
          <div key={cat.id}
            style={{ padding: "5px 0", borderBottom: "1px solid var(--border-color,#222)", cursor: "pointer" }}
            onMouseEnter={() => setHov({ name: cat.name, total_cents: cat.total_cents, pct: fmtPct(cat.total_cents, total) })}
            onMouseLeave={() => setHov(null)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color(ci), flexShrink: 0, display: "inline-block" }} />
              <span style={{ flex: 1, fontSize: 12, color: "var(--text-secondary,#ccc)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary,#888)", fontFamily: "monospace", flexShrink: 0 }}>{fmtPct(cat.total_cents, total)}</span>
              <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary,#e8e6e0)", flexShrink: 0 }}>{fmtUSD(cat.total_cents)}</span>
            </div>
            {cat.subcategories.length > 0 && (
              <div style={{ marginLeft: 18, marginTop: 2 }}>
                {cat.subcategories.map(sub => (
                  <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}
                    onMouseEnter={e => { e.stopPropagation(); setHov({ name: sub.name, total_cents: sub.total_cents, pct: fmtPct(sub.total_cents, total) }); }}
                    onMouseLeave={e => { e.stopPropagation(); setHov(null); }}>
                    <span style={{ width: 6, height: 6, borderRadius: 1, background: color(ci), opacity: 0.6, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ flex: 1, fontSize: 11, color: "var(--text-tertiary,#999)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-tertiary,#888)", fontFamily: "monospace", flexShrink: 0 }}>{fmtPct(sub.total_cents, total)}</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary,#bbb)", flexShrink: 0 }}>{fmtUSD(sub.total_cents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── date range selector ──────────────────────────────────────────────────────
function RangeSelector({ rangeType, setRangeType, fromDate, setFromDate, toDate, setToDate }) {
  const btnStyle = (active) => ({
    fontFamily: "monospace", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
    padding: "5px 12px", borderRadius: 6, cursor: "pointer", border: "none",
    background: active ? "var(--text-primary,#e8e6e0)" : "var(--bg-tertiary,#222)",
    color: active ? "var(--bg-primary,#0f0f0f)" : "var(--text-secondary,#aaa)",
  });
  const inputStyle = { fontFamily: "monospace", fontSize: 12, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "inherit", padding: "5px 10px", outline: "none" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
      {[["last30","Last 30 days"],["month","This month"],["custom","Custom"]].map(([id, lbl]) => (
        <button key={id} style={btnStyle(rangeType === id)} onClick={() => setRangeType(id)}>{lbl}</button>
      ))}
      {rangeType === "custom" && (
        <>
          <input type="date" style={inputStyle} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          <span style={{ color: "var(--text-tertiary,#666)", fontSize: 12 }}>→</span>
          <input type="date" style={inputStyle} value={toDate} onChange={e => setToDate(e.target.value)} />
        </>
      )}
    </div>
  );
}

// ── main page ────────────────────────────────────────────────────────────────
export default function CategoryBreakdown() {
  const today = () => new Date().toISOString().slice(0, 10);
  const [rangeType, setRangeType] = useState("last30");
  const [fromDate,  setFromDate]  = useState(today);
  const [toDate,    setToDate]    = useState(today);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let qs = `range=${rangeType}`;
      if (rangeType === "custom") qs += `&from=${fromDate}&to=${toDate}`;
      const d = await api.get(`/reports/category-breakdown?${qs}`);
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [rangeType, fromDate, toDate]);

  useEffect(() => {
    if (rangeType !== "custom" || (fromDate && toDate)) load();
  }, [load, rangeType, fromDate, toDate]);

  const card = { background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 };

  return (
    <div style={{ padding: "1.5rem 1.5rem 3rem", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>Category Breakdown</h1>
        <p style={{ fontSize: 12, color: "var(--text-tertiary,#888)", marginTop: 4 }}>Spending and income by category</p>
      </div>

      <RangeSelector {...{rangeType, setRangeType, fromDate, setFromDate, toDate, setToDate}} />

      {err && <div style={{ ...card, padding: "10px 14px", marginBottom: 12, color: "var(--color-danger,#ef4444)", fontSize: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary,#888)" }}>Loading…</div>
      ) : data && (
        <>
          {data.from_date && (
            <p style={{ fontSize: 11, color: "var(--text-tertiary,#666)", marginBottom: 16 }}>
              {data.from_date} → {data.to_date}
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            <div style={card}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>
                Spending
              </div>
              <div style={{ padding: 16 }}>
                <DonutChart
                  categories={data.expenses.categories}
                  totalCents={data.expenses.total_cents}
                  title="Spending"
                />
              </div>
            </div>
            <div style={card}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>
                Income
              </div>
              <div style={{ padding: 16 }}>
                <DonutChart
                  categories={data.income.categories}
                  totalCents={data.income.total_cents}
                  title="Income"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}