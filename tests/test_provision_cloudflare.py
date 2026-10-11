from unittest.mock import Mock

import pytest

from deploy.provision_cloudflare import ACCOUNT, ZONE, connect


def test_failed_hostname_attachment_restores_only_target_record(tmp_path):
    record = {'id': 'record', 'type': 'CNAME', 'name': 'stats-stage.thunderbird.net',
              'content': 'stage.thunderbird.net', 'ttl': 1, 'proxied': False}
    cf = Mock()
    cf.request.side_effect = [[record], [], {}, RuntimeError('attachment failed'), {}]
    with pytest.raises(RuntimeError, match='attachment failed'):
        connect(cf, tmp_path, 'staging')
    calls = cf.request.call_args_list
    assert calls[2].args == ('DELETE', f'zones/{ZONE}/dns_records/record')
    assert calls[3].args == ('PUT', f'accounts/{ACCOUNT}/workers/domains')
    assert calls[3].kwargs['json']['hostname'] == record['name']
    assert calls[4].args == ('POST', f'zones/{ZONE}/dns_records')
    assert calls[4].kwargs['json'] == {k: v for k, v in record.items() if k != 'id'}


def test_hostname_attachment_never_replaces_another_worker(tmp_path):
    cf = Mock()
    cf.request.side_effect = [[], [{'hostname': 'stats-stage.thunderbird.net', 'service': 'other'}]]
    with pytest.raises(ValueError, match='different Worker'):
        connect(cf, tmp_path, 'staging')
    assert all(call.args[0] == 'GET' for call in cf.request.call_args_list)
