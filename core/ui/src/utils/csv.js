// =============================================================================
// csv.js — CSV parsing, row matching, Plaid row conversion
// thrive UI
// =============================================================================

export function parseCSV(text) {
    const lines = text.trim().split('\n')
    if (lines.length < 2) return { headers: [], rows: [] }
    const headers = lines[0].split(',').map(h => h.trim())
    const rows = lines.slice(1).map(line => {
        const cols = []
        let cur = '', inQuote = false
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') { inQuote = !inQuote }
            else if (line[i] === ',' && !inQuote) { cols.push(cur.trim()); cur = '' }
            else { cur += line[i] }
        }
        cols.push(cur.trim())
        const row = {}
        headers.forEach((h, i) => row[h] = cols[i] ?? '')
        return row
    }).filter(r => Object.values(r).some(v => v !== ''))
    return { headers, rows }
}

export function matchRows(importedRows, existingTxns, mapping) {
    const dateCol = mapping.date
    const amountCol = mapping.amount
    if (!dateCol || !amountCol)
        return importedRows.map(r => ({ ...r, matched: false, _matchedId: null }))

    const existingMap = {}
    for (const t of existingTxns) {
        const key = `${t.date}|${t.amount}`
        if (!existingMap[key]) existingMap[key] = []
        existingMap[key].push(t.id)
    }
    const consumed = {}
    return importedRows.map(row => {
        const date = row[dateCol] || ''
        const amount = parseFloat(row[amountCol] || '0')
        const key = `${date}|${amount}`
        const pool = existingMap[key] || []
        const idx = consumed[key] || 0
        if (idx < pool.length) {
            consumed[key] = idx + 1
            return { ...row, matched: true, _matchedId: pool[idx] }
        }
        return { ...row, matched: false, _matchedId: null }
    })
}

export function plaidRowsToCsv(plaidRows) {
    const headers = ['date', 'description', 'amount', 'type', 'plaid_id']
    const rows = plaidRows.map(r => ({
        date: r.date || '',
        description: r.description || '',
        amount: String(r.amount ?? ''),
        type: r.type || '',
        plaid_id: r.plaid_id || '',
    }))
    return { headers, rows }
}