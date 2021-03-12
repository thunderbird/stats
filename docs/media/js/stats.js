$( document ).ready(function() {
    // Yeah all of this is a horrible hack just to make the tabs linkable.
    let tabs = ["ami", "default", "beta", "version", "addons",
                "platlang", "financials"];

    $("#tab1").prop('checked', true);
    for (let i in tabs) {
        if (window.location.hash == "#" + tabs[i]) {
            $("#tab"+i).prop('checked', true);
        }

        $("#" + tabs[i] +"_tab").click(function() {
            $("#tab"+i).prop('checked', true);
        });
    }
});

function format_financial_data(content) {
    let data = {}
    data['monthly'] = []
    data['spending'] = content['spending'];
    data['yearly'] = content['donations_yearly'];
    let startYear = ''
    for (let y in content['donations_monthly']) {
        if (!startYear) {
            startYear = y;
        }
        data['yearly'][y] = 0;
        let series = {name: y, data: []}
        for (let m in content['donations_monthly'][y]) {
            let value = content['donations_monthly'][y][m]
            let date = new Date(startYear+'-'+m+'-'+'01');
            series['data'].push([date.getTime(), value])
            data['yearly'][y] += value;
        }
        data['monthly'].push(series)
    }

    let yearlydata = []
    for (let y in data['yearly']) {
        yearlydata.push({name: y, y: data['yearly'][y]});
    }
    data['yearly'] = [{data: yearlydata}, content['spending'][0]]
    return data
}

function format_ami_data(content) {
    let ami = {};
    ami['graph'] = [];
    ami['table'] = [];
    for (var key in content) {
        date = new Date(key);

        count = (content[key]['ami'] / content[key]['78']) | 0;
        ami['graph'].push([date.getTime(), count]);
        ami['table'].push([key, count]);
    }
    ami['graph'] = ami['graph'].sort((a, b) => a[0] - b[0]);
    return ami;
}

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
    let uptake = Object.entries(content[lastday]['versions']).sort((a, b) => b[1] - a[1]);
    adi['uptake'] = [];
    // Build an object with arrays showing percentage of users for each version relative to total.
    for (let version of uptake) {
        let series = {name: version[0], data: []};
        for (let k in content) {
            date = new Date(k);
            let percent = ((content[k]['versions'][version[0]] || 0)/content[k]['count'])*100;
            series['data'].push([date.getTime(), percent]);
        }
        series['data'] = series['data'].sort((a, b) => a[0] - b[0]);
        adi['uptake'].push(series);
    }
    return adi;
}

function format_beta_adi(content) {
    let adi = {};
    adi['graph'] = [];
    adi['table'] = [];
    for (var key in content) {
        date = new Date(key);
        adi['graph'].push([date.getTime(), content[key]['count']]);
        adi['table'].push([key, content[key]['count']]);

    }
    adi['graph'] = adi['graph'].sort((a, b) => a[0] - b[0]);

    lastday = new Date(adi['graph'][adi['graph'].length-1][0]).toISOString().substring(0,10);

    // Sort versions by # of users descending.
    let betas = Object.entries(content[lastday]['versions']).sort((a, b) => b[1] - a[1]);
    adi['betas'] = [];
    // Build an object with arrays showing percentage of users for each version relative to total.
    for (let version of betas) {
        let series = {name: version[0], data: []};
        for (let k in content) {
            date = new Date(k);
            series['data'].push([date.getTime(), content[k]['versions'][version[0]]]);
        }
        series['data'] = series['data'].sort((a, b) => a[0] - b[0]);
        adi['betas'].push(series);
    }
    return adi;
}

function format_addon_stats(content) {
    let data = [];
    data[0] = {'data':[], 'name': 'User % of Total'}
    data[1] = {'data':[], 'name': 'User % Except Top10 Add-ons'}
    for (var key in content) {
        date = new Date(key);
        data[0]['data'].push([date.getTime(), (content[key]['addon_count'] / content[key]['total']) * 100]);
        data[1]['data'].push([date.getTime(), (content[key]['minustop10_count'] / content[key]['total']) * 100]);
    }
    data[0]['data'] = data[0]['data'].sort((a, b) => a[0] - b[0]);
    data[1]['data'] = data[1]['data'].sort((a, b) => a[0] - b[0]);

    return data;
}

adi_uptake_options = {
    chart: {
        type: 'areaspline'
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
            text: '% of Installations'
        },
        min: 0
    },
    tooltip: {
        valueDecimals: 2,
        headerFormat: '<b>{series.name}</b><br>',
        pointFormat: '<b>{series.name}</b>: {point.x:%A %e %b %Y}: {point.y}% of users.'
    },
    plotOptions: {
        spline: {
            marker: {
                enabled: true
            }
        },
        series: {
            showInLegend: true
        }
    },
   legend: {
        enabled: true
    },
    navigator: {
        enabled: false
    },
    scrollbar: {
        enabled: false
    },
}

