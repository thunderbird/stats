if __package__:
    from . import queries, settings, tools
else:
    import queries
    import settings
    import tools

import datetime
from pathlib import Path

# First date we produced these stats.
start_date = datetime.date(2021, 1, 3)

class PlatLangUsers(tools.AthenaQuery):
    """ Get users for each platform and locale over a time span of num_days, starting from date."""
    def __init__(self, date, num_days, versions=None, s3bucket=None, region=None):
        super().__init__(date, versions, s3bucket, region)
        self.num_days = num_days

    def run_query(self, query):
        params = {
            "date1": super()._dateformat(self.num_days),
            "date2": super()._dateformat(),
            "version": super()._versioncond()
        }
        self.cursor.execute(query.format(**params))
        result = self.cursor.fetchall()
        if not self.totalusers:
            super()._totalusers(params, 'modules')
        return {
            'versions': tools.flatten(result),
            'count': self.totalusers
        }

    def query_locales(self):
        return self.run_query(queries.locale_query)

    def query_platforms(self):
        result = self.run_query(queries.platform_query)
        result['versions'] = tools.collapse(result['versions'], "Linux")
        result['versions'] = tools.collapse(result['versions'], "Darwin")
        return result

def run_locale_query(curdate, num_days):
    return PlatLangUsers(curdate, num_days, settings.legacy_telemetry_versions).query_locales()

def run_platform_query(curdate, num_days):
    return PlatLangUsers(curdate, num_days, settings.legacy_telemetry_versions).query_platforms()

def collect(data, through, func):
    num_days = 6
    for daystring in tools.date_range(start_date, 7, through + datetime.timedelta(days=1)):
        if daystring not in data:
            print(daystring)
            curdate = datetime.date.fromisoformat(daystring)
            data[daystring] = func(curdate, num_days)
    return data


def main():
    from stats_pipeline.common import atomic_json, utc_today
    for name, func in [("locales", run_locale_query), ("platforms", run_platform_query)]:
        path = Path(__file__).parent / f"../docs/{name}.json"
        data = collect(tools.parse_cached_json(path)["json"], utc_today() - datetime.timedelta(days=1), func)
        atomic_json(path, data)


if __name__ == "__main__":
    main()
