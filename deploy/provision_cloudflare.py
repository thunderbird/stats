"""Operator-only token provisioning and hostname cutover for the two stats sites."""
import argparse
import json
import os
from pathlib import Path

import requests

ACCOUNT = '407a3cd7b36b3ec71bf765856c90ae8c'
ZONE = 'fc41f087fcce4577fefa863012e13de2'
TARGETS = {'production': ('thunderbird-stats', 'stats.thunderbird.net'),
           'staging': ('thunderbird-stats-stage', 'stats-stage.thunderbird.net')}


class Cloudflare:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({'X-Auth-Email': os.environ['CF_EMAIL'],
                                     'X-Auth-Key': os.environ['CF_KEY']})

    def request(self, method, path, **kwargs):
        response = self.session.request(method, f'https://api.cloudflare.com/client/v4/{path}',
                                        timeout=60, **kwargs)
        value = response.json()
        if not response.ok or not value.get('success'):
            raise RuntimeError(f'Cloudflare {path}: {value.get("errors")}')
        return value['result']


def provision_tokens(cf, cache):
    groups = cf.request('GET', f'accounts/{ACCOUNT}/tokens/permission_groups')
    group_ids = {g['name']: g['id'] for g in groups}
    workers = {w['name']: w for w in cf.request('GET', f'accounts/{ACCOUNT}/workers/workers')}
    specifications = []
    for env, (name, _) in TARGETS.items():
        worker = workers[name]  # Must already exist; tokens cannot create Workers.
        file_label = 'stage' if env == 'staging' else 'production'
        specifications.append((f'cloudflare-{file_label}-token.json', f'stats-{env} GitHub publish',
                               'Individual Workers Editor', {'com.cloudflare.edge.worker.script.'+worker['id']: '*'}))
    specifications.append(('cloudflare-purge-token.json', 'stats hostname purges', 'Cache Purge',
                           {'com.cloudflare.api.account.zone.'+ZONE: '*'}))
    for filename, name, permission, resources in specifications:
        path = cache / filename
        if path.exists():
            print(f'Keeping existing token: {name}')
            continue
        result = cf.request('POST', f'accounts/{ACCOUNT}/tokens', json={
            'name': name, 'policies': [{'effect': 'allow',
                'resources': {'com.cloudflare.api.account.'+ACCOUNT: resources},
                'permission_groups': [{'id': group_ids[permission]}]}]})
        with path.open('x', opener=lambda p, flags: os.open(p, flags, 0o600)) as file:
            json.dump(result, file)
        print(f'Created {name}: {result["id"]}')


def connect(cf, cache, environment):
    name, host = TARGETS[environment]
    backup = cache / f'dns-before-{environment}.json'
    existing = cf.request('GET', f'zones/{ZONE}/dns_records', params={'name': host})
    if not backup.exists():
        backup.write_text(json.dumps(existing, indent=2))
    if any(record['name'] != host for record in existing):
        raise ValueError('Unexpected DNS record returned')
    domains = cf.request('GET', f'accounts/{ACCOUNT}/workers/domains')
    attached = [d for d in domains if d['hostname'] == host]
    if attached:
        if len(attached) != 1 or attached[0]['service'] != name:
            raise ValueError('Hostname is already attached to a different Worker')
        print(f'{host} is already connected to {name}')
        return
    # Cloudflare rejects custom domains while an ordinary CNAME/A/AAAA exists.
    # Touch only this exact hostname; restore its records if attachment fails.
    if any(r['type'] not in {'CNAME', 'A', 'AAAA'} for r in existing):
        raise ValueError('Review unexpected DNS record types before cutover')
    removed = []
    try:
        for record in existing:
            cf.request('DELETE', f'zones/{ZONE}/dns_records/{record["id"]}')
            removed.append(record)
        cf.request('PUT', f'accounts/{ACCOUNT}/workers/domains', json={
            'hostname': host, 'service': name, 'zone_id': ZONE,
            'enabled': True, 'environment': 'production'})
    except Exception:
        for record in removed:
            fields = {k: record[k] for k in ('type', 'name', 'content', 'ttl', 'proxied', 'comment', 'tags') if k in record}
            cf.request('POST', f'zones/{ZONE}/dns_records', json=fields)
        raise
    print(f'Connected {host} to {name}; previous DNS saved in {backup}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['tokens', 'connect'])
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--environment', choices=TARGETS)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    cf = Cloudflare()
    if args.command == 'tokens':
        provision_tokens(cf, args.cache)
    else:
        if not args.environment:
            parser.error('connect requires --environment')
        connect(cf, args.cache, args.environment)


if __name__ == '__main__':
    main()
