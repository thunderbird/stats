import contextlib
import datetime
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

if __package__:
    from . import monthlyusers
else:
    import monthlyusers


def adi_window(end):
    return {
        (end - datetime.timedelta(days=offset)).isoformat(): {
            'count': 100,
            'versions': {'115.0': 20, '128.0': 80},
        }
        for offset in range(28)
    }


class CoverageTests(unittest.TestCase):
    end = datetime.date(2026, 6, 28)

    def test_includes_128_and_versions_above_current_release(self):
        data = adi_window(self.end)
        for row in data.values():
            row.update(count=1000, versions={
                '127.0': 100, '128.0': 100, '153.0': 100, '999.0': 700,
            })
        self.assertAlmostEqual(monthlyusers.percent_represented(self.end, data), 0.9)

    def test_ignores_weekends_even_if_missing(self):
        data = {
            day: row for day, row in adi_window(self.end).items()
            if datetime.datetime.strptime(day, '%Y-%m-%d').weekday() < 5
        }
        self.assertEqual(len(data), 20)
        self.assertAlmostEqual(monthlyusers.percent_represented(self.end, data), 0.8)

    def test_weights_weekdays_equally_instead_of_pooling_counts(self):
        data = adi_window(self.end)
        for row in data.values():
            row['versions'] = {'115.0': 10, '128.0': 90}
        data['2026-06-26'] = {
            'count': 10000, 'versions': {'115.0': 5000, '128.0': 5000},
        }
        self.assertAlmostEqual(monthlyusers.percent_represented(self.end, data), 0.88)

    def test_window_includes_end_day_and_excludes_day_28(self):
        end = datetime.date(2026, 6, 29)  # Monday
        data = adi_window(end)
        data[end.isoformat()] = {
            'count': 100, 'versions': {'115.0': 60, '128.0': 40},
        }
        data[(end - datetime.timedelta(days=28)).isoformat()] = {
            'count': 100, 'versions': {'115.0': 100},
        }
        self.assertAlmostEqual(monthlyusers.percent_represented(end, data), 0.78)

    def test_rejects_missing_empty_and_unrepresented_weekdays(self):
        for row in [None, {'count': 0, 'versions': {}},
                    {'count': 100, 'versions': {'115.0': 100}}]:
            with self.subTest(row=row):
                data = adi_window(self.end)
                if row is None:
                    del data['2026-06-26']
                else:
                    data['2026-06-26'] = row
                with self.assertRaisesRegex(ValueError, '2026-06-26'):
                    monthlyusers.percent_represented(self.end, data)

    def test_preserves_legacy_threshold(self):
        end = datetime.date(2025, 4, 27)
        data = {end.isoformat(): {
            'count': 100, 'versions': {'77.0': 10, '78.0': 10, '128.0': 80},
        }}
        self.assertAlmostEqual(monthlyusers.percent_represented(end, data), 0.9)

    def test_rejects_negative_counts_and_versions_exceeding_total(self):
        for versions in [{'115.0': -10, '128.0': 110},
                         {'115.0': 20, '128.0': 81}]:
            with self.subTest(versions=versions):
                data = adi_window(self.end)
                data['2026-06-26']['versions'] = versions
                with self.assertRaisesRegex(ValueError, '2026-06-26'):
                    monthlyusers.percent_represented(self.end, data)

    def test_total_can_include_an_unclassified_request(self):
        data = adi_window(self.end)
        for row in data.values():
            row['count'] = 101
        self.assertAlmostEqual(monthlyusers.percent_represented(self.end, data),
                               1 - 20 / 101)


class BackfillTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.filename = root / 'thunderbird_ami.json'
        self.adi_filename = root / 'thunderbird_adi.json'
        self.records = {
            '2025-04-27': {'ami': 15834199, '78': 0.987, 'start_date': '2025-03-29'},
            '2025-05-04': {'ami': 12486661, '78': 0.786, 'start_date': '2025-04-05'},
        }
        self.filename.write_text(json.dumps(self.records))
        self.filename.chmod(0o644)
        adi_data = adi_window(datetime.date(2025, 5, 4))
        adi_data.update(adi_window(datetime.date(2025, 5, 11)))
        self.adi_filename.write_text(json.dumps(adi_data))
        for name, value in [('filename', self.filename), ('adi_filename', self.adi_filename)]:
            patcher = patch.object(monthlyusers, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_main(self, dates, arguments, glean=None):
        with patch.object(monthlyusers.tools, 'date_range', return_value=iter(dates)), \
             patch.object(monthlyusers, 'query_glean_data', return_value=glean or {}) as query, \
             patch.object(monthlyusers.tools, 'TotalUsers') as legacy, \
             contextlib.redirect_stdout(io.StringIO()):
            monthlyusers.main(arguments)
        legacy.assert_not_called()
        return query

    def test_backfill_preserves_raw_counts_history_and_metadata_and_is_idempotent(self):
        dates = ['2025-04-27', '2025-05-04', '2025-05-11']
        query = self.run_main(dates, ['--recalculate'], {
            '2025-05-04': 1, '2025-05-11': 13000000,
        })
        query.assert_called_once_with()
        data = json.loads(self.filename.read_text())
        self.assertEqual(data['2025-04-27'], self.records['2025-04-27'])
        expected = dict(self.records['2025-05-04'], **{'78': 0.8})
        self.assertEqual(data['2025-05-04'], expected)
        self.assertEqual(data['2025-05-11']['ami'], 13000000)
        self.assertEqual(data['2025-05-11']['78'], 0.8)
        self.assertEqual(self.filename.stat().st_mode & 0o777, 0o644)
        before = self.filename.read_bytes()
        query = self.run_main(dates, ['--recalculate'])
        query.assert_not_called()
        self.assertEqual(self.filename.read_bytes(), before)

    def test_normal_run_keeps_existing_factors(self):
        before = self.filename.read_bytes()
        query = self.run_main(list(self.records), [])
        query.assert_not_called()
        self.assertEqual(self.filename.read_bytes(), before)

    def test_missing_glean_result_does_not_create_empty_record(self):
        self.run_main(['2025-05-11'], [], {'2025-05-04': 12486661})
        self.assertEqual(json.loads(self.filename.read_text()), self.records)

    def test_missing_historical_glean_result_stops_before_writing(self):
        before = self.filename.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Missing historical Glean'):
            self.run_main(['2025-05-04', '2025-05-11'], ['--recalculate'],
                          {'2025-05-18': 13000000})
        self.assertEqual(self.filename.read_bytes(), before)

    def test_staging_output_preserves_the_input(self):
        before = self.filename.read_bytes()
        staged = self.filename.parent / 'staged.json'
        self.run_main(['2025-05-04'], ['--recalculate', '--output', str(staged)])
        self.assertEqual(self.filename.read_bytes(), before)
        self.assertEqual(json.loads(staged.read_text())['2025-05-04']['78'], 0.8)

    def test_rejects_corrupt_cached_record_before_writing(self):
        self.records['2025-05-04'] = {}
        self.filename.write_text(json.dumps(self.records))
        before = self.filename.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Invalid cached MAU'):
            self.run_main(['2025-05-04'], ['--recalculate'])
        self.assertEqual(self.filename.read_bytes(), before)

    def test_missing_input_does_not_trigger_a_historical_rebuild(self):
        missing = self.filename.parent / 'missing.json'
        with self.assertRaises(FileNotFoundError):
            self.run_main(['2025-05-04'], ['--input', str(missing)])
        self.assertFalse(missing.exists())

    def test_invalid_later_weekday_leaves_entire_file_unchanged(self):
        self.records['2025-05-11'] = {
            'ami': 13000000, '78': 0.7, 'start_date': '2025-04-12',
        }
        self.filename.write_text(json.dumps(self.records))
        self.adi_filename.write_text(json.dumps(adi_window(datetime.date(2025, 5, 4))))
        before = self.filename.read_bytes()
        with self.assertRaisesRegex(ValueError, '2025-05-09'):
            self.run_main(['2025-05-04', '2025-05-11'], ['--recalculate'])
        self.assertEqual(self.filename.read_bytes(), before)

    def test_failed_write_leaves_original_file_unchanged(self):
        before = self.filename.read_bytes()

        def failed_dump(data, file):
            file.write('partial')
            raise OSError('simulated write failure')

        with patch.object(monthlyusers.json, 'dump', side_effect=failed_dump):
            with self.assertRaisesRegex(OSError, 'simulated write failure'):
                self.run_main(['2025-05-04'], ['--recalculate'])
        self.assertEqual(self.filename.read_bytes(), before)
        self.assertEqual(list(self.filename.parent.glob('*.tmp')), [])


class GleanAPITests(unittest.TestCase):
    def setUp(self):
        for name, value in [('_glean_cache', None), ('GLEAN_API_KEY', 'test-key')]:
            patcher = patch.object(monthlyusers, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def response(self, rows):
        result = Mock()
        result.json.return_value = {'query_result': {'data': {'rows': rows}}}
        return result

    def test_request_failure_propagates_and_is_not_cached(self):
        with patch.object(monthlyusers.requests, 'get', side_effect=OSError('offline')):
            with self.assertRaisesRegex(OSError, 'offline'):
                monthlyusers.query_glean_data()
        self.assertIsNone(monthlyusers._glean_cache)

    def test_invalid_response_is_not_cached(self):
        for rows in [[], [{'received_day': '2025-05-04', 'mau': 0}],
                     [{'received_day': '2025-05-04', 'mau': 1}] * 2]:
            with self.subTest(rows=rows):
                with patch.object(monthlyusers.requests, 'get', return_value=self.response(rows)):
                    with self.assertRaises(ValueError):
                        monthlyusers.query_glean_data()
                self.assertIsNone(monthlyusers._glean_cache)

    def test_valid_response_is_requested_once(self):
        rows = [{'received_day': '2025-05-04', 'mau': 12486661}]
        with patch.object(monthlyusers.requests, 'get', return_value=self.response(rows)) as get:
            self.assertEqual(monthlyusers.query_glean_data(), {'2025-05-04': 12486661})
            monthlyusers.query_glean_data()
        get.assert_called_once()


if __name__ == '__main__':
    unittest.main()