beta_adi_options = {
    xAxis: {
            type: 'datetime',
    },
    yAxis: {
            title: {
                    text: '# of Installations'
            },
            min: 0
    },
    tooltip: {
            headerFormat: '<b>{series.name}</b><br>',
            pointFormat: '{series.name} {point.x:%A %e %b %Y}: {point.y} users.'
    },

    legend: {
        enabled: true
    },

    plotOptions: {
        series: {
            showInLegend: true
        }
    },

    navigator: {
        enabled: false
    },

    scrollbar: {
        enabled: false
    },

    rangeSelector: {
        selected: 4
    },

    colors: ['#6CF', '#39F', '#06C', '#036', '#000'],
};

user_count_options = {
    chart: {
        type: 'line'
    },
    rangeSelector:{
        enabled:true,
        selected: 4
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
        valueDecimals: 0,
        headerFormat: '<b>{series.name}</b><br>',
        pointFormat: '{series.name} {point.x:%A %e %b %Y}: {point.y} users.'
    },
    plotOptions: {
        series: {
            showInLegend: true
        }
    },
   legend: {
        enabled: true
    },
    navigator: {
        enabled: false
    },
    scrollbar: {
        enabled: false
    },

colors: ['#6CF', '#39F', '#06C', '#036', '#000'],
}

languages_options = {
    chart: {
        height: 750,
        type: 'column'
    },
    rangeSelector:{
        enabled:true,
        selected: 4
    },
    xAxis: {
        type: 'datetime',
        startOfWeek: 0,
        title: {
             text: 'Date'
        }
    },
    yAxis: {
        title: {
            text: '% of Installations'
        },
        min: 0
    },
    tooltip: {
        valueDecimals: 2,
        headerFormat: '<b>{series.name}</b><br>',
        pointFormat: '{series.name} {point.x:%A %e %b %Y}: {point.y}%'
    },
    plotOptions: {
        column: {
            stacking: 'normal',
            dataLabels: {
                enabled: true,
                format: '{point.y:.2f}%'
            }
        },
        series: {
            showInLegend: true
        }
    },
   legend: {
        enabled: true
    },
    navigator: {
        enabled: false
    },
    scrollbar: {
        enabled: false
    },
}

dmonthly_options = {
    chart: {
        type: 'area'
    },

    xAxis: {
        type: 'datetime',
        labels: {
            format: '{value:%b}'
        },
        title: {
             text: 'Date'
        }
    },
    yAxis: {
        title: {
            text: '$ US dollars'
        },
        min: 0
    },
    tooltip: {
        valueDecimals: 0,
        headerFormat: '<b>{series.name}</b><br>',
        pointFormat: '{series.name} {point.x:%b}: <b>{point.y} USD</b>'
    },
    plotOptions: {
        spline: {
            marker: {
                enabled: true
            }
        },
        series: {
            fillOpacity: 0.25,
            showInLegend: true,
        }
    },
    rangeSelector:{
        enabled:true
    },
   legend: {
        enabled: true
    },
    navigator: {
        enabled: false
    },
    scrollbar: {
        enabled: false
    },
}

yearly_options = {
    chart: {height: 750},
    title: {text: '<b>Donation Totals & Spending</b>'},
    tooltip: {pointFormat: 'Total: <b>{point.y} USD</b>'},
    legend: {enabled: false},
    xAxis: {labels: {enabled: false}},
    yAxis: {title: {text: '$ US'}},
    labels: {
        items: [{
            html: 'Spending by Category(2020)',
            style: {
                left: '150px',
                top: '20px',
                fontSize: '20px'
            }
        }]
    }
}

$.getJSON('financials.json', function(data) {
    let donations = format_financial_data(data);

    // Monthly donation chart
    let opt = dmonthly_options;
    opt.series = donations['monthly'];
    opt.colors = ['#ff0000', '#4169e1', '#2e8B57', '#ffa500', '#bA55d3'];
    opt.title = {text: '<b>Monthly Donations</b>'};
    Highcharts.stockChart('dmonthly', opt);
    // Yearly donation and spending chart
    let yopt = yearly_options;
    yopt.series = donations['yearly'];
    yopt.series[0]['type'] = 'column';
    yopt.series[0]['color'] = '#ea4335';
    yopt.series[0]['dataLabels'] = {enabled: true, format:'{point.name}'};
    yopt.series[1]['type'] = 'pie';
    yopt.series[1]['tooltip'] = {pointFormat: '{series.name}: <b>{point.percentage:.2f}%</b>'};
    yopt.series[1]['size'] = '250';
    yopt.series[1]['center'] = ['275','175'];
    Highcharts.chart('dyearly', yopt);

});

