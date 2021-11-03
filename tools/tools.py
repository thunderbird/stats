import collections
import datetime as dt
import json
import pyathena
import queries
import re
import settings
import urllib

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


def get_page(url):
    response = urllib.request.urlopen(url)
    json_response = json.loads(response.read())
    return json_response


def get_addon_guids():
    start_url = 'https://addons.thunderbird.net/api/v4/addons/search/?app=thunderbird&page=1&type=extension&sort=users'

    addon_data = get_page(start_url)
    addon_guids = {}
    addon_guids['main'] = set()
    addon_guids['top10'] = set()
    page_count = addon_data['page_count']

    print("Reading GUIDs from ATN API...")
    for x in range(1, page_count):
        for addon in addon_data['results']:
            addon_guids['main'].add(addon['guid'])
            if len(addon_guids['top10']) < 12:
                addon_guids['top10'].add(addon['guid'])
        addon_data = get_page(addon_data['next'])
    print("Done.")
    return addon_guids


class AthenaQuery(object):
    """Class to do queries against Athena and return results."""
    def __init__(self, date, versions = [], s3bucket=settings.s3bucket, region=settings.region):
        self.cursor = cursor = pyathena.connect(s3bucket, region).cursor(pyathena.cursor.DictCursor)
        self.date = date
        self.data = None
        self.totalusers = None
        self.versions = versions

    def _dateformat(self, num_days=0):
        """ Returns a date string with YYYY/MM/DD format(for Athena partitions) num_days
        before self.date.
        """
        return (self.date - dt.timedelta(num_days)).strftime("%Y/%m/%d")

    def _versioncond(self, versions=[]):
        """ Returns a version condition to use in a query, like
        AND (application.version LIKE '%%91%%')
        """
        v_string = "application.version LIKE '%%{version}%%'"
        string = ''
        if not versions:
            versions = self.versions
        if versions:

            string = "AND ("
            for x, version in enumerate(versions):
                if x > 0:
                    string += " OR "
                string += v_string.format(version=version)
            string += ")"
        return string

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
            "version": _versioncond(settings.release_version)
        }
        self.cursor.execute(queries.keyedscalar['users'].format(**params))
        self.data = self.cursor.fetchall()
        if not self.totalusers:
            self._totalusers(params)
        return self

    def _totalusers(self, params, pingtype=None):
        if pingtype:
            query = queries.totalusers['pingtype']
            params['pingtype'] = pingtype
        else:
            query = queries.totalusers['all']

        self.cursor.execute(query.format(**params))
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
    """ Get the total unique users for a set of versions over a time span of num_days, starting from date."""
    def __init__(self, date, num_days, versions = [], s3bucket=settings.s3bucket, region=settings.region):
        super().__init__(date, versions, s3bucket, region)
        self.num_days = num_days

    def query_totalusers(self):
        params = {
            "date1": super()._dateformat(self.num_days),
            "date2": super()._dateformat(),
            "version": super()._versioncond()
        }
        super()._totalusers(params)
        return self

class TotalAddonUsers(AthenaQuery):
    """ Get the total unique users for version over a time span of num_days, starting from date."""
    def __init__(self, date, num_days, versions = [], s3bucket=settings.s3bucket, region=settings.region):
        super().__init__(date, versions, s3bucket, region)
        self.num_days = num_days
        self.exclude = 0

    def exclude_guids(self):
        guids = list(settings.ignore_addon_guids)
        if self.exclude:
            guids += get_addon_guids()['top10']
        return '(' + '|'.join("{0}".format(re.escape(g)) for g in guids) + ')'

    def query_totalusers(self, exclude=0):
        self.exclude = exclude
        params = {
            "date1": super()._dateformat(self.num_days),
            "date2": super()._dateformat(),
            "version": super()._versioncond(),
            "guids": self.exclude_guids(),
            "pingtype": 'modules'
        }

        self.cursor.execute(queries.totalusers['addons'].format(**params))
        self.addon_totalusers = self.cursor.fetchall()[0]['_col0']
        if not self.totalusers:
            super()._totalusers(params, 'modules')
        return self
