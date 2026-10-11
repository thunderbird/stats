import datetime as dt
import io
import json
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from stats_pipeline.athena import Athena
from stats_pipeline.atn import verify_artifacts
from stats_pipeline.cloudfront import THEME, adi_record, source_manifest
from stats_pipeline.common import digest
from stats_pipeline.config import Config
from stats_pipeline.state import Store
from stats_pipeline.website import build, purge


class MemoryS3:
    def __init__(self):
        self.data = {}
        self.fail_key = None

    def put_object(self, Bucket, Key, Body, **kw):
        if Key == self.fail_key:
            raise OSError('simulated upload failure')
        old = self.data.get(Key)
        if (kw.get('IfNoneMatch') == '*' and old is not None or
                'IfMatch' in kw and (old is None or digest(old) != kw['IfMatch'])):
            raise ClientError({'Error': {'Code': 'PreconditionFailed'}}, 'PutObject')
        self.data[Key] = Body
        return {'ETag': digest(Body)}

    def get_object(self, Bucket, Key):
        if Key not in self.data:
            raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'GetObject')
        body = self.data[Key]
        return {'Body': io.BytesIO(body), 'ETag': digest(body)}


def test_snapshot_commit_failure_keeps_current_and_can_restore(tmp_path):
    s3 = MemoryS3()
    store = Store(s3, Config('bucket'))
    (tmp_path/'data.json').write_text('{"x":1}')
    first = store.snapshot(tmp_path, 'first', {}, 'code-a', None, seed=True)
    _, etag = store.current()
    (tmp_path/'data.json').write_text('{"x":2}')
    s3.fail_key = 'prod/snapshots/second/manifest.json'
    with pytest.raises(OSError):
        store.snapshot(tmp_path, 'second', {}, 'code-b', etag)
    assert store.current()[0] == first
    store.restore(first, tmp_path/'restored')
    assert json.loads((tmp_path/'restored/data.json').read_bytes()) == {'x': 1}


def test_stale_writer_cannot_advance_current(tmp_path):
    store = Store(MemoryS3(), Config('bucket'))
    (tmp_path/'data.json').write_text('{}')
    store.snapshot(tmp_path, 'first', {}, 'a', None, seed=True)
    _, etag = store.current()
    second = store.snapshot(tmp_path, 'second', {}, 'b', etag)
    with pytest.raises(ClientError, match='PreconditionFailed'):
        store.snapshot(tmp_path, 'stale', {}, 'c', etag)
    assert store.current()[0] == second


def test_corrupt_snapshot_is_not_used(tmp_path):
    store = Store(MemoryS3(), Config('bucket'))
    (tmp_path/'data.json').write_text('{}')
    manifest = store.snapshot(tmp_path, 'first', {}, 'a', None)
    store.s3.data[manifest['files']['data.json']['key']] = b'[]'
    with pytest.raises(ValueError, match='checksum'):
        store.restore(manifest, tmp_path/'restore')


def test_old_handoff_retry_does_not_replace_new_revision():
    store = Store(MemoryS3(), Config('bucket'))
    store.ready('2026-10-10', {'revision': '20261011-new'})
    store.ready('2026-10-10', {'revision': '20261010-old'})
    body, _ = store.get('prod/atn/ready/2026-10-10.json')
    assert json.loads(body)['revision'] == '20261011-new'


@pytest.mark.parametrize('state', ['FAILED', 'CANCELLED'])
def test_athena_terminal_failures_propagate(state):
    client = Mock()
    client.start_query_execution.return_value = {'QueryExecutionId': 'query-id'}
    client.get_query_execution.return_value = {'QueryExecution': {'Status': {'State': state, 'StateChangeReason': 'cause'}}}
    with pytest.raises(RuntimeError, match='query-id: cause'):
        Athena(client, 'db', 'wg', 's3://bucket/results/').execute('SELECT 1')


