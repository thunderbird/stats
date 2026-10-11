"""Operator-only GitHub environments. Values are sent on stdin, never in argv/logs."""
import json
import os
from pathlib import Path
import subprocess

REPO = "thunderbird/stats"


def api(path, body):
    result = subprocess.run(['gh', 'api', '--method', 'PUT', f'repos/{REPO}/{path}', '--input', '-'],
                            input=json.dumps(body), text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'GitHub configuration failed: {path}: {result.stderr}')


def variable(name, value, environment=None):
    args = ['gh', 'variable', 'set', name, '--repo', REPO, '--body', value]
    if environment:
        args.extend(['--env', environment])
    subprocess.run(args, check=True)


def secret(name, value, environment):
    subprocess.run(['gh', 'secret', 'set', name, '--repo', REPO, '--env', environment],
                   input=value, text=True, check=True, capture_output=True)


def main():
    cache = Path(os.environ['STATS_OPERATOR_CACHE'])
    resources = json.loads((cache/'aws-resources.json').read_text())
    for environment, branches in [('stats-processing', ['master']),
                                  ('production', ['master', 'prod']), ('staging', ['master', 'stage'])]:
        api(f'environments/{environment}', {'deployment_branch_policy': {
            'protected_branches': False, 'custom_branch_policies': True}})
        existing = subprocess.check_output(['gh', 'api', f'repos/{REPO}/environments/{environment}/deployment-branch-policies'], text=True)
        names = {b['name'] for b in json.loads(existing)['branch_policies']}
        for branch in branches:
            if branch not in names:
                subprocess.run(['gh', 'api', '--method', 'POST', f'repos/{REPO}/environments/{environment}/deployment-branch-policies',
                                '-f', f'name={branch}', '-f', 'type=branch'], check=True, stdout=subprocess.DEVNULL)
        variable('AWS_ROLE_ARN', resources['roles'][environment], environment)
        variable('STATS_BUCKET', resources['bucket'], environment)
    secret('GLEAN_API_KEY', os.environ['GLEAN_API_KEY'], 'stats-processing')
    for environment, name in [('production', 'production'), ('staging', 'stage')]:
        variable('CLOUDFLARE_ACCOUNT_ID', '407a3cd7b36b3ec71bf765856c90ae8c', environment)
        variable('CLOUDFLARE_ZONE_ID', 'fc41f087fcce4577fefa863012e13de2', environment)
        secret('CLOUDFLARE_API_TOKEN', json.loads((cache/f'cloudflare-{name}-token.json').read_text())['value'], environment)
        secret('CLOUDFLARE_CACHE_PURGE_TOKEN', json.loads((cache/'cloudflare-purge-token.json').read_text())['value'], environment)
    # Leave disabled until parity, least-privilege deploy and consumer checks have passed.
    variable('STATS_SCHEDULE_ENABLED', 'false')
    variable('STATS_DEPLOY_ENABLED', 'false')
    print('GitHub environments configured; schedules and push deployment are disabled for cutover checks.')


if __name__ == '__main__':
    main()
