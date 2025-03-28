let first, last;

addEventListener("load", async function () {
  const req = await fetch("oauth.json");
  const data = await req.json();

  const keys = Object.keys(data.total);
  first = new Date(keys.at(0));
  last = new Date(keys.at(-1));
  // first = new Date(keys.at(0) + ":00:00");
  // last = new Date(keys.at(-1) + ":00:00");

  const issuers = new Set();
  const channels = new Set();
  const versions = new Set();
  const reasons = new Set();
  const results = new Set();
  for (const key of Object.keys(data)) {
    const params = new URLSearchParams(key);
    if (params.has("issuer")) {
      issuers.add(params.get("issuer"));
    }
    if (params.has("channel")) {
      channels.add(params.get("channel"));
    }
    if (params.has("version")) {
      versions.add(params.get("version"));
    }
    if (params.has("reason")) {
      reasons.add(params.get("reason"));
    }
    if (params.has("result")) {
      results.add(params.get("result"));
    }
  }

  function formatData(data) {
    const values = [];
    const counter = new Date(first);
    while (counter <= last) {
      const key = counter.toISOString().slice(0, 10);
      // let key = counter.toISOString().slice(0, 13);
      values.push([counter.valueOf(), data[key] ?? 0]);
      counter.setDate(counter.getDate() + 1);
      // counter.setHours(counter.getHours() + 1);
    }
    return values;
  }

  const options = {
    chart: {
      type: "column",
    },
    rangeSelector: {
      enabled: false,
      selected: 4,
    },
    yAxis: {
      min: 0,
    },
    xAxis: {
      type: "datetime",
    },
    plotOptions: {
      column: {
        stacking: "normal",
        dataLabels: {
          enabled: false,
        },
      },
      series: {
        showInLegend: true,
      },
    },
    legend: {
      enabled: true,
    },
    navigator: {
      enabled: false,
    },
    scrollbar: {
      enabled: false,
    },
  };
  const totalData = {
    ...options,
    series: [],
    title: { text: "All OAuth authentication requests" },
  };
  for (const issuer of issuers) {
    totalData.series.push({
      name: issuer,
      data: formatData(data["issuer=" + issuer]),
    });
  }
  Highcharts.stockChart("total", totalData);

  for (const issuer of issuers) {
    const issuerDiv = document.body.appendChild(document.createElement("div"));
    issuerDiv.id = issuer;
    issuerDiv.classList.add("issuer");
    issuerDiv.appendChild(document.createElement("h2")).textContent = issuer;

    const channelData = {
      ...options,
      series: [],
      title: { text: "Channels" },
    };
    for (const channel of channels) {
      channelData.series.push({
        name: channel,
        data: formatData(data["issuer=" + issuer + "&channel=" + channel]),
      });
    }
    const channelDiv = issuerDiv.appendChild(document.createElement("div"));
    channelDiv.id = `${issuer}_channel`;
    channelDiv.classList.add("channel");
    Highcharts.stockChart(channelDiv.id, channelData);

    const versionData = {
      ...options,
      series: [],
      title: { text: "Versions" },
    };
    for (const version of versions) {
      versionData.series.push({
        name: version,
        data: formatData(data["issuer=" + issuer + "&version=" + version]),
      });
    }
    const versionDiv = issuerDiv.appendChild(document.createElement("div"));
    versionDiv.id = `${issuer}_version`;
    versionDiv.classList.add("version");
    Highcharts.stockChart(versionDiv.id, versionData);

    const reasonData = {
      ...options,
      series: [],
      title: { text: "Reasons" },
    };
    for (const reason of reasons) {
      reasonData.series.push({
        name: reason,
        data: formatData(data["issuer=" + issuer + "&reason=" + reason]),
      });
    }
    const reasonDiv = issuerDiv.appendChild(document.createElement("div"));
    reasonDiv.id = `${issuer}_reason`;
    reasonDiv.classList.add("reason");
    Highcharts.stockChart(reasonDiv.id, reasonData);

    const resultData = {
      ...options,
      series: [],
      title: { text: "Results" },
    };
    for (const result of results) {
      resultData.series.push({
        name: result,
        data: formatData(data["issuer=" + issuer + "&result=" + result]),
      });
    }
    const resultDiv = issuerDiv.appendChild(document.createElement("div"));
    resultDiv.id = `${issuer}_result`;
    resultDiv.classList.add("result");
    Highcharts.stockChart(resultDiv.id, resultData);
  }
});
