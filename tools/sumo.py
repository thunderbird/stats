"""Public SUMO counts; retained as a standalone compatibility command."""
import datetime
from pathlib import Path
from stats_pipeline.common import atomic_json, http_session, utc_today
import json
import time

start_date = datetime.date(2020, 1, 1)
filename = Path(__file__).parent / '../docs/sumo.json'


def collect(counts, through):
    session = http_session()
    for offset in range((through - start_date).days + 1):
        day = start_date + datetime.timedelta(days=offset)
        if day.isoformat() in counts:
            continue
        response = session.get('https://support.mozilla.org/api/2/question/',
                               params={'created__gt': day.isoformat(),
                                       'created__lt': (day + datetime.timedelta(days=1)).isoformat(),
                                       'product': 'thunderbird'}, timeout=60)
        response.raise_for_status()
        if 'application/json' not in response.headers.get('Content-Type', ''):
            raise RuntimeError('SUMO API returned HTML (browser challenge); existing data is preserved')
        count = response.json()['count']
        if type(count) is not int or count < 0:
            raise ValueError(f'Invalid SUMO count for {day}')
        counts[day.isoformat()] = count
        time.sleep(2)
    return counts


def main():
    with filename.open() as file:
        data = json.load(file)
    atomic_json(filename, collect(data, utc_today() - datetime.timedelta(days=1)))


if __name__ == '__main__':
    main()
