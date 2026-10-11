import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import tempfile

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def utc_today():
    return dt.datetime.now(dt.UTC).date()


def dates(start, end, step=1):
    """Inclusive, explicit UTC calendar dates."""
    while start <= end:
        yield start
        start += dt.timedelta(days=step)


def json_bytes(value):
    return json.dumps(value, allow_nan=False, separators=(",", ":")).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
            name = f.name
            f.write(json_bytes(value))
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def http_session():
    session = requests.Session()
    retry = Retry(total=4, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods={"GET", "HEAD", "POST"})
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session
