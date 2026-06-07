// =============================================================================
// FilterCombo.jsx — type-to-filter combobox for filter bars (no "create")
// thrive UI
//
// A lightweight autocomplete select: type to narrow the list, click to choose,
// ✕ to clear. Reuses the .creatable-* dropdown styles. Unlike CreatableSelect
// it never creates new records and treats every option as directly selectable
// (so a parent category can be picked as a filter).
//
// Props:
//   options      — [{ id, label }]
//   value        — selected id ('' = none)
//   onChange     — (id|'') => void   (emits String(id) or '')
//   placeholder  — input placeholder
//   width        — px width of the control (default 170)
// =============================================================================
import { useEffect, useRef, useState } from "react";

export default function FilterCombo({ options, value, onChange, placeholder = "All", width = 170 }) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const boxRef   = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(o => String(o.id) === String(value));

  // reflect external value (and option label changes) into the input text
  useEffect(() => {
    setQuery(selected ? selected.label : "");
  }, [value, options]); // eslint-disable-line react-hooks/exhaustive-deps

  // when the dropdown closes, discard any unselected typed text
  useEffect(() => {
    if (!open) setQuery(selected ? selected.label : "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // close on outside click
  useEffect(() => {
    function handler(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;

  function select(o) { onChange(String(o.id)); setQuery(o.label); setOpen(false); }
  function clear()   { onChange(""); setQuery(""); setOpen(true); inputRef.current?.focus(); }

  return (
    <div className="creatable-wrap" ref={boxRef} style={{ flex: "0 1 auto", width }}>
      <div className="creatable-input-row">
        <input
          ref={inputRef}
          className="input"
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {value && <button type="button" className="creatable-clear" onClick={clear} tabIndex={-1}>✕</button>}
      </div>
      {open && (
        <div className="creatable-dropdown">
          {filtered.slice(0, 40).map(o => (
            <div
              key={o.id}
              className={`creatable-option ${String(o.id) === String(value) ? "creatable-option--selected" : ""}`}
              onMouseDown={() => select(o)}
            >
              {o.label}
            </div>
          ))}
          {filtered.length === 0 && <div className="creatable-empty">No matches</div>}
        </div>
      )}
    </div>
  );
}
