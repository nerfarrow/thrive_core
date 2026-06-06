// =============================================================================
// BulkActionBar.jsx — Sticky bulk action bar for selected transactions
// thrive UI
// =============================================================================

import { useState } from 'react'

export default function BulkActionBar({
    count, transactions, selected,
    categories, payees,
    onClear, onDelete, onStatus, onCategory, onPayee, onVerify,
}) {
    const mainCategories = categories.filter(c => c.parent_id === null)
    const subCategories = categories.filter(c => c.parent_id !== null)

    const [catMain, setCatMain] = useState('')
    const [catSub, setCatSub] = useState('')
    const filteredSubs = subCategories.filter(c => c.parent_id === parseInt(catMain))

    const verifiableCount = transactions.filter(t =>
        selected.has(t.id) && t.cleared === 'Unverified' && t.matched_transaction_id
    ).length

    function handleCategoryApply() {
        const id = catSub || catMain || null
        onCategory(id)
    }

    return (
        <div className="bulk-bar">
            <span className="bulk-bar-count">{count} selected</span>

            <div className="bulk-bar-group">
                <button className="bulk-bar-btn bulk-bar-btn--danger" onClick={onDelete}>
                    Delete
                </button>
            </div>

            <div className="bulk-bar-divider" />

            <div className="bulk-bar-group">
                <span className="bulk-bar-label">Status</span>
                <button className="bulk-bar-btn" onClick={() => onStatus('Cleared')}>Cleared</button>
                <button className="bulk-bar-btn" onClick={() => onStatus('Reconciled')}>Reconciled</button>
                <button className="bulk-bar-btn" onClick={() => onStatus('none')}>Uncleared</button>
            </div>

            <div className="bulk-bar-divider" />

            <div className="bulk-bar-group">
                <span className="bulk-bar-label">Category</span>
                <select
                    className="bulk-bar-select"
                    value={catMain}
                    onChange={e => { setCatMain(e.target.value); setCatSub('') }}
                >
                    <option value="">— none —</option>
                    {mainCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {filteredSubs.length > 0 && (
                    <select
                        className="bulk-bar-select"
                        value={catSub}
                        onChange={e => setCatSub(e.target.value)}
                    >
                        <option value="">— any —</option>
                        {filteredSubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                )}
                <button className="bulk-bar-btn" onClick={handleCategoryApply} disabled={!catMain}>
                    Apply
                </button>
            </div>

            <div className="bulk-bar-divider" />

            <div className="bulk-bar-group">
                <span className="bulk-bar-label">Payee</span>
                <select
                    className="bulk-bar-select"
                    onChange={e => e.target.value && onPayee(e.target.value)}
                >
                    <option value="">— select —</option>
                    {payees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </div>

            {verifiableCount > 0 && (
                <>
                    <div className="bulk-bar-divider" />
                    <div className="bulk-bar-group">
                        <button className="bulk-bar-btn bulk-bar-btn--accent" onClick={onVerify}>
                            Verify {verifiableCount} matched
                        </button>
                    </div>
                </>
            )}

            <button className="bulk-bar-clear" onClick={onClear} title="Clear selection">✕</button>
        </div>
    )
}