function format_adi_data(content) {
    let adi = {};
    adi['graph'] = [];
    adi['table'] = [];
    for (var key in content) {
        date = new Date(key);
        adi['graph'].push([date.getTime(), content[key]['count']]);
        adi['table'].push([key, content[key]['count']]);

    }
    adi['graph'] = adi['graph'].sort((a, b) => a[0] - b[0]);
    // Convert the epoch timestamp back into a date and then get a "YYYY-MM-DD" string
    // to use as index for last available day's data.
    lastday = new Date(adi['graph'][adi['graph'].length-1][0]).toISOString().substring(0,10);
    // Sort versions by # of users descending.
    let top10 = Object.entries(content[lastday]['versions']).sort((a, b) => b[1] - a[1]).slice(0,10);
    adi['top10'] = [];
    // Build an object with arrays showing all historical data for each of the top 5 versions from the last day.
    for (let version of top10) {
        let series = {name: version[0], data: []};
        for (let k in content) {
            date = new Date(k);
            let percent = ((content[k]['versions'][version[0]] || 0)/content[k]['count'])*100;
            series['data'].push([date.getTime(), percent]);
        }
        series['data'] = series['data'].sort((a, b) => a[0] - b[0]);
        adi['top10'].push(series);
    }
    return adi;
}


$.getJSON('thunderbird_adi.json', function(data) {
    var adi = format_adi_data(data);

    Highcharts.chart('line_adi', {
        chart: {
                type: 'spline'
        },
        title: {
                text: 'Active Daily Installations'
        },
        rangeSelector:{
            enabled:true
        },
        xAxis: {
                type: 'datetime',
                title: {
                        text: 'Date'
                }
        },
        yAxis: {
                title: {
                        text: '# of Installations'
                },
                min: 0
        },
        tooltip: {
                headerFormat: '<b>{series.name}</b><br>',
                pointFormat: '{point.x:%A %e %b}: {point.y} users.'
        },

        plotOptions: {
                spline: {
                        marker: {
                                enabled: true
                        }
                }
        },

        colors: ['#6CF', '#39F', '#06C', '#036', '#000'],
        series: [{name: "ADI", data: adi['graph']}]
    });

    Highcharts.chart('areaspline_versions', {
        chart: {
            type: 'areaspline'
        },
        title: {
            text: 'Top 10 Versions by ADI'
        },
        rangeSelector:{
            enabled:true
        },
        xAxis: {
            type: 'datetime',
            title: {
                 text: 'Date'
            }
        },
        yAxis: {
            title: {
                text: '# of Installations'
            },
            min: 0
        },
        tooltip: {
            valueDecimals: 2,
            headerFormat: '<b>{series.name}</b><br>',
            pointFormat: '{point.x:%A %e %b}: {point.y}% of users.'
        },

        plotOptions: {
            spline: {
                marker: {
                    enabled: true
                }
            }
        },
        series: adi['top10']
    });

    $('#adi').DataTable( {
        "searching": true,
        "bPaginate": true,
        "bInfo" : false,
        "order": [[0, "desc"]],
        data: adi['table'],
            columns: [
                { title: "Date" },
                { title: "ADI" },
            ]
    });

    $(".dataTables_wrapper").css("width","25%").css("margin", "0 auto");
});
