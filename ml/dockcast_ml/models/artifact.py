"""Model artifact bundles (docs/ml-spec.md §3.5, docs/worker-spec.md §7.3).

`GbmBundle`/`BdBundle` are pickled into `model_versions.artifact` (bytea).
Saving (fitting boosters/calibrators and building a bundle to write) is WP-6;
this module defines the bundle shape, the pickle codec, and the load side
used by the predictor (`load_active`, `boosters_of`).

**[decision]** `tier` is modelled as a `ClassVar` rather than a dataclass
field with a default: the worker-spec pseudocode lists it first
(`tier='gbm'`) with a default value, but a dataclass field with a default may
not precede fields without one, and `tier` is a fixed per-class discriminator
rather than per-instance data anyway. `dumps()`/`loads()` still round-trip a
`kind` key equal to `tier` in the pickled payload, matching
`docs/worker-spec.md` §7.3 exactly (`pickle.dumps(dataclasses.asdict(...) +
{'kind': tier}, protocol=5)`).
"""

from __future__ import annotations

import dataclasses
import pickle
from dataclasses import dataclass
from typing import Any, ClassVar

import lightgbm as lgb
import psycopg
from sklearn.isotonic import IsotonicRegression

from dockcast_ml import db


@dataclass
class GbmBundle:
    feature_schema_version: int
    feature_names: list[str]
    boosters: dict[str, str]  # {'bike': ..., 'dock': ..., 'cnt': ...} (Booster.model_to_string())
    calibrators: dict[str, dict[int, IsotonicRegression]]  # {'bike': {h: IsotonicRegression}, 'dock': {...}}
    train_window: tuple[str, str]
    git_sha: str
    hyperparams: dict[str, Any]
    metrics_val: dict[str, Any]
    created_at: str
    tier: ClassVar[str] = "gbm"


@dataclass
class BdBundle:
    calibrators: dict[str, dict[int, IsotonicRegression]]  # {'bike': {h: IsotonicRegression}, 'dock': {...}}
    fit_window: tuple[str, str]
    created_at: str
    tier: ClassVar[str] = "bd"


ModelBundle = GbmBundle | BdBundle


def dumps(bundle: ModelBundle) -> bytes:
    """`pickle.dumps(dataclasses.asdict(bundle) | {'kind': bundle.tier}, protocol=5)`."""
    payload = dataclasses.asdict(bundle)
    payload["kind"] = bundle.tier
    return pickle.dumps(payload, protocol=5)


def loads(data: bytes) -> ModelBundle:
    """Inverse of `dumps`; dispatches on the pickled `kind` key."""
    payload = pickle.loads(data)  # noqa: S301 -- trusted, our own artifact column
    kind = payload.pop("kind")
    if kind == "gbm":
        return GbmBundle(**payload)
    if kind == "bd":
        return BdBundle(**payload)
    raise ValueError(f"unknown model bundle kind: {kind!r}")


def boosters_of(bundle: GbmBundle) -> dict[str, lgb.Booster]:
    """Decode `bundle.boosters` (model strings) into `lgb.Booster` objects, cached on `bundle`
    (as a plain instance attribute outside the dataclass fields, so it is never pickled).
    """
    cached: dict[str, lgb.Booster] | None = getattr(bundle, "_boosters_cache", None)
    if cached is not None:
        return cached
    decoded = {name: lgb.Booster(model_str=s) for name, s in bundle.boosters.items()}
    bundle._boosters_cache = decoded  # type: ignore[attr-defined]
    return decoded


def load_active(conn: psycopg.Connection, city_id: int, tier: str) -> tuple[int, ModelBundle] | None:
    """The current `active` `model_versions` row for `(city_id, tier)`, decoded; `None` if none."""
    df = db.fetch_df(
        conn,
        "SELECT id, artifact FROM model_versions "
        "WHERE city_id=%(c)s AND tier=%(t)s AND status='active' AND artifact IS NOT NULL "
        "ORDER BY id DESC LIMIT 1",
        {"c": city_id, "t": tier},
    )
    if df.empty:
        return None
    row = df.iloc[0]
    return int(row["id"]), loads(bytes(row["artifact"]))


def load_serving_set(conn: psycopg.Connection, city_id: int) -> list[tuple[int, str, str, ModelBundle]]:
    """`(id, tier, status, bundle)` for every `active`/`shadow` model version with an artifact
    (docs/worker-spec.md §8.1 step 2's exact reload query).
    """
    df = db.fetch_df(
        conn,
        "SELECT id, tier, status, artifact FROM model_versions "
        "WHERE city_id=%(c)s AND status IN ('active','shadow') AND artifact IS NOT NULL "
        "ORDER BY id",
        {"c": city_id},
    )
    return [(int(r["id"]), r["tier"], r["status"], loads(bytes(r["artifact"]))) for _, r in df.iterrows()]


__all__ = ["GbmBundle", "BdBundle", "ModelBundle", "dumps", "loads", "boosters_of", "load_active", "load_serving_set"]
