"""Price cleaning. The dataset uses 1 (and other tiny values) as a 'call for price' placeholder,
and a few offers are far off the rest, so raw min/max are not shown as they are."""
from datetime import datetime, timezone
from statistics import median

MIN_VALID_PRICE = 1_000  # toman; anything below is a placeholder
OUTLIER_FACTOR = 3.0


def valid_prices(prices: list[int | float | None]) -> list[int]:
    return [int(p) for p in prices if p is not None and p >= MIN_VALID_PRICE]


def summarize(prices: list[int | float | None]) -> dict:
    """min / max / median over valid prices, ignoring outliers once there are 3+ offers."""
    vals = valid_prices(prices)
    total = len([p for p in prices])
    if not vals:
        return {"min": None, "max": None, "median": None, "priced": 0, "contact": total}
    kept = vals
    if len(vals) >= 3:
        m = median(vals)
        kept = [v for v in vals if m / OUTLIER_FACTOR <= v <= m * OUTLIER_FACTOR] or vals
    return {
        "min": min(kept),
        "max": max(kept),
        "median": int(median(kept)),
        "priced": len(kept),
        "contact": total - len(vals),
    }


def is_outlier(price: int | None, med: int | None) -> bool:
    if price is None or med is None or price < MIN_VALID_PRICE:
        return False
    return price > med * OUTLIER_FACTOR or price < med / OUTLIER_FACTOR


def days_since(ts) -> int | None:
    if ts is None:
        return None
    if hasattr(ts, "to_native"):
        ts = ts.to_native()
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - ts).days)
