// =============================================================================
// constants.js — Shared constants and formatters
// thrive UI
// =============================================================================

export const CLEARED_LABEL = {
    null: '○',
    Cleared: '◐',
    Reconciled: '●',
    Unverified: '⚠',
}

export const CLEARED_TITLE = {
    null: 'Uncleared',
    Cleared: 'Cleared',
    Reconciled: 'Reconciled',
    Unverified: 'Unverified — click to edit',
}

export const FIELD_META = {
    date: { label: 'Date', color: '#6366f1', required: true },
    payee: { label: 'Payee', color: '#f59e0b', required: true },
    category: { label: 'Category', color: '#10b981', required: true },
    memo: { label: 'Memo', color: '#8b5cf6', required: false },
    amount: { label: 'Amount', color: '#ef4444', required: true },
}

export const FIELDS = ['date', 'payee', 'category', 'memo', 'amount']

export const SYNC_OPTIONS = [
    { label: 'Last 7 days', days: 7, start_date: null },
    { label: 'Last 14 days', days: 14, start_date: null },
    { label: 'Last 30 days', days: 30, start_date: null },
    { label: 'Last 60 days', days: 60, start_date: null },
    { label: 'Last 90 days', days: 90, start_date: null },
    { label: 'Year to date', days: null, start_date: `${new Date().getFullYear()}-01-01` },
]

export const fmtMoney = (n) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const fmtDate = (s) => {
    if (!s) return ''
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const todayStr = () => new Date().toISOString().slice(0, 10)