// =============================================================================
// TransactionRow.jsx — Single transaction row
// thrive UI
// =============================================================================
import { fmtMoney, fmtDate, CLEARED_LABEL, CLEARED_TITLE } from '../utils/constants'

export default function TransactionRow({
  t, showBalance, showAccount, selected, onSelect,
  onEdit, onDelete, onCycleStatus, onAccountClick, matchClass = '',
}) {
  const isIncome     = (t.amount || 0) > 0
  const isUnverified = t.cleared === 'Unverified'
  const amountClass  = isUnverified
    ? 'sched-amount unverified'
    : t.amount === 0
      ? 'sched-amount zero'
      : isIncome ? 'sched-amount income' : 'sched-amount expense'
  const clearedKey = t.cleared === null || t.cleared === undefined ? 'null' : t.cleared

  const isTransfer = !!t.transfer_account_id

  const categoryDisplay = t.has_splits
    ? <span className="split-badge">split</span>
    : (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {isTransfer && (
          <span style={{
            fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.04em',
            padding: '1px 5px', borderRadius: 3,
            background: 'rgba(99,179,237,0.12)',
            color: '#63b3ed',
            border: '1px solid rgba(99,179,237,0.25)',
            flexShrink: 0,
          }}>⇄</span>
        )}
        {t.category_name || (t.cleared === 'Unverified' ? t.import_category : null) || ''}
      </span>
    )

  return (
    <div className={`txn-row ${matchClass} ${selected ? 'txn-row--selected' : ''}`}>
      <input
        type="checkbox"
        className="txn-check"
        checked={selected}
        onChange={onSelect}
        onClick={e => e.stopPropagation()}
      />
      <button
        className={`txn-cleared txn-status-col cleared-${clearedKey}${isUnverified ? ' cleared-unverified' : ''}`}
        title={CLEARED_TITLE[clearedKey]}
        onClick={isUnverified ? onEdit : onCycleStatus}
      >
        {CLEARED_LABEL[clearedKey]}
      </button>
      <span className="txn-date">{fmtDate(t.date)}</span>
      {showAccount && (
        <span className="txn-account">
          <button className="btn btn-ghost txn-account-link" onClick={() => onAccountClick(t.account_id)}>
            {t.account_name || ''}
          </button>
        </span>
      )}
      <span className="txn-payee">
        {t.payee_name || (t.cleared === 'Unverified' ? t.import_description : null) || '—'}
      </span>
      <span className="txn-category">{categoryDisplay}</span>
      <span className="txn-memo">{t.memo || ''}</span>
      <span className={`${amountClass} txn-amount-col`}>{fmtMoney(t.amount || 0)}</span>
      {showBalance && (
        <span className="txn-balance txn-amount-col">
          {t.balance !== null && t.balance !== undefined ? fmtMoney(t.balance) : ''}
        </span>
      )}
      <div className="txn-actions">
        <button className="btn btn-ghost" onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}