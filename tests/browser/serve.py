"""Build a deterministic static fixture and serve it for browser regression tests."""
import datetime as dt
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile

from stats_pipeline.common import atomic_json
from stats_pipeline.website import build, referenced_json

ROOT = Path(__file__).resolve().parents[2]


def fixture(directory):
    files = {name: {} for pattern in ("*.js", "*.mjs")
             for script in (ROOT / "docs/media/js").glob(pattern)
             for name in referenced_json(script.read_text()) if '/' not in name}
    daily = {}
    for i in range(30):
        day = str(dt.date(2026, 9, 1) + dt.timedelta(days=i))
        if i == 14:
            continue
        daily[day] = {"count": 100, "versions": {"140.3": 65, "153.0": 25, "154b1": 8, "155a1": 2},
                      "channels": {"esr": {"140.3": 65}, "release": {"153.0": 25},
                                   "beta": {"154b1": 8}, "nightly": {"155a1": 2}},
                      "channel_coverage": {"total": 100, "classified": 100, "unknown": 0}}
    old = {"2025-05-25": {"count": 100, "versions": {"old": 100}},
           "2025-06-01": {"count": 100, "versions": {"must-not-display": 100}}}
    files.update({"thunderbird_adi.json": daily,
                  "thunderbird_ami.json": {"2026-09-27": {"ami": 120, "78": .8,
                                                           "start_date": "2026-08-30"}},
                  "platforms.json": old, "locales.json": old,
                  "telemetry.json": {"legacy.metric": old},
                  "addon_stats.json": {"2025-05-25": {"total": 100, "addon_count": 20,
                                                        "minustop10_count": 10}},
                  "sumo.json": {"2026-09-27": 10},
                  "release_history.json": {"releases": [
                      {"date": "2025-07-01", "version": "140.0", "channel": "esr"},
                      {"date": "2026-09-16", "version": "153.0", "channel": "esr"}]}})
    weekly = {day: {"count": 100, "versions": {"Linux": 70, "Windows": 30}}
              for day in ["2026-09-06", "2026-09-27"]}
    files["glean.json"] = {
        "schema": 1, "window": "Monday–Sunday UTC",
        "metrics": {"accounts": {"label": "Mail accounts", "unit": "accounts",
                                  "description": "Latest account snapshot per reporting client",
                                  "records": {d: {"count": 100, "total": 200,
                                                  "versions": {"IMAP": 200}} for d in weekly}}},
        "platforms": {"records": weekly}, "locales": {"records": weekly},
        "addons": {"records": {d: {"total": 100, "addon_count": 25,
                                    "minustop10_count": 10} for d in weekly}},
    }
    files["glean.json"]["metrics"]["mail_oauth2_provider_count"] = {
        "label": "OAuth accounts", "unit": "accounts", "kind": "gauge",
        "description": "Incoming mail accounts using OAuth, from the latest weekly client snapshot.",
        "records": {d: {"count": 500, "total": 1500,
                        "versions": {"accounts.google.com": 1000, "login.microsoftonline.com": 500},
                        "label_clients": {"accounts.google.com": 400, "login.microsoftonline.com": 300}}
                    for d in weekly},
    }
    oauth_records = {}
    for day, google, microsoft in [("2026-09-06", 700, 300), ("2026-09-27", 800, 400)]:
        total = google + microsoft
        issuers = {}
        for provider, value in [("accounts.google.com", google), ("login.microsoftonline.com", microsoft)]:
            issuers[provider] = {
                "count": value // 2, "total": value,
                "breakdowns": {
                    "channel": {"release": value // 2, "esr": value // 2},
                    "version": {"153": value // 2, "140": value // 2},
                    "reason": {"no refresh token": value // 2, "invalid grant": value // 2},
                    "result": {"succeeded": value - 100, "cancelled": 100},
                    "where": {"internal": value - 100, "external": 100},
                },
            }
        oauth_records[day] = {
            "count": total // 2, "total": total, "issuers": issuers,
            "breakdowns": {
                "issuer": {"accounts.google.com": google, "login.microsoftonline.com": microsoft},
                "channel": {"release": total // 2, "esr": total // 2},
                "version": {"153": total // 2, "140": total // 2},
                "reason": {"no refresh token": total // 2, "invalid grant": total // 2},
                "result": {"succeeded": total - 200, "cancelled": 200},
                "where": {"internal": total - 200, "external": 200},
            },
        }
    files["glean.json"]["oauth"] = {"records": oauth_records}
    for name, value in files.items():
        atomic_json(directory / name, value)
    return {"run_id": "browser-fixture", "files": dict.fromkeys(files, {})}


def main():
    (ROOT / "build").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="browser-tests-", dir=ROOT / "build") as temp:
        data, output = Path(temp) / "data", Path(temp) / "site"
        data.mkdir()
        build(ROOT / "docs", data, output, fixture(data), "browser-tests")
        handler = partial(SimpleHTTPRequestHandler, directory=str(output))
        ThreadingHTTPServer(("127.0.0.1", 8878), handler).serve_forever()


if __name__ == "__main__":
    main()
