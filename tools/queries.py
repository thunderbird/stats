
#params fieldname, date1, date2, version
keyedscalar = {
"users" : """
    WITH data AS
        (SELECT clientid,
             TRY_CAST(json_extract(payload,
             '$.processes["parent"]["keyedscalars"]["{fieldname}"]') AS MAP(VARCHAR, INTEGER)) AS keys
        FROM telemetry_data
        WHERE type='main'
                AND application.version LIKE '%%{version}%%'
                AND date BETWEEN '{date1}' AND '{date2}')
    SELECT key,
             count(DISTINCT clientid) as count
    FROM data
    CROSS JOIN UNNEST(keys) AS keys(key, count)
    WHERE count>0
    GROUP BY key
    ORDER BY count DESC;
    """
}

#params date1, date2, version
totalusers = """
    SELECT count(DISTINCT clientid)
    FROM telemetry_data
    WHERE date
        BETWEEN '{date1}'
            AND '{date2}'
            AND application.version LIKE '%%{version}%%';
"""
