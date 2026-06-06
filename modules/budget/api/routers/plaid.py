# =============================================================================
# plaid.py — Plaid connection management and transaction sync
# thrive API
# =============================================================================

import os
import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from routers.auth import get_db as _connect

import os, sqlite3

router = APIRouter(prefix="/plaid", tags=["plaid"])

PLAID_CLIENT_ID = os.environ.get("PLAID_CLIENT_ID", "")
PLAID_SECRET    = os.environ.get("PLAID_SECRET", "")
PLAID_URL       = os.environ.get("PLAID_URL", "https://production.plaid.com")


# ── db + money helpers ───────────────────────────────────────────────────────
def get_db():
    db = sqlite3.connect(os.environ.get("DB_FILE", "/data/thrivecore.db"), check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
    finally:
        db.close()

def to_cents(dollars: float) -> int:
    return int(round(float(dollars) * 100))

def from_cents(cents: int) -> float:
    return round((cents or 0) / 100, 2)

def init_db():
    db = _connect()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS plaid_connections (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id       INTEGER NOT NULL REFERENCES budget_accounts(id),
                access_token     TEXT NOT NULL,
                plaid_account_id TEXT NOT NULL,
                institution_name TEXT,
                created_at       TEXT DEFAULT (datetime('now'))
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ConnectionIn(BaseModel):
    account_id:       int
    access_token:     str
    plaid_account_id: str
    institution_name: Optional[str] = None


class FetchAccountsIn(BaseModel):
    access_token: str


class SyncRequest(BaseModel):
    account_id: Optional[int] = None   # None = sync all connections
    days:       Optional[int] = 30
    start_date: Optional[str] = None   # explicit override, e.g. "2026-01-01"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _plaid_post(endpoint: str, body: dict) -> dict:
    """POST to Plaid API, raise on error."""
    body["client_id"] = PLAID_CLIENT_ID
    body["secret"]    = PLAID_SECRET
    res = requests.post(
        f"{PLAID_URL}{endpoint}",
        json=body,
        timeout=30
    )
    data = res.json()
    if "error_code" in data:
        raise HTTPException(status_code=502, detail=f"Plaid error: {data.get('error_message')}")
    return data


def _fetch_plaid_transactions(access_token: str, start_date: str, end_date: str) -> list:
    """Paginate through all transactions for a given access token."""
    count  = 100
    offset = 0
    all_tx = []

    while True:
        data = _plaid_post("/transactions/get", {
            "access_token": access_token,
            "start_date":   start_date,
            "end_date":     end_date,
            "options": {
                "count":  count,
                "offset": offset
            }
        })
        all_tx.extend(data["transactions"])
        offset += count
        if offset >= data["total_transactions"]:
            break

    return all_tx


def _resolve_payee(raw_name: str, db) -> Optional[int]:
    """Look up payee_id from payee_aliases."""
    row = db.execute(
        "SELECT payee_id FROM payee_aliases WHERE raw_name = ?",
        (raw_name,)
    ).fetchone()
    return row["payee_id"] if row else None


def _find_match(account_id: int, amount_cents: int, date: str, db) -> Optional[int]:
    """
    Find an existing cleared/reconciled transaction that matches on
    account, amount, and date — not already Unverified and not already
    linked to an import.
    """
    row = db.execute(
        """SELECT id FROM transactions
           WHERE account_id = ?
             AND amount_cents = ?
             AND date = ?
             AND (cleared IS NULL OR cleared != 'Unverified')
             AND matched_transaction_id IS NULL
             AND plaid_id IS NULL
           LIMIT 1""",
        (account_id, amount_cents, date)
    ).fetchone()
    return row["id"] if row else None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/status")
def plaid_status():
    """Whether Plaid API credentials are configured — drives showing the panel."""
    return {"configured": bool(PLAID_CLIENT_ID and PLAID_SECRET)}


@router.post("/connections", status_code=201)
def add_connection(body: ConnectionIn, db=Depends(get_db)):
    """Register a Plaid access token linked to a thrive account."""
    account = db.execute(
        "SELECT id FROM budget_accounts WHERE id = ?", (body.account_id,)
    ).fetchone()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")

    cur = db.execute(
        """INSERT INTO plaid_connections
           (account_id, access_token, plaid_account_id, institution_name)
           VALUES (?, ?, ?, ?)""",
        (body.account_id, body.access_token, body.plaid_account_id, body.institution_name)
    )
    db.commit()
    return {"id": cur.lastrowid}


@router.get("/connections")
def list_connections(db=Depends(get_db)):
    """List all Plaid connections with their linked account names."""
    rows = db.execute(
        """SELECT pc.id, pc.account_id, a.name as account_name,
                  pc.plaid_account_id, pc.institution_name, pc.created_at,
                  pc.access_token
           FROM plaid_connections pc
           JOIN budget_accounts a ON a.id = pc.account_id
           ORDER BY pc.id"""
    ).fetchall()
    return [dict(r) for r in rows]


@router.delete("/connections/{connection_id}", status_code=204)
def delete_connection(connection_id: int, db=Depends(get_db)):
    """Remove a Plaid connection."""
    row = db.execute(
        "SELECT id FROM plaid_connections WHERE id = ?", (connection_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.execute("DELETE FROM plaid_connections WHERE id = ?", (connection_id,))
    db.commit()


@router.post("/fetch-accounts")
def fetch_accounts(body: FetchAccountsIn):
    """
    Given an access token, return the list of Plaid accounts so the UI
    can build the thrive account mapping form.
    """
    data = _plaid_post("/accounts/get", {"access_token": body.access_token})
    return [
        {
            "plaid_account_id": a["account_id"],
            "name":             a["name"],
            "mask":             a.get("mask"),
            "type":             a.get("type"),
            "subtype":          a.get("subtype"),
        }
        for a in data.get("accounts", [])
    ]


class PlaidImportRow(BaseModel):
    account_id:             int
    date:                   str
    amount:                 float
    description:            Optional[str] = None
    plaid_id:               Optional[str] = None
    matched_transaction_id: Optional[int] = None
    memo:                   Optional[str] = None


@router.post("/import", status_code=201)
def import_transactions(rows: list[PlaidImportRow], db=Depends(get_db)):
    """
    Commit reviewed Plaid rows to the DB as Unverified transactions.
    Runs payee alias lookup and match detection per row.
    """
    inserted = 0
    skipped  = 0

    for row in rows:
        # Dedup on plaid_id
        if row.plaid_id:
            exists = db.execute(
                "SELECT id FROM transactions WHERE plaid_id = ?",
                (row.plaid_id,)
            ).fetchone()
            if exists:
                skipped += 1
                continue

        amount_cents = to_cents(row.amount)

        # Payee alias lookup
        payee_id = _resolve_payee(row.description, db) if row.description else None

        # Match detection
        matched_id = row.matched_transaction_id or _find_match(
            row.account_id, amount_cents, row.date, db
        )

        db.execute(
            """INSERT INTO transactions
               (account_id, payee_id, category_id, amount_cents, date, memo,
                cleared, matched_transaction_id, import_description, plaid_id)
               VALUES (?, ?, NULL, ?, ?, ?, 'Unverified', ?, ?, ?)""",
            (
                row.account_id,
                payee_id,
                amount_cents,
                row.date,
                row.memo,
                matched_id,
                row.description,
                row.plaid_id,
            )
        )
        inserted += 1

    db.commit()
    return {"inserted": inserted, "skipped": skipped}


@router.post("/sync")
def sync_transactions(body: SyncRequest, db=Depends(get_db)):
    """
    Pull transactions from Plaid for one account and return them as
    preview rows — does NOT insert anything. The UI feeds these into
    the import panel for review before committing.
    account_id is required for this endpoint.
    """
    from datetime import date, timedelta

    if body.account_id is None:
        raise HTTPException(status_code=400, detail="account_id is required")

    end_date   = date.today().isoformat()
    if body.start_date:
        start_date = body.start_date
    else:
        start_date = (date.today() - timedelta(days=body.days or 30)).isoformat()

    connections = db.execute(
        "SELECT * FROM plaid_connections WHERE account_id = ?",
        (body.account_id,)
    ).fetchall()

    if not connections:
        raise HTTPException(status_code=404, detail="No Plaid connection for this account")

    rows = []
    skipped = 0

    for conn in connections:
        conn = dict(conn)
        raw_transactions = _fetch_plaid_transactions(
            conn["access_token"], start_date, end_date
        )

        # Filter to this Plaid account only
        raw_transactions = [
            t for t in raw_transactions
            if t["account_id"] == conn["plaid_account_id"]
        ]

        for tx in raw_transactions:
            # Skip pending
            if tx.get("pending"):
                skipped += 1
                continue

            # Skip already imported
            exists = db.execute(
                "SELECT id FROM transactions WHERE plaid_id = ?",
                (tx["transaction_id"],)
            ).fetchone()
            if exists:
                skipped += 1
                continue

            # Sign flip: Plaid positive = money out → thrive negative
            amount = round(-tx["amount"], 2)

            raw_name = tx.get("merchant_name") or tx.get("name") or ""

            rows.append({
                "date":        tx["date"],
                "description": raw_name,
                "amount":      amount,
                "plaid_id":    tx["transaction_id"],
                "type":        tx.get("transaction_type", ""),
            })

    return {
        "rows":    rows,
        "skipped": skipped,
        "from":    start_date,
        "to":      end_date,
    }