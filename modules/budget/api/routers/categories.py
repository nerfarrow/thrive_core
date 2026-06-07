# =============================================================================
# routers/categories.py — Budget module: category tree
# thrive module `budget`
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import sqlite3

from routers.auth import get_db as _connect

import os, sqlite3

router = APIRouter(prefix="/categories", tags=["categories"])


# ── db ─────────────────────────────────────────────────────────────────────
def get_db():
    """Per-request connection from the platform helper, with FK enforcement."""
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
            CREATE TABLE IF NOT EXISTS categories (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT NOT NULL,
                parent_id INTEGER REFERENCES categories(id),
                UNIQUE(name, parent_id)
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()

RESERVED_NAMES = {"transfer"}


class CategoryIn(BaseModel):
    name: str
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None


@router.get("/")
def list_categories(db=Depends(get_db)):
    rows = db.execute("""
        SELECT c.id, c.name, c.parent_id, p.name as parent_name,
               (SELECT COUNT(*) FROM scheduled    WHERE category_id = c.id) as scheduled_count,
               (SELECT COUNT(*) FROM transactions WHERE category_id = c.id) as transactions_count
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        ORDER BY COALESCE(c.parent_id, c.id), c.parent_id NULLS FIRST, c.name
    """).fetchall()
    return [dict(r) for r in rows]


@router.get("/{category_id}")
def get_category(category_id: int, db=Depends(get_db)):
    row = db.execute("""
        SELECT c.id, c.name, c.parent_id, p.name as parent_name
        FROM categories c
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE c.id = ?
    """, (category_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Category not found")
    return dict(row)


@router.post("/", status_code=201)
def add_category(body: CategoryIn, db=Depends(get_db)):
    if body.name.strip().lower() in RESERVED_NAMES:
        raise HTTPException(status_code=400, detail=f"'{body.name}' is a reserved name")
    if body.parent_id is not None:
        parent = db.execute(
            "SELECT id FROM categories WHERE id = ?", (body.parent_id,)
        ).fetchone()
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent category not found")
    try:
        cur = db.execute(
            "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
            (body.name, body.parent_id)
        )
        db.commit()
        return {"id": cur.lastrowid, **body.model_dump()}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Category already exists under that parent")


@router.patch("/{category_id}")
def update_category(category_id: int, body: CategoryUpdate, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, name, parent_id FROM categories WHERE id = ?", (category_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Category not found")

    new_name      = body.name      if body.name      is not None else row["name"]
    new_parent_id = body.parent_id if body.parent_id is not None else row["parent_id"]

    if new_name.strip().lower() in RESERVED_NAMES:
        raise HTTPException(status_code=400, detail=f"'{new_name}' is a reserved name")
    if new_parent_id == category_id:
        raise HTTPException(status_code=400, detail="A category cannot be its own parent")

    try:
        db.execute(
            "UPDATE categories SET name = ?, parent_id = ? WHERE id = ?",
            (new_name, new_parent_id, category_id)
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Category already exists under that parent")
    return {"id": category_id, "name": new_name, "parent_id": new_parent_id}


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id, name FROM categories WHERE id = ?", (category_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Category not found")

    children = db.execute(
        "SELECT COUNT(*) FROM categories WHERE parent_id = ?", (category_id,)
    ).fetchone()[0]
    if children > 0:
        raise HTTPException(status_code=409, detail=f"Category has {children} subcategories")

    for tbl in ("scheduled", "transactions"):
        n = db.execute(
            f"SELECT COUNT(*) FROM {tbl} WHERE category_id = ?", (category_id,)
        ).fetchone()[0]
        if n > 0:
            raise HTTPException(status_code=409, detail=f"Category referenced by {n} {tbl}")

    db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    db.commit()