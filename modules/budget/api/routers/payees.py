# =============================================================================
# routers/payees.py — Budget module: payees, aliases, merge
# thrive module `budget`
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import sqlite3

from routers.auth import get_db as _connect

import os, sqlite3

router = APIRouter(prefix="/payees", tags=["payees"])


# ── db ─────────────────────────────────────────────────────────────────────
def get_db():
    db = sqlite3.connect(os.environ.get("DB_FILE", "/data/thrive.db"), check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
    finally:
        db.close()

def init_db():
    db = _connect()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS payees (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS payee_aliases (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                payee_id INTEGER NOT NULL REFERENCES payees(id),
                raw_name TEXT NOT NULL UNIQUE
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS payee_match_lookup (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                raw_text TEXT NOT NULL UNIQUE,
                payee_id INTEGER NOT NULL REFERENCES payees(id)
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()


class PayeeIn(BaseModel):
    name: str


class PayeeUpdate(BaseModel):
    name: str


class AliasIn(BaseModel):
    raw_name: str


class MergeIn(BaseModel):
    target_id: int


@router.get("/")
def list_payees(db=Depends(get_db)):
    rows = db.execute("""
        SELECT p.id, p.name,
               (SELECT COUNT(*) FROM scheduled    WHERE payee_id = p.id) as scheduled_count,
               (SELECT COUNT(*) FROM transactions WHERE payee_id = p.id) as transactions_count,
               (SELECT COUNT(*) FROM payee_aliases WHERE payee_id = p.id) as aliases_count
        FROM payees p
        ORDER BY LOWER(p.name)
    """).fetchall()
    return [dict(r) for r in rows]


@router.get("/{payee_id}")
def get_payee(payee_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, name FROM payees WHERE id = ?", (payee_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Payee not found")
    return dict(row)


@router.get("/{payee_id}/aliases")
def list_aliases(payee_id: int, db=Depends(get_db)):
    row = db.execute("SELECT id FROM payees WHERE id = ?", (payee_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Payee not found")
    rows = db.execute(
        "SELECT id, raw_name FROM payee_aliases WHERE payee_id = ? ORDER BY raw_name",
        (payee_id,)
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{payee_id}/aliases", status_code=201)
def add_alias(payee_id: int, body: AliasIn, db=Depends(get_db)):
    row = db.execute("SELECT id FROM payees WHERE id = ?", (payee_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Payee not found")
    try:
        cur = db.execute(
            "INSERT OR REPLACE INTO payee_aliases (raw_name, payee_id) VALUES (?, ?)",
            (body.raw_name.strip(), payee_id)
        )
        db.commit()
        return {"id": cur.lastrowid, "raw_name": body.raw_name.strip(), "payee_id": payee_id}
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/{payee_id}/aliases/{alias_id}", status_code=204)
def delete_alias(payee_id: int, alias_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id FROM payee_aliases WHERE id = ? AND payee_id = ?",
        (alias_id, payee_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Alias not found")
    db.execute("DELETE FROM payee_aliases WHERE id = ?", (alias_id,))
    db.commit()


@router.post("/{payee_id}/merge", status_code=200)
def merge_payee(payee_id: int, body: MergeIn, db=Depends(get_db)):
    """
    Merge payee_id into target_id.
    All transactions, scheduled entries, and aliases pointing at payee_id
    are re-assigned to target_id. Aliases that conflict (same raw_name already
    exists on the target) are dropped. The source payee is then deleted.
    """
    if payee_id == body.target_id:
        raise HTTPException(status_code=400, detail="Cannot merge a payee into itself")

    src = db.execute("SELECT id, name FROM payees WHERE id = ?", (payee_id,)).fetchone()
    if src is None:
        raise HTTPException(status_code=404, detail="Source payee not found")

    tgt = db.execute("SELECT id, name FROM payees WHERE id = ?", (body.target_id,)).fetchone()
    if tgt is None:
        raise HTTPException(status_code=404, detail="Target payee not found")

    # Re-point transactions
    db.execute(
        "UPDATE transactions SET payee_id = ? WHERE payee_id = ?",
        (body.target_id, payee_id)
    )

    # Re-point scheduled
    db.execute(
        "UPDATE scheduled SET payee_id = ? WHERE payee_id = ?",
        (body.target_id, payee_id)
    )

    # Re-point aliases — skip any whose raw_name already exists on the target
    db.execute("""
        UPDATE OR IGNORE payee_aliases
        SET payee_id = ?
        WHERE payee_id = ?
    """, (body.target_id, payee_id))

    # Drop any leftover aliases that failed the UPDATE OR IGNORE (duplicates)
    db.execute("DELETE FROM payee_aliases WHERE payee_id = ?", (payee_id,))

    # Delete the source payee
    db.execute("DELETE FROM payees WHERE id = ?", (payee_id,))

    db.commit()
    return {
        "merged_into": body.target_id,
        "target_name": tgt["name"],
    }


@router.post("/", status_code=201)
def add_payee(body: PayeeIn, db=Depends(get_db)):
    try:
        cur = db.execute("INSERT INTO payees (name) VALUES (?)", (body.name,))
        db.commit()
        return {"id": cur.lastrowid, "name": body.name}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Payee already exists")


@router.patch("/{payee_id}")
def update_payee(payee_id: int, body: PayeeUpdate, db=Depends(get_db)):
    row = db.execute(
        "SELECT id FROM payees WHERE id = ?", (payee_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Payee not found")
    try:
        db.execute("UPDATE payees SET name = ? WHERE id = ?", (body.name, payee_id))
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Payee name already exists")
    return {"id": payee_id, "name": body.name}


@router.delete("/{payee_id}", status_code=204)
def delete_payee(payee_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id FROM payees WHERE id = ?", (payee_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Payee not found")
    for tbl, label in [("scheduled", "scheduled"), ("transactions", "transactions"), ("payee_aliases", "aliases")]:
        n = db.execute(
            f"SELECT COUNT(*) FROM {tbl} WHERE payee_id = ?", (payee_id,)
        ).fetchone()[0]
        if n > 0:
            raise HTTPException(status_code=409, detail=f"Payee referenced by {n} {label}")
    db.execute("DELETE FROM payees WHERE id = ?", (payee_id,))
    db.commit()