# =============================================================================
# routers/accounts.py — Budget module: financial accounts (checking/credit/…)
# thrive_core module `budget`
#
# NOTE: namespaced as `budget_accounts` (table) and `/budget/accounts` (route)
# to avoid colliding with the core auth `accounts` table (login credentials).
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import sqlite3

from routers.auth import get_db as _connect

import os, sqlite3

router = APIRouter(prefix="/budget/accounts", tags=["budget-accounts"])


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
            CREATE TABLE IF NOT EXISTS budget_accounts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL UNIQUE,
                institution   TEXT,
                number        TEXT,
                on_budget     INTEGER NOT NULL DEFAULT 1,
                vault_item_id TEXT
            )
        """)
        # manual drag-to-reorder position. Backfill once in the previous default
        # display order (on-budget first, then name) so nothing visibly shifts.
        cols = [r[1] for r in db.execute("PRAGMA table_info(budget_accounts)").fetchall()]
        if "position" not in cols:
            db.execute("ALTER TABLE budget_accounts ADD COLUMN position INTEGER")
            rows = db.execute("SELECT id FROM budget_accounts ORDER BY on_budget DESC, name").fetchall()
            for i, r in enumerate(rows):
                db.execute("UPDATE budget_accounts SET position = ? WHERE id = ?", (i, r[0]))
        db.commit()
    finally:
        db.close()

init_db()


class AccountIn(BaseModel):
    name: str
    institution: Optional[str] = None
    number: Optional[str] = None
    on_budget: Optional[bool] = True


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    institution: Optional[str] = None
    number: Optional[str] = None
    on_budget: Optional[bool] = None
    vault_item_id: Optional[str] = None


@router.get("/")
def list_accounts(db=Depends(get_db)):
    rows = db.execute("""
        SELECT a.id, a.name, a.institution, a.number, a.on_budget, a.vault_item_id, a.position,
               COALESCE((
                   SELECT SUM(amount_cents) FROM transactions
                   WHERE account_id = a.id
                   AND (cleared IS NULL OR cleared != 'Unverified')
               ), 0) as balance_cents,
               (SELECT COUNT(*) FROM scheduled    WHERE account_id = a.id) as scheduled_count,
               (SELECT COUNT(*) FROM transactions WHERE account_id = a.id) as transactions_count
        FROM budget_accounts a
        ORDER BY a.position IS NULL, a.position, a.on_budget DESC, a.name
    """).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["balance"]   = from_cents(d.pop("balance_cents"))
        d["on_budget"] = bool(d["on_budget"])
        result.append(d)
    return result


class ReorderIn(BaseModel):
    order: list[int]


@router.put("/reorder")
def reorder_accounts(body: ReorderIn, db=Depends(get_db)):
    """Persist a new manual ordering. `order` is account ids, top-to-bottom."""
    for i, account_id in enumerate(body.order):
        db.execute("UPDATE budget_accounts SET position = ? WHERE id = ?", (i, account_id))
    db.commit()
    return {"ok": True, "count": len(body.order)}


@router.get("/{account_id}")
def get_account(account_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, name, institution, number, on_budget, vault_item_id FROM budget_accounts WHERE id = ?",
        (account_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    d = dict(row)
    d["on_budget"] = bool(d["on_budget"])
    return d


@router.get("/{account_id}/balance")
def get_balance(account_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, name FROM budget_accounts WHERE id = ?", (account_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    result = db.execute(
        """SELECT COALESCE(SUM(amount_cents), 0) FROM transactions
           WHERE account_id = ? AND (cleared IS NULL OR cleared != 'Unverified')""",
        (account_id,)
    ).fetchone()
    return {"account_id": account_id, "name": row["name"], "balance": from_cents(result[0])}


@router.post("/", status_code=201)
def add_account(body: AccountIn, db=Depends(get_db)):
    try:
        next_pos = db.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM budget_accounts"
        ).fetchone()[0]
        cur = db.execute(
            "INSERT INTO budget_accounts (name, institution, number, on_budget, position) VALUES (?, ?, ?, ?, ?)",
            (body.name, body.institution, body.number, 1 if body.on_budget else 0, next_pos)
        )
        db.commit()
        return {"id": cur.lastrowid, **body.model_dump()}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Account name already exists")


@router.patch("/{account_id}")
def update_account(account_id: int, body: AccountUpdate, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, name, institution, number, on_budget, vault_item_id FROM budget_accounts WHERE id = ?",
        (account_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    new_name          = body.name          if body.name          is not None else row["name"]
    new_institution   = body.institution   if body.institution   is not None else row["institution"]
    new_number        = body.number        if body.number        is not None else row["number"]
    new_on_budget     = (1 if body.on_budget else 0) if body.on_budget is not None else row["on_budget"]
    new_vault_item_id = body.vault_item_id if body.vault_item_id is not None else row["vault_item_id"]
    try:
        db.execute(
            "UPDATE budget_accounts SET name = ?, institution = ?, number = ?, on_budget = ?, vault_item_id = ? WHERE id = ?",
            (new_name, new_institution, new_number, new_on_budget, new_vault_item_id, account_id)
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Account name already exists")
    return {
        "id":            account_id,
        "name":          new_name,
        "institution":   new_institution,
        "number":        new_number,
        "on_budget":     bool(new_on_budget),
        "vault_item_id": new_vault_item_id,
    }


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id FROM budget_accounts WHERE id = ?", (account_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    for tbl in ("scheduled", "transactions"):
        n = db.execute(
            f"SELECT COUNT(*) FROM {tbl} WHERE account_id = ?", (account_id,)
        ).fetchone()[0]
        if n > 0:
            raise HTTPException(status_code=409, detail=f"Account referenced by {n} {tbl}")
    db.execute("DELETE FROM budget_accounts WHERE id = ?", (account_id,))
    db.commit()
