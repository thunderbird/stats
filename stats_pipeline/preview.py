"""Build a local static preview without changing the checked-in datasets."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile

from .common import atomic_json, http_session
from .validation import validate_record
from .website import build


ADI_SOURCE = "https://stats.thunderbird.net/thunderbird_adi.json"


def refresh_adi(state, session=None):
    """Cache the public ADI snapshot without changing the checked-in data."""
    session = session or http_session()
    response = session.get(ADI_SOURCE, headers={"Cache-Control": "no-cache"}, timeout=60)
    response.raise_for_status()
    observations = response.json()
    if not isinstance(observations, dict) or not observations:
        raise ValueError("The public ADI snapshot must contain observations")
    for day, record in observations.items():
        validate_record("thunderbird_adi.json", day, record)
    target = Path(state) / "thunderbird_adi.json"
    if target.exists():
        previous = json.loads(target.read_bytes())
        if previous.keys() - observations.keys():
            raise ValueError("The public ADI refresh would remove cached history")
    atomic_json(target, observations)
    return observations


def prepare_preview_data(website, state, data):
    """Overlay a cached current snapshot and optional locally collected sources."""
    website, state, data = Path(website), Path(state), Path(data)
    for path in website.glob("*.json"):
        shutil.copyfile(path, data / path.name)
    for name in ("glean.json", "release_history.json", "thunderbird_adi.json"):
        local = state / name
        if local.exists():
            shutil.copyfile(local, data / name)
    snapshot = state / "thunderbird_adi.json"
    authoritative = json.loads(snapshot.read_bytes()) if snapshot.exists() else None
    if authoritative is not None:
        atomic_json(data / "adi_daily_totals.json", {
            "source": "Authoritative ADI snapshot before local channel enrichment",
            "counts": {day: record["count"] for day, record in authoritative.items()},
        })
    channels = state / "adi-channels-preview.json"
    if channels.exists():
        target = data / "thunderbird_adi.json"
        observations = json.loads(target.read_bytes())
        enrichment = json.loads(channels.read_bytes())
        # The published snapshot determines the date coverage. A channel-only
        # future day must not silently become a new daily-total observation.
        if authoritative is not None:
            enrichment = {day: record for day, record in enrichment.items() if day in authoritative}
        observations.update(enrichment)
        atomic_json(target, observations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, help="Authoritative snapshot, instead of local draft data")
    parser.add_argument("--refresh-adi", action="store_true",
                        help="Refresh the public ADI cache before building the local draft")
    args = parser.parse_args()
    if args.data and args.refresh_adi:
        parser.error("--refresh-adi cannot be combined with --data")
    root = Path(__file__).resolve().parents[1]
    if args.refresh_adi:
        observations = refresh_adi(root / ".state")
        print(f"Cached {len(observations)} ADI days through {max(observations)}")
    output = root / "build/preview"
    output.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="preview-", dir=output.parent) as temp:
        data = Path(temp) / "data"
        data.mkdir()
        if args.data is None:
            prepare_preview_data(root / "docs", root / ".state", data)
        else:
            for path in args.data.glob("*.json"):
                shutil.copyfile(path, data / path.name)
        manifest = {"run_id": "local-draft", "files": dict.fromkeys(
            (p.name for p in data.glob("*.json")), {})}
        site = Path(temp) / "site"
        files = build(root / "docs", data, site, manifest, "local-draft")
        shutil.copytree(site, output, dirs_exist_ok=True)
    print(f"Built {len(files)} static files in {output}")
    print("Preview with npm run preview (http://127.0.0.1:8877)")


if __name__ == "__main__":
    main()
