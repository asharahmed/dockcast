"""CLI entry point for dockcast_ml (docs/worker-spec.md §1.3).

WP-0 stub: parses the documented sub-commands and their arguments, then
reports "not implemented" and exits with code 2. Real command handlers land
in WP-4 (bootstrap, neighbors), WP-5 (predict, profile), and WP-6
(train, labels, metrics).
"""

from __future__ import annotations

import argparse
import sys


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

    neighbors = subparsers.add_parser("neighbors")
    neighbors.add_argument("--city", metavar="SLUG")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "predict":
        if not args.once and not args.loop:
            args.loop = True
        if args.t0 is not None and not args.once:
            parser.error("--t0 is only valid with --once")

    print(f"dockcast_ml {args.command}: not implemented", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
