# =============================================================================
# routers/reports.py — Budget module: reporting endpoints
# thrive_core module `budget`
# =============================================================================
from fastapi import APIRouter, Query
from typing import Optional
from datetime import date, timedelta

from routers.auth import get_db   # platform connection (returns a conn to close)

router = APIRouter(prefix="/reports", tags=["reports"])


def resolve_range(range_type: str, from_date: Optional[str], to_date: Optional[str]):
    today = date.today()
    if range_type == "month":
        return today.replace(day=1).isoformat(), today.isoformat()
    if range_type == "custom" and from_date and to_date:
        return from_date, to_date
    return (today - timedelta(days=30)).isoformat(), today.isoformat()


def build_breakdown(rows: list, sign: int) -> list:
    """
    sign=-1  → expenses (amount_cents < 0)
    sign=1   → income   (amount_cents > 0)
    Returns list of {id, name, total_cents, subcategories:[...]}, sorted desc.
    """
    roots: dict = {}
    for row in rows:
        cents = row["total_cents"]
        if sign == -1 and cents >= 0: continue
        if sign ==  1 and cents <= 0: continue
        abs_c = abs(cents)

        root_id   = row["root_id"]   if row["root_id"]   is not None else 0
        root_name = row["root_name"] if row["root_name"] is not None else "Uncategorized"
        sub_id    = row["sub_id"]    if row["sub_id"]    is not None else 0
        sub_name  = row["sub_name"]  if row["sub_name"]  is not None else "Uncategorized"

        if root_id not in roots:
            roots[root_id] = {"id": root_id, "name": root_name, "total_cents": 0, "subcategories": {}}
        roots[root_id]["total_cents"] += abs_c

        # only add a sub-entry when it's a real subcategory (different from the root)
        if sub_id != root_id:
            subs = roots[root_id]["subcategories"]
            if sub_id not in subs:
                subs[sub_id] = {"id": sub_id, "name": sub_name, "total_cents": 0}
            subs[sub_id]["total_cents"] += abs_c

    result = []
    for root in sorted(roots.values(), key=lambda x: -x["total_cents"]):
        root["subcategories"] = sorted(root["subcategories"].values(), key=lambda x: -x["total_cents"])
        result.append(root)
    return result


@router.get("/category-transactions")
def category_transactions(
    range_type: str           = Query("last30", alias="range"),
    from_date:  Optional[str] = Query(None,     alias="from"),
    to_date:    Optional[str] = Query(None,     alias="to"),
    root_id:    int           = Query(...),   # drilled parent (0 = Uncategorized)
    sub_id:     Optional[int] = Query(None),  # specific category_id to match; omit = whole parent group
    sign:       int           = Query(-1),    # -1 expense, 1 income
):
    """Individual transactions behind a category-breakdown slice. When sub_id is
    omitted the whole parent group (the parent itself + all its children) is
    returned; when provided, only that exact category_id (a subcategory, or the
    parent itself for its 'direct' spend)."""
    d_from, d_to = resolve_range(range_type, from_date, to_date)

    where  = ["t.date >= ?", "t.date <= ?", "t.transfer_account_id IS NULL"]
    params = [d_from, d_to]
    where.append("t.amount_cents > 0" if sign == 1 else "t.amount_cents < 0")

    if sub_id is not None:
        if sub_id == 0:
            where.append("t.category_id IS NULL")
        else:
            where.append("t.category_id = ?"); params.append(sub_id)
    else:
        if root_id == 0:
            where.append("t.category_id IS NULL")
        else:
            where.append("(t.category_id = ? OR cat.parent_id = ?)"); params.extend([root_id, root_id])

    conn = get_db()
    try:
        rows = conn.execute(f"""
            SELECT t.id, t.date, t.amount_cents,
                   COALESCE(p.name, '—')             AS payee,
                   COALESCE(cat.name, 'Uncategorized') AS category_name
            FROM transactions t
            LEFT JOIN categories cat ON cat.id = t.category_id
            LEFT JOIN payees     p   ON p.id   = t.payee_id
            WHERE {' AND '.join(where)}
            ORDER BY t.date DESC, t.id DESC
        """, params).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.get("/category-breakdown")
def category_breakdown(
    range_type: str          = Query("last30", alias="range"),
    from_date:  Optional[str] = Query(None,    alias="from"),
    to_date:    Optional[str] = Query(None,    alias="to"),
):
    d_from, d_to = resolve_range(range_type, from_date, to_date)
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT
              COALESCE(parent.id,   cat.id)                    AS root_id,
              COALESCE(parent.name, cat.name, 'Uncategorized') AS root_name,
              cat.id                                            AS sub_id,
              COALESCE(cat.name, 'Uncategorized')               AS sub_name,
              SUM(t.amount_cents)                               AS total_cents
            FROM transactions t
            LEFT JOIN categories cat    ON cat.id    = t.category_id
            LEFT JOIN categories parent ON parent.id = cat.parent_id
            WHERE t.date >= ? AND t.date <= ?
              AND t.transfer_account_id IS NULL
            GROUP BY COALESCE(parent.id, cat.id), cat.id
        """, (d_from, d_to)).fetchall()
    finally:
        conn.close()

    rows      = [dict(r) for r in rows]
    expenses  = build_breakdown(rows, -1)
    income    = build_breakdown(rows,  1)
    return {
        "from_date": d_from,
        "to_date":   d_to,
        "expenses": {"total_cents": sum(c["total_cents"] for c in expenses), "categories": expenses},
        "income":   {"total_cents": sum(c["total_cents"] for c in income),   "categories": income},
    }