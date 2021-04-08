import collections
import datetime as dt
import json
import pyathena
import queries
import settings

def collapse(data, stringcmp):
    result = collections.OrderedDict({stringcmp: 0})
    for k in data.keys():
        if stringcmp in k or stringcmp.lower() in k:
            result[stringcmp] += data[k]
        else:
            result[k] = data[k]
    return result


def flatten(data):
    result = collections.OrderedDict()
    for d in data:
        result[d['key']] = d['count']
    return result

# Athena data is stored in S3 using UTC, so use that to determine when to query.
def date_range(start, increment, end=dt.datetime.now(dt.timezone.utc).date()):
    while start < end:
        yield start.strftime("%Y-%m-%d")
        start += dt.timedelta(days=increment)


def parse_cached_json(outfile_name):
    """Pull data from JSON file if it exists."""
    data = {}
    try:
        with open(outfile_name, 'r') as infile:
            data['json'] = json.load(infile)
    except EnvironmentError:
        data['json'] = {}
    return data


class AthenaQuery(object):
    """Class to do queries against Athena and return results."""
    def __init__(self, date, s3bucket=settings.s3bucket, region=settings.region):
        self.cursor = cursor = pyathena.connect(s3bucket, region).cursor(pyathena.cursor.DictCursor)
        self.date = date
        self.data = None
        self.totalusers = None

    def _dateformat(self, num_days=0):
        """ Returns a date string with YYYY/MM/DD format(for Athena partitions) num_days
        before self.date.
        """
        return (self.date - dt.timedelta(num_days)).strftime("%Y/%m/%d")

    def format_data(self, combine=None):
        if self.data:
            self.data = flatten(self.data)
            if combine:
                for c in combine:
                    self.data = collapse(self.data, c)
        return self

    def keyedscalar_users(self, fieldname, num_days=6):
        params = {
            "fieldname": fieldname,
            "date1": self._dateformat(num_days),
            "date2": self._dateformat(),
            "version": settings.release_version
        }
        self.cursor.execute(queries.keyedscalar['users'].format(**params))
        self.data = self.cursor.fetchall()
        if not self.totalusers:
            self._totalusers(params)
        return self

    def _totalusers(self, params):
        self.cursor.execute(queries.totalusers.format(**params))
        self.totalusers = self.cursor.fetchall()[0]['_col0']
        return self

    def json(self):
        # This needs to be changed from "versions" to "keys".
        data = {'count': self.totalusers, 'versions':collections.OrderedDict()}
        if self.data:
            for d in self.data.keys():
                data['versions'][d] = self.data[d]
        return data

class TotalUsers(AthenaQuery):
    """ Get the total unique users for version over a time span of num_days, starting from date."""
    def __init__(self, date, version, num_days, s3bucket=settings.s3bucket, region=settings.region):
        super().__init__(date, s3bucket, region)
        self.version = version
        self.num_days = num_days

    def query_totalusers(self):
        params = {
            "date1": super()._dateformat(self.num_days),
            "date2": super()._dateformat(),
            "version": self.version
        }
        super()._totalusers(params)
        return self
