# 0 = locale,os,version,status, 1 = table name, 2 = day formatted as 2018-07-20
by_locale_os_version_status = """SELECT date, id, {0}, count(*), updateType FROM {1}
            WHERE date = date '{2}' GROUP BY date, id, {0}, updateType;
            """
# 0 = table name, 1 = day formatted as 2018-07-20
by_app = """SELECT date, id, appID as product_guid, appVersion as product_version, count(*), updateType FROM {0}
WHERE date = date '{1}' GROUP BY date, id, appID, appVersion, updateType;
         """
# 0 = table name, 1 = s3 bucket name with trailing slash.
create_log_table = """CREATE EXTERNAL TABLE {0} (
  `Date` DATE,
  Time STRING,
  Location STRING,
  SCBytes BIGINT,
  RequestIP STRING,
  Method STRING,
  Host STRING,
  Uri STRING,
  Status INT,
  Referrer STRING,
  UserAgent STRING,
  UriQS STRING,
  Cookie STRING,
  ResultType STRING,
  RequestId STRING,
  HostHeader STRING,
  Protocol STRING,
  CSBytes BIGINT,
  TimeTaken FLOAT,
  XForwardFor STRING,
  SSLProtocol STRING,
  SSLCipher STRING,
  ResponseResultType STRING,
  CSProtocolVersion STRING,
  FleStatus STRING,
  FleEncryptedFields STRING
)
 ROW FORMAT DELIMITED
  FIELDS TERMINATED BY '\\t'
  ESCAPED BY '\\\\'
  LINES TERMINATED BY '\\n'
 LOCATION 's3://{1}/'
 TBLPROPERTIES (
  "skip.header.line.count"="2");
"""

# 0 = view name, 1 = original log table name.
create_log_view = """CREATE OR REPLACE VIEW {0} AS
SELECT date,
COALESCE(TRY(url_decode(url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'id'))), '') as id,
url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'status') as status,
url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'updateType') as updateType,
url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'version') as version,
COALESCE(TRY(url_decode(url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'appID'))), '') as appID,
url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'appVersion') as appVersion,
url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'appOS') as appOS,
url_extract_parameter(CONCAT('http://www.a.com/?', uriqs), 'locale') as locale

FROM {1}
WHERE COALESCE(TRY(url_decode(url_extract_parameter(CONCAT('http://www.a.com/?',uriqs), 'id'))), '') <> ''
"""

drop_table_q = "DROP TABLE IF EXISTS {0}"
drop_view_q = "DROP VIEW IF EXISTS {0}"

def by_type(table, type, day):
    if type == 'app':
        return by_app.format(table, day)
    elif type in ['locale', 'appos', 'status', 'version']:
        return by_locale_os_version_status.format(type, table, day)
    else:
        raise ValueError('type must be one of: locale, appos, status, version, app')


def create_table(table, s3bucket):
    return create_log_table.format(table, s3bucket)


def create_view(table, view):
    # Order flipped to keep consistent function arg ordering.
    return create_log_view.format(view, table)


def drop_table(table):
    return drop_table_q.format(table)


def drop_view(view):
    return drop_view_q.format(view)