$.getJSON('thunderbird_ami.json', function(data) {
    var ami = format_ami_data(data);
    var opt = user_count_options;
    opt.chart.type = 'areaspline'
    opt.series = [{name: "AMI", id: "ami", data: ami['graph']}];
    opt.xAxis.startOfWeek = 0; // Set start of week to Sundays.
    opt.title = {text: 'Monthly Active Installations for Release channel'};
    Highcharts.stockChart('line_ami', opt);
    $('#ami').DataTable( {
        "searching": true,
        "bPaginate": true,
        "bInfo" : false,
        "order": [[0, "desc"]],
        data: ami['table'],
            columns: [
                { title: "Date" },
                { title: "AMI", render: $.fn.dataTable.render.number(',','.') },
            ]
    });
    $(".dataTables_wrapper").css("width","25%").css("margin", "0 auto");
});

$.getJSON('thunderbird_adi.json', function(data) {
    var adi = format_adi_data(data);
    var opt = user_count_options;
    opt.chart.type = 'line'
    opt.series = [
        {name: "ADI", id: "adi", data: adi['graph']},
        {name: "7-day Moving Average", type: "sma", linkedTo: "adi",
            params: { period: 7 }
        },
    ];
    opt.title = {text: 'Daily Active Installations for Release channel'};
    Highcharts.stockChart('line_adi', opt);

    $('#adi').DataTable( {
        "searching": true,
        "bPaginate": true,
        "bInfo" : false,
        "order": [[0, "desc"]],
        data: adi['table'],
            columns: [
                { title: "Date" },
                { title: "ADI", render: $.fn.dataTable.render.number(',','.') },
            ]
    });
    $(".dataTables_wrapper").css("width","25%").css("margin", "0 auto");
});

$.getJSON('beta_nightly_adi.json', function(data) {
    var adi = format_beta_adi(data);
    var opt = beta_adi_options;
    opt.series = adi['betas'];
    opt.title = {text: 'Active Beta and Nightly Installations after 78'};
    Highcharts.stockChart('line_beta_adi', opt);
});

$.getJSON('68beta_nightly_adi.json', function(data) {
    var adi = format_beta_adi(data);
    var opt = beta_adi_options;
    opt.series = adi['betas'];
    opt.title = {text: '69-78 Beta history'};
    Highcharts.stockChart('68line_beta_adi', opt);
});

$.getJSON('78uptake.json', function(data) {
    var adi = format_adi_data(data);
    var opt = adi_uptake_options;
    opt.series = adi['uptake'];
    opt.rangeSelector = {selected: 4};
    opt.title = {text: 'TB78 Uptake as % of ADI'};
    Highcharts.stockChart('78uptake', opt)
});

$.getJSON('68uptake.json', function(data) {
    var adi = format_adi_data(data);
    var opt = adi_uptake_options;
    opt.series = adi['uptake'];
    opt.rangeSelector = {selected: 4};
    opt.title = {text: 'TB68 Uptake as % of ADI'};
    Highcharts.stockChart('68uptake', opt)
});

$.getJSON('60uptake.json', function(data) {
    var adi = format_adi_data(data);
    var opt = adi_uptake_options;
    opt.series = adi['uptake'];
    opt.title = {text: 'TB60 Uptake as % of ADI'};
    Highcharts.stockChart('60uptake', opt)
});

$.getJSON('locales.json', function(data) {
    var adi = format_adi_data(data);
    var opt = languages_options;
    opt.series = adi['uptake'].slice(0, 11);
    opt.title = {text: '% Installations in Top 10 Locales'};
    Highcharts.stockChart('languages', opt)
});

$.getJSON('platforms.json', function(data) {
    var adi = format_adi_data(data);
    var opt = languages_options;
    opt.series = adi['uptake'];
    opt.title = {text: '% Users on Platform'};
    Highcharts.stockChart('platforms', opt)
});

$.getJSON('addon_stats.json', function(data) {
    var adi = format_addon_stats(data);

    Highcharts.stockChart('addon_stats', {
        chart: {
            type: 'areaspline'
        },
        title: {
            text: 'Addon Users as % of Total'
        },
        xAxis: {
            type: 'datetime',
        },
        yAxis: {
            title: {
                text: '% of Total Users'
            },
            min: 0,
            max: 100
        },
        tooltip: {
            valueDecimals: 2,
            headerFormat: '<b>{series.name}</b><br>',
            pointFormat: '{point.x:%A %e %b}: {point.y}% of users.'
        },

        legend: {
            enabled: true
        },

        plotOptions: {
            series: {
                showInLegend: true
            }
        },

        navigator: {
            enabled: false
        },

        scrollbar: {
            enabled: false
        },

        rangeSelector: {
            selected: 4
        },

        colors: ['#6CF', '#39F', '#06C', '#036', '#000'],
        series: adi
    });
});

Highcharts.setOptions({
    lang: {
        thousandsSep: ','
    }
});
