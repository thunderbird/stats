# 0 = locale,os,version,status, 1 = table name, 2 = day formatted as 2018-07-20
count_query_string = """SELECT date, split_part(cs_uri, '/', 5) AS version, count(split_part(cs_uri, '/', 5)) AS versiontotal FROM {0}
WHERE cs_uri LIKE '%update%' GROUP BY 1, 2
"""

# 0 = locale,os,version,status, 1 = table name, 2 = day formatted as 2018-07-20
buildtarget_query_string = """SELECT date, split_part(cs_uri, '/', 7) AS version, count(split_part(cs_uri, '/', 7)) AS versiontotal FROM {0}
WHERE cs_uri LIKE '%update%' AND split_part(cs_uri, '/', 10) LIKE '%%Linux%%' GROUP BY 1, 2
"""

# 0 = table name, 1 = s3 bucket name with trailing slash.
create_log_table = """CREATE EXTERNAL TABLE {0} (
  date STRING,
  time STRING,
  edge_location STRING,
  sc_bytes INT,
  client_ip STRING,
  client_method STRING,
  cs_host STRING,
  cs_uri STRING,
  cs_status INT,
  cs_referrer STRING,
  cs_useragent STRING,
  cs_query STRING,
  cs_cookie STRING,
  edge_result_type STRING,
  host_header STRING,
  cs_protocol STRING,
  cs_bytes INT,
  time_taken STRING,
  x_forwarded_for STRING,
  ssl_cipher STRING,
  edge_response_result_type STRING,
  cs_protocol_version STRING,
  fle_status STRING,
  fle_encrypted_fields STRING
)
 ROW FORMAT DELIMITED
  FIELDS TERMINATED BY '\\t'
  ESCAPED BY '\\\\'
  LINES TERMINATED BY '\\n'
 LOCATION 's3://{1}/'
 TBLPROPERTIES (
  "skip.header.line.count"="2");
"""

drop_table_q = "DROP TABLE IF EXISTS {0}"

def create_table(table, s3bucket):
    return create_log_table.format(table, s3bucket)


def count_query(table):
    return count_query_string.format(table)


def buildtarget_query(table):
    return buildtarget_query_string.format(table)


def drop_table(table):
    return drop_table_q.format(table)


