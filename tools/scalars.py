if __package__:
    from . import settings, tools
else:
    import settings
    import tools

import datetime
from pathlib import Path

start_date = datetime.date(2021, 1, 3)
filename = Path(__file__).parent / '../docs/telemetry.json'


def is_scalar_started(scalardate, curdate):
    """ returns True if there's no scalardate, or if the scalardate has been reached."""
    if not scalardate:
        return True
    else:
        pdate = datetime.datetime.strptime(scalardate, "%Y-%m-%d").date()
        if pdate < curdate:
            return True
        else:
            return False


def collect(data, through):
    for daystring in tools.date_range(start_date, 7, through + datetime.timedelta(days=1)):
        curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
        q = tools.AthenaQuery(curdate)
        for s in settings.keyedscalars:
            # Make sure we don't query scalars until their start dates.
            if is_scalar_started(s.get('start', None), curdate):
                dataloc = data.setdefault(s['key'], {})
                if daystring not in dataloc:
                    dataloc[daystring] = {}
                    print(s['key'], daystring)
                    d = q.keyedscalar_users(s['key']).format_data(s.get('combine', None)).json()
                    dataloc[daystring] = d
    return data


def main():
    from stats_pipeline.common import atomic_json, utc_today
    data = collect(tools.parse_cached_json(filename)["json"], utc_today() - datetime.timedelta(days=1))
    atomic_json(filename, data)


if __name__ == "__main__":
    main()
