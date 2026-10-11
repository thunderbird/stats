import argparse
import datetime as dt
import json
import logging
from pathlib import Path
import subprocess

import boto3

from .common import atomic_json
from .config import Config
from .pipeline import run
from .state import Store
from .validation import validate
from .website import build, finish_deploy, verify


def main(argv=None):
    parser = argparse.ArgumentParser(description="Thunderbird statistics pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    seed = sub.add_parser("seed", help="Initialize an empty namespace from reviewed production JSON")
    seed.add_argument("--data", type=Path, required=True)
    seed.add_argument("--run-id", required=True)
    collect = sub.add_parser("collect")
    collect.add_argument("--data", type=Path, default=Path(".state"))
    collect.add_argument("--through", type=dt.date.fromisoformat)
    collect.add_argument("--start", type=dt.date.fromisoformat)
    collect.add_argument("--max-days", type=int, default=32)
    collect.add_argument("--refresh-week", type=dt.date.fromisoformat)
    collect.add_argument("--component", choices=["metrics", "sumo"], default="metrics")
    restore = sub.add_parser("restore")
    restore.add_argument("--data", type=Path, required=True)
    restore.add_argument("--manifest", type=Path, required=True)
    restore.add_argument("--snapshot", help="Run ID of a previous immutable snapshot")
    validation = sub.add_parser("validate")
    validation.add_argument("--data", type=Path, required=True)
    build_cmd = sub.add_parser("build")
    build_cmd.add_argument("--website", type=Path, required=True)
    build_cmd.add_argument("--data", type=Path, required=True)
    build_cmd.add_argument("--output", type=Path, required=True)
    build_cmd.add_argument("--manifest", type=Path, required=True)
    build_cmd.add_argument("--revision", required=True)
    for name in ("finish-deploy", "verify"):
        command = sub.add_parser(name)
        command.add_argument("--environment", choices=["production", "staging"], required=True)
        command.add_argument("--output", type=Path, required=True)
        if name == "finish-deploy":
            command.add_argument("--manifest", type=Path, required=True)
            command.add_argument("--revision", required=True)
        else:
            command.add_argument("--base-url")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.command == "validate":
        print(json.dumps(validate(args.data), indent=2))
        return
    if args.command == "build":
        build(args.website, args.data, args.output, json.loads(args.manifest.read_bytes()), args.revision)
        return
    if args.command == "verify":
        verify(args.environment, args.output, base_url=args.base_url)
        return
    config = Config.from_env()
    store = Store(boto3.client("s3", region_name=config.region), config)
    if args.command == "seed":
        validate(args.data)
        current, etag = store.current()
        if current is not None:
            raise ValueError("Namespace already seeded")
        manifest = store.snapshot(args.data, args.run_id, {}, "production-seed", etag, seed=True)
        print(manifest["run_id"])
    elif args.command == "restore":
        if args.snapshot:
            from .state import safe_name
            body, _ = store.get(f"{config.prefix}/snapshots/{safe_name(args.snapshot)}/manifest.json")
            manifest = json.loads(body)
        else:
            manifest, _ = store.current()
        if not manifest:
            raise ValueError("No validated snapshot")
        store.restore(manifest, args.data)
        atomic_json(args.manifest, manifest)
    elif args.command == "collect":
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        run(config, args.data, revision, through=args.through, start=args.start,
            component=args.component, max_days=args.max_days, refresh_week=args.refresh_week)
    elif args.command == "finish-deploy":
        finish_deploy(store, json.loads(args.manifest.read_bytes()), args.output,
                      args.environment, args.revision)


if __name__ == "__main__":
    main()
