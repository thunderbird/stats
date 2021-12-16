#params fieldname, date1, date2, version
keyedscalar = {
"users" : """
    WITH data AS
        (SELECT clientid,
             TRY_CAST(json_extract(payload,
             '$.processes["parent"]["keyedscalars"]["{fieldname}"]') AS MAP(VARCHAR, INTEGER)) AS keys
        FROM telemetry_data
        WHERE type='main'
                {version}
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

totalusers = {
# params date1, date2, version
"all" : """
    SELECT count(DISTINCT clientid)
    FROM telemetry_data
    WHERE date
        BETWEEN '{date1}'
            AND '{date2}'
            {version};
""",
# params date1, date2, version, pingtype
"pingtype" : """
    SELECT count(DISTINCT clientid)
    FROM telemetry_data
    WHERE type='{pingtype}'
            {version}
            AND date
        BETWEEN '{date1}'
            AND '{date2}';
""",
# params date1, date2, guids, version
"addons" : """
    WITH data AS
        (SELECT clientid,
             CAST(json_extract(environment,
             '$.addons["activeaddons"]') AS MAP(VARCHAR, JSON)) AS keys
        FROM telemetry_data
        WHERE type='modules'
                {version}
                AND date
            BETWEEN '{date1}'
                AND '{date2}')
    SELECT count(DISTINCT clientid)
    FROM data
    CROSS JOIN UNNEST(keys) AS keys(key, json)
    WHERE NOT regexp_like(key, '{guids}');
"""
}

# params date1, date2, version
locale_query = """
SELECT COUNT() AS count, json_extract_scalar(environment,
         '$.settings["locale"]') AS key
FROM telemetry_data
WHERE type='modules'
        {version}
        AND date BETWEEN '{date1}' AND '{date2}'
GROUP BY json_extract_scalar(environment,
         '$.settings["locale"]')
"""

# params date1, date2, version
platform_query = """
SELECT count(id) AS count,
         CONCAT(json_extract_scalar(environment,
         '$.system["os"]["name"]'), json_extract_scalar(environment, '$.system["os"]["version"]')) AS key
FROM telemetry_data
WHERE type='modules'
        AND json_extract_scalar(environment, '$.system["os"]["name"]') IS NOT NULL
        {version}
        AND date BETWEEN '{date1}' AND '{date2}'

GROUP BY  json_extract_scalar(environment, '$.system["os"]["name"]'), json_extract_scalar(environment, '$.system["os"]["version"]')
"""
