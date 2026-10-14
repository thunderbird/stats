"""Build and verify a plain static bundle, then purge one fixed hostname."""
import json
import os
from pathlib import Path
import re
import shutil
import time

from .common import atomic_json, digest, http_session
from .browser_data import prepare

HOSTS = {"production": "stats.thunderbird.net", "staging": "stats-stage.thunderbird.net"}


def referenced_json(script):
    """Literal JSON dependencies shared by the static build and browser fixture."""
    return re.findall(r'''(?:getJSON|json|fetch)\(\s*['"]([^'"]+\.json)['"]''', script)


def verify_data_files(output):
    output = Path(output)
    for script in list(output.rglob('*.js')) + list(output.rglob('*.mjs')):
        for name in referenced_json(script.read_text()):
            if '://' not in name and not (output/name).is_file():
                raise ValueError(f'Missing JSON referenced by {script.name}: {name}')
    index = output / 'data/index.json'
    if index.exists():
        manifest = json.loads(index.read_text())
        names = [part['file'] for part in manifest['adi']['files']]
        names += [manifest['adi'].get('totals'), manifest.get('glean'), manifest.get('releases')]
        for name in filter(None, names):
            if Path(name).name != name or not (index.parent/name).is_file():
                raise ValueError(f'Missing JSON referenced by data/index.json: {name}')


def hostname(environment):
    try:
        return HOSTS[environment]
    except KeyError:
        raise ValueError("Choose production or staging") from None


def build(website, data, output, manifest, revision):
    website, data, output = Path(website), Path(data), Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Build directory must be empty")
    output.mkdir(parents=True, exist_ok=True)
    for path in website.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Symlink in website: {path}")
        relative = path.relative_to(website)
        if any(part.startswith('.') for part in relative.parts):
            continue
        if path.is_file() and path.suffix != '.json':
            target = output/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    # Only explicitly hand-maintained JSON is sourced from the website branch.
    for name in ("financials.json", "oauth.json"):
        if (website/name).exists():
            shutil.copyfile(website/name, output/name)
    for name in manifest["files"]:
        if name not in {"financials.json", "oauth.json"}:
            if name == "glean.json":
                from .glean import sanitize_public
                atomic_json(output/name, sanitize_public(json.loads((data/name).read_text())))
            else:
                shutil.copyfile(data/name, output/name)
    prepare(data, output)
    (output/"_headers").write_text("/*\n  Cache-Control: public, max-age=3600\n")
    atomic_json(output/"deployment.json", {"snapshot": manifest["run_id"], "website_revision": revision})
    files = [p for p in output.rglob('*') if p.is_file()]
    if len(files) > 20000 or any(p.stat().st_size > 25*1024**2 for p in files):
        raise ValueError("Static asset limit exceeded")
    if not (output/"index.html").is_file():
        raise ValueError("Missing index.html")
    verify_data_files(output)
    return {str(p.relative_to(output)): digest(p.read_bytes()) for p in files if p.name != '_headers'}


def purge(environment, zone_id, token, session=None):
    host = hostname(environment)
    session = session or http_session()
    response = session.post(f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache",
                            headers={"Authorization": f"Bearer {token}"},
                            json={"hosts": [host]}, timeout=60)
    response.raise_for_status()
    if response.json().get("success") is not True:
        raise RuntimeError(f"Cache purge rejected for {host}")


def verify(environment, directory, *, base_url=None, attempts=6):
    # base_url is for the pre-cutover workers.dev check; normal deployments use fixed hosts.
    base = base_url or f"https://{hostname(environment)}"
    directory = Path(directory)
    session = http_session()
    for attempt in range(attempts):
        try:
            for name in ["deployment.json", "index.html", "thunderbird_ami.json", "thunderbird_adi.json"]:
                response = session.get(f"{base}/{name}", headers={"Cache-Control": "no-cache"}, timeout=60)
                response.raise_for_status()
                if digest(response.content) != digest((directory/name).read_bytes()):
                    raise ValueError(f"Live {name} differs from deployment")
                directives = {p.strip() for p in response.headers.get("Cache-Control", "").split(',')}
                if "max-age=3600" not in directives or "public" not in directives:
                    raise ValueError(f"Unexpected cache policy on {name}")
            return
        except (ValueError, OSError):
            if attempt == attempts-1:
                raise
            time.sleep(5*(attempt+1))


def finish_deploy(store, manifest, directory, environment, revision):
    purge(environment, os.environ["CLOUDFLARE_ZONE_ID"], os.environ["CLOUDFLARE_CACHE_PURGE_TOKEN"])
    verify(environment, directory)
    store.mark_published(manifest, environment, revision)
