import datetime
import json
import queries
import settings
import tools
from pathlib import Path

# First date we produced these stats.
start_date = datetime.date(2021, 1, 3)

class PlatLangUsers(tools.AthenaQuery):
    """ Get users for each platform and locale over a time span of num_days, starting from date."""
    def __init__(self, date, num_days, versions = [], s3bucket=settings.s3bucket, region=settings.region):
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
    return PlatLangUsers(curdate, num_days, settings.release_version).query_locales()

def run_platform_query(curdate, num_days):
    return PlatLangUsers(curdate, num_days, settings.release_version).query_platforms()

def weekly(start_date, filename, func):
    """ Run func once per week and store the data in JSON. """
    # Number of days to query between, SQL Between is inclusive so this is 7 days of actual data.
    num_days = 6
    dataloc = tools.parse_cached_json(filename)['json']
    for daystring in tools.date_range(start_date, num_days+1):
        if daystring not in dataloc:
            dataloc[daystring] = {}
            print(daystring)
            curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
            dataloc[daystring] = func(curdate, num_days)
        with open(filename, 'w') as file:
            json.dump(dataloc, file)

# Number of users per locale code.
locale_file = Path(__file__).parent / '../docs/locales.json'
weekly(start_date, locale_file, run_locale_query)

# Number of users per platform.
platform_file = Path(__file__).parent / '../docs/platforms.json'
weekly(start_date, platform_file, run_platform_query)