def test_athena_timeout_cancels_query():
    client = Mock()
    client.start_query_execution.return_value = {'QueryExecutionId': 'query-id'}
    client.get_query_execution.return_value = {'QueryExecution': {'Status': {'State': 'RUNNING'}}}
    with pytest.raises(TimeoutError):
        Athena(client, 'db', 'wg', 's3://bucket/results/', timeout=-1).execute('SELECT 1')
    client.stop_query_execution.assert_called_once_with(QueryExecutionId='query-id')


def test_adi_preserves_legacy_merge_and_seamonkey_filter():
    rows = [['2026-10-10', THEME, '115.0', '10', ''],
            ['2026-10-10', THEME, '140.0', '20', ''],
            ['2026-10-10', THEME, '2.53', '30', ''],
            ['2026-10-10', 'addon@example', '128.0', '500', '']]
    assert adi_record(rows, {'count': 100, 'versions': {'140.0': 100}}, {'2.53'}) == {
        'count': 130, 'versions': {'115.0': 10, '140.0': 100}}


@pytest.mark.parametrize('environment,host', [('production', 'stats.thunderbird.net'),
                                             ('staging', 'stats-stage.thunderbird.net')])
def test_purge_is_exactly_one_fixed_hostname(environment, host):
    session = Mock()
    session.post.return_value.json.return_value = {'success': True}
    purge(environment, 'zone', 'secret', session)
    assert session.post.call_args.kwargs['json'] == {'hosts': [host]}
    assert 'purge_everything' not in session.post.call_args.kwargs['json']
    session.post.return_value.json.return_value = {'success': False}
    with pytest.raises(RuntimeError, match='rejected'):
        purge(environment, 'zone', 'secret', session)


def test_unknown_environment_never_sends_purge():
    session = Mock()
    with pytest.raises(ValueError):
        purge('thunderbird.net', 'zone', 'secret', session)
    session.post.assert_not_called()


def test_build_uses_snapshot_and_branch_financials(tmp_path):
    website, data = tmp_path/'website', tmp_path/'data'
    website.mkdir()
    data.mkdir()
    (website/'index.html').write_text('site')
    (website/'thunderbird_ami.json').write_text('{"stale":true}')
    (website/'financials.json').write_text('{"reviewed":true}')
    (data/'thunderbird_ami.json').write_text('{"current":true}')
    (data/'financials.json').write_text('{"old":true}')
    manifest = {'run_id': 'run', 'files': {'thunderbird_ami.json': {}, 'financials.json': {}}}
    out = tmp_path/'dist'
    build(website, data, out, manifest, 'stage-revision')
    assert json.loads((out/'thunderbird_ami.json').read_text()) == {'current': True}
    assert json.loads((out/'financials.json').read_text()) == {'reviewed': True}
    assert 'max-age=3600' in (out/'_headers').read_text()
    assert not (out/'.git').exists()


def test_atn_checks_all_five_files_before_import():
    s3 = MemoryS3()
    day, revision = '2026-10-10', 'run'
    manifest = {'day': day, 'revision': revision, 'artifacts': {}}
    for group in ['app', 'locale', 'os', 'status', 'version']:
        row = f'{day}\taddon\tapp\t140.0\t1\t\r\n' if group == 'app' else f'{day}\taddon\tdata\t1\t\r\n'
        body = row.encode()
        key = f'prod/atn/artifacts/{day}/{revision}/{group}'
        s3.data[key] = body
        manifest['artifacts'][group] = {'key': key, 'size': len(body), 'sha256': digest(body)}
    assert len(verify_artifacts(s3, 'bucket', manifest)) == 5
    s3.data[manifest['artifacts']['os']['key']] = b'wrong'
    with pytest.raises(ValueError, match='checksum'):
        verify_artifacts(s3, 'bucket', manifest)


def test_incomplete_day_is_rejected_before_athena():
    s3 = Mock()
    s3.get_paginator.return_value.paginate.return_value = [{'Contents': [
        {'Key': 'E1PQMC7BGJOP5E.2026-10-10-00.one.gz', 'ETag': 'x', 'Size': 1,
         'LastModified': dt.datetime(2026, 10, 10, tzinfo=dt.UTC)}]}]
    with pytest.raises(ValueError, match='hourly'):
        source_manifest(s3, 'atn', '2026-10-10')
