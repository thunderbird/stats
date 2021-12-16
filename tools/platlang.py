import datetime
import json
import queries
import settings
import tools
from pathlib import Path

# First date we produced these stats.
start_date = datetime.date(2021, 1, 3)

class PlatLangUsers(tools.AthenaQuery):
    """ Get the total unique users for a set of versions over a time span of num_days, starting from date."""
    def __init__(self, date, num_days, versions = [], s3bucket=settings.s3bucket, region=settings.region):
        super().__init__(date, versions, s3bucket, region)
        self.num_days = num_days

    def query_locales(self):
        params = {
            "date1": super()._dateformat(self.num_days),
            "date2": super()._dateformat(),
            "version": super()._versioncond()
        }
        self.cursor.execute(queries.locale_query.format(**params))
        result = self.cursor.fetchall()
        if not self.totalusers:
            super()._totalusers(params, 'modules')
        return self.reformat(result)

    def reformat(self, data):
        return {
            'versions':{x['_col1']: x['_col0'] for x in data},
            'count': self.totalusers
        }


