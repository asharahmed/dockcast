"""CLI entry point for dockcast_ml (docs/worker-spec.md §1.3).

`bootstrap` and `neighbors` are wired to their real implementations (WP-4).
`predict` and `profile` are wired to their real implementations (WP-5).
`train`, `labels`, `metrics` are wired to their real implementations (WP-6).
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import numpy as np

from dockcast_ml import (
    config,
    db,
    gbfs_ids,
    logging_setup,
    metrics_online,
    neighbors,
    predict,
    train,
)
from dockcast_ml import labels as labels_mod
from dockcast_ml import profile as profile_mod
from dockcast_ml.bootstrap.run import run_bootstrap
from dockcast_ml.timeutil import ceil_to, holiday_set, tz_of

logger = logging.getLogger("dockcast_ml")


def build_parser() -> argparse.ArgumentParser:
    """Build the argparse CLI matching docs/worker-spec.md §1.3 exactly."""
    parser = argparse.ArgumentParser(prog="python -m dockcast_ml")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap = subparsers.add_parser("bootstrap")
    bootstrap.add_argument("--city", required=True, metavar="SLUG")
    bootstrap.add_argument("--from", dest="from_", metavar="YYYY-MM", default="2025-04")
    bootstrap.add_argument("--to", metavar="YYYY-MM", default="2026-03")
    bootstrap.add_argument("--cache-dir", metavar="DIR")
    bootstrap.add_argument("--skip-download", action="store_true")

    predict = subparsers.add_parser("predict")
    predict.add_argument("--city", metavar="SLUG")
    loop_group = predict.add_mutually_exclusive_group()
    loop_group.add_argument("--loop", action="store_true")
    loop_group.add_argument("--once", action="store_true")
    predict.add_argument("--t0", metavar="ISO8601")

    train = subparsers.add_parser("train")
    train.add_argument("--city", metavar="SLUG")
    train.add_argument("--date", metavar="YYYY-MM-DD")

    profile = subparsers.add_parser("profile")
    profile.add_argument("--city", metavar="SLUG")
    profile.add_argument("--date", metavar="YYYY-MM-DD")

    labels = subparsers.add_parser("labels")
    labels.add_argument("--city", metavar="SLUG")

    metrics = subparsers.add_parser("metrics")
    metrics.add_argument("--city", metavar="SLUG")
    metrics.add_argument("--date", metavar="YYYY-MM-DD")

    neighbors_parser = subparsers.add_parser("neighbors")
    neighbors_parser.add_argument("--city", metavar="SLUG")

    return parser


def _parse_yyyymm(s: str) -> date:
    year, month = s.split("-")
    return date(int(year), int(month), 1)


def _load_city(conn: Any, slug: str) -> dict[str, Any]:
    frame = db.fetch_df(conn, "SELECT * FROM cities WHERE slug=%(s)s", {"s": slug})
    if frame.empty:
        raise RuntimeError(f"unknown city slug: {slug}")
    return frame.iloc[0].to_dict()  # type: ignore[no-any-return]


def _cities_for(conn: Any, slug: str | None) -> list[dict[str, Any]]:
    if slug:
        return [_load_city(conn, slug)]
    frame = db.fetch_df(conn, "SELECT * FROM cities WHERE forecasting_enabled", None)
    return frame.to_dict("records")  # type: ignore[no-any-return]


def _cmd_bootstrap(cfg: config.Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg, autocommit=True)
    try:
        city = _load_city(conn, args.city)
        month_from = _parse_yyyymm(args.from_)
        month_to = _parse_yyyymm(args.to)
        cache_dir = Path(args.cache_dir) if args.cache_dir else cfg.trips_cache_dir
        summary = run_bootstrap(
            cfg, conn, city, month_from, month_to, cache_dir, skip_download=args.skip_download
        )
        logger.info("bootstrap complete", extra={"summary": summary})
        return 0
    finally:
        conn.close()


def _cmd_neighbors(cfg: config.Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg, autocommit=True)
    try:
        for city in _cities_for(conn, args.city):
            with db.worker_run(cfg, "neighbors", city["id"]) as summary:
                summary.update(neighbors.rebuild(conn, city["id"]))
        return 0
    finally:
        conn.close()


def _parse_t0(raw: str) -> datetime:
    parsed = datetime.fromisoformat(raw)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _cmd_predict(cfg: config.Config, args: argparse.Namespace) -> int:
    if args.loop:
        predict.loop(cfg, city_slug=args.city)
        return 0

    conn = db.connect(cfg, autocommit=False)
    try:
        t0 = _parse_t0(args.t0) if args.t0 else ceil_to(datetime.now(UTC), cfg.predict_interval_sec)
        states: dict[int, predict.PredictState] = {}
        for city in _cities_for(conn, args.city):
            city_id = city["id"]
            state = states.setdefault(city_id, predict.PredictState())
            with db.worker_run(cfg, "predict", city_id) as summary:
                summary.update(predict.predict_once(cfg, conn, city, t0, state))
        conn.commit()
        return 0
    finally:
        conn.close()


def _cmd_profile(cfg: config.Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg, autocommit=False)
    try:
        for city in _cities_for(conn, args.city):
            city_id = city["id"]
            tz = tz_of(city["tz"])
            target_date = date.fromisoformat(args.date) if args.date else datetime.now(UTC).astimezone(tz).date()
            with db.worker_run(cfg, "profile", city_id) as summary:
                stations_df = gbfs_ids.load_stations(conn, city_id, active_only=True)
                station_pks = stations_df["id"].to_numpy(dtype=np.int32)
                hol = holiday_set(
                    city["holiday_country"], city["holiday_subdiv"],
                    [target_date.year - 1, target_date.year, target_date.year + 1],
                )
                prof = profile_mod.build_rolling_profile(conn, city_id, tz, hol, station_pks, target_date)
                frame = prof.to_frame(target_date)
                profile_mod.write_table(conn, city_id, frame)
                summary["n_rows"] = len(frame)
                summary["built_for"] = target_date.isoformat()
        conn.commit()
        return 0
    finally:
        conn.close()


def _cmd_train(cfg: config.Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg, autocommit=False)
    try:
        for city in _cities_for(conn, args.city):
            city_id = city["id"]
            tz = tz_of(city["tz"])
            target_date = date.fromisoformat(args.date) if args.date else datetime.now(UTC).astimezone(tz).date()
            now = datetime.now(UTC)
            with db.worker_run(cfg, "train", city_id) as summary:
                summary.update(train.train_city(cfg, conn, city, target_date, now))
        conn.commit()
        return 0
    finally:
        conn.close()


def _cmd_labels(cfg: config.Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg, autocommit=False)
    try:
        for city in _cities_for(conn, args.city):
            city_id = city["id"]
            with db.worker_run(cfg, "labels", city_id) as summary:
                summary.update(labels_mod.materialise_labels(conn, city, datetime.now(UTC)))
        conn.commit()
        return 0
    finally:
        conn.close()


def _cmd_metrics(cfg: config.Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg, autocommit=False)
    try:
        for city in _cities_for(conn, args.city):
            city_id = city["id"]
            tz = tz_of(city["tz"])
            target_date = date.fromisoformat(args.date) if args.date else datetime.now(UTC).astimezone(tz).date()
            with db.worker_run(cfg, "metrics", city_id) as summary:
                summary.update(metrics_online.compute(conn, city, target_date))
        conn.commit()
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "predict":
        if not args.once and not args.loop:
            args.loop = True
        if args.t0 is not None and not args.once:
            parser.error("--t0 is only valid with --once")

    if args.command not in ("bootstrap", "neighbors", "predict", "profile", "train", "labels", "metrics"):
        print(f"dockcast_ml {args.command}: not implemented", file=sys.stderr)
        return 2

    cfg = config.load()
    logging_setup.setup(cfg.log_level)

    try:
        if args.command == "bootstrap":
            return _cmd_bootstrap(cfg, args)
        if args.command == "neighbors":
            return _cmd_neighbors(cfg, args)
        if args.command == "predict":
            return _cmd_predict(cfg, args)
        if args.command == "profile":
            return _cmd_profile(cfg, args)
        if args.command == "train":
            return _cmd_train(cfg, args)
        if args.command == "labels":
            return _cmd_labels(cfg, args)
        return _cmd_metrics(cfg, args)
    except Exception as exc:
        logger.error("command failed", extra={"error": str(exc), "command": args.command})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
