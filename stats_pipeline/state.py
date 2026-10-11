"""Immutable S3 snapshots with optimistic concurrency on the current pointer."""
import datetime as dt
import json
from pathlib import Path
import re

from botocore.exceptions import ClientError

from .common import atomic_json, digest, json_bytes


def safe_name(name):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in {".", ".."}:
        raise ValueError(f"Unsafe artifact name: {name}")
    return name


class Store:
    def __init__(self, s3, config):
        self.s3, self.config = s3, config
        self.bucket, self.prefix = config.bucket, config.prefix

    def get(self, key):
        response = self.s3.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read(), response["ETag"]

    def put(self, key, body, **conditions):
        return self.s3.put_object(Bucket=self.bucket, Key=key, Body=body,
                                  ContentType="application/json", **conditions)

    def current(self):
        try:
            body, etag = self.get(f"{self.prefix}/current.json")
        except ClientError as e:
            if e.response["Error"]["Code"] in {"NoSuchKey", "404"}:
                return None, None
            raise
        pointer = json.loads(body)
        manifest, _ = self.get(pointer["manifest_key"])
        if digest(manifest) != pointer["sha256"]:
            raise ValueError("Current manifest checksum mismatch")
        return json.loads(manifest), etag

    def restore(self, manifest, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        for name, artifact in manifest["files"].items():
            safe_name(name)
            if not artifact["key"].startswith(f"{self.prefix}/snapshots/"):
                raise ValueError("Artifact outside snapshot namespace")
            body, _ = self.get(artifact["key"])
            if len(body) != artifact["size"] or digest(body) != artifact["sha256"]:
                raise ValueError(f"Snapshot checksum mismatch: {name}")
            atomic_json(directory / name, json.loads(body))

    def snapshot(self, directory, run_id, checkpoints, revision, previous_etag, *, seed=False):
        safe_name(run_id)
        files = {}
        for path in sorted(Path(directory).glob("*.json")):
            body = path.read_bytes()
            json.loads(body)
            key = f"{self.prefix}/snapshots/{run_id}/files/{safe_name(path.name)}"
            self.put(key, body, IfNoneMatch="*")
            files[path.name] = {"key": key, "size": len(body), "sha256": digest(body)}
        if not files:
            raise ValueError("Cannot save an empty snapshot")
        manifest = {"schema": 1, "run_id": run_id, "revision": revision,
                    "created_at": dt.datetime.now(dt.UTC).isoformat(),
                    "checkpoints": checkpoints, "files": files}
        body = json_bytes(manifest)
        manifest_key = f"{self.prefix}/snapshots/{run_id}/manifest.json"
        self.put(manifest_key, body, IfNoneMatch="*")
        pointer = json_bytes({"run_id": run_id, "manifest_key": manifest_key, "sha256": digest(body)})
        if seed and previous_etag is not None:
            raise ValueError("Seed cannot replace existing state")
        conditions = {"IfMatch": previous_etag} if previous_etag else {"IfNoneMatch": "*"}
        self.put(f"{self.prefix}/current.json", pointer, **conditions)
        return manifest

    def mark_published(self, manifest, environment, revision):
        if environment not in {"production", "staging"}:
            raise ValueError("Invalid deployment environment")
        self.put(f"{self.prefix}/published/{environment}.json", json_bytes({
            "run_id": manifest["run_id"], "website_revision": revision,
            "published_at": dt.datetime.now(dt.UTC).isoformat()}))
