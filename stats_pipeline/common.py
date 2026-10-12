import datetime as dt
import hashlib
import json
import logging
import os
from pathlib import Path
import tempfile

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class Failures:
    """Keep independent work running, while retaining an explicit failure result."""
    def __init__(self):
        self.errors = []

    def attempt(self, label, function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except Exception as error:
            self.record(label, error)
            return None

    def record(self, label, error):
        self.errors.append({"component": label, "error": str(error),
                            "type": type(error).__name__})
        logging.error("Failed %s: %s; continuing independent work", label, error)


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


def atomic_write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
            name = f.name
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def atomic_json(path, value):
    atomic_write(path, json_bytes(value))


def http_session():
    session = requests.Session()
    retry = Retry(total=4, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504],
                  allowed_methods={"GET", "HEAD", "POST"})
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session
