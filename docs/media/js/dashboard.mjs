import {
  buildSeries,
  createPresetGroups,
  colorForSeries,
  assignSeriesColors,
  compareVersions,
  normalizeReleases,
  resolveLatestEsr,
  resolveLatestRelease,
  CHANNELS,
} from "./explorer-model.mjs";
import { renderChart, movingAverage, normalizeOverview, presetDateRange, formatPercentage, orderSeriesByValue } from "./chart.mjs";

import {renderBreakdown} from "./breakdown.mjs";
import {renderFunding} from "./funding-view.mjs";
import {formatPlatformLabel, groupPlatformRecords, selectChannelRecords} from "./platform-model.mjs";
import {groupSmallSeries, SMALL_SERIES_LABEL, SMALL_SERIES_HELP} from "./series-grouping.mjs";
import {trackFocusInput} from "./focus.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const calendarFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const number = (value) => integerFormat.format(value);
const compact = (value) =>
  compactFormat.format(value);
const dateLabel = (date) =>
  calendarFormat.format(new Date(`${date}T00:00:00Z`));
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const chartStyles = {
  lines: {label: "Lines", icon: '<path d="m5 16 5-7 5 4 5-8"/><path d="m5 11 5 6 5-7 5 3" opacity=".4"/>'},
  area: {label: "Overlaid areas", icon: '<path d="M5 19v-6l5-7 5 5 5-6v14Z" fill="currentColor" fill-opacity=".2"/><path d="M5 19v-3l5-5 5 5 5-6v9Z" fill="currentColor" fill-opacity=".35"/>'},
  bars: {label: "Grouped bars", icon: '<rect x="5" y="12" width="3" height="7" rx=".5" fill="currentColor" stroke="none"/><rect x="11" y="5" width="3" height="14" rx=".5" fill="currentColor" stroke="none"/><rect x="17" y="9" width="3" height="10" rx=".5" fill="currentColor" stroke="none"/>'},
  count: {label: "Stacked counts", icon: '<path d="M5 19v-5c5 0 8-8 15-10v15Z" fill="currentColor" fill-opacity=".15"/><path d="M5 19v-3c5 0 8-6 15-7v10Z" fill="currentColor" fill-opacity=".3"/><path d="M5 19v-1c5 0 8-3 15-3v4Z" fill="currentColor" fill-opacity=".6"/>'},
  percent: {label: "Stacked shares", icon: '<path d="M5 5h15v14H5Z" fill="currentColor" fill-opacity=".15"/><path d="M5 19v-8c5 0 8 4 15 3v5Z" fill="currentColor" fill-opacity=".3"/><path d="M5 19v-4c5 0 8 3 15 2v2Z" fill="currentColor" fill-opacity=".6"/>'},
};
function chartStyleButtons(modes, selected, id, attribute = "data-chart-mode") {
  return modes.map(mode => {
    const {label, icon} = chartStyles[mode];
    const tooltipId = `${id}-${mode}-tooltip`;
    return `<button type="button" class="chart-style-button" ${attribute}="${mode}" aria-label="${label}" aria-describedby="${tooltipId}" aria-pressed="${mode === selected}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3v18h18" opacity=".35"/>${icon}</svg><span id="${tooltipId}" class="chart-style-tooltip" role="tooltip">${label}</span></button>`;
  }).join("");
}
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
const cache = new Map();
const secondaryRanges = new Map();
const secondaryViews = new Map();
const metricSelections = new Map();
const OAUTH_METRIC = "oauth-providers";
const TELEMETRY_GROUPS = [
  {id: "accounts", label: "Accounts & Authentication"},
  {id: "mail", label: "Mail & Security"},
  {id: "organizing", label: "Calendars & Contacts"},
  {id: "other", label: "Other Features"},
];
function telemetryGroup(key) {
  if (key === OAUTH_METRIC || key === "accounts" || /^mail_(account_count|(?:failed|successful)_email_account_setup)$/.test(key) || key.startsWith("tb.account.")) return "accounts";
  if (/^(mail_(mails_|secure_mail_)|compose_mails_|tb\.mails\.)/.test(key)) return "mail";
  if (/^(addrbook_|calendar_|tb\.(addressbook|calendar)\.)/.test(key)) return "organizing";
  return "other";
}
function telemetryMetricChoices(metrics) {
  // Use the same labels in the chart headings and the sidebar directory.
  const labels = {
    mail_mails_read: "All messages read",
    compose_mails_sent: "All messages sent",
    mail_mails_read_secure: "Secure messages read",
    mail_secure_mail_loaded: "Secure messages loaded",
  };
  const units = {mail_mails_read_secure: "reads", mail_secure_mail_loaded: "loads"};
  return Object.entries(metrics || {})
    .filter(([key, metric]) => key !== "mail_oauth2_provider_count" && Object.keys(metric.records || {}).length)
    .map(([key, metric]) => [key, {...metric, label: labels[key] || metric.label, unit: units[key] || metric.unit}]);
}
function renderTelemetryNavigation(available, {metricSource = "current", oauthSource = secondarySources.get("telemetry-oauth") || "current"} = {}) {
  const choices = [[OAUTH_METRIC, {label: "OAuth Providers"}], ...available];
  const selectedMetric = activeTab === "telemetry" ? metricSelections.get("telemetry-view") : null;
  $("#telemetry-nav-links").innerHTML = TELEMETRY_GROUPS.map(group => {
    const metrics = choices.filter(([key]) => telemetryGroup(key) === group.id);
    if (!metrics.length) return "";
    const expanded = selectedMetric && telemetryGroup(selectedMetric) === group.id;
    return `<div class="site-nav-metric-group" data-metric-group="${group.id}" role="group" aria-labelledby="telemetry-group-${group.id}"><h3 role="presentation"><button id="telemetry-group-${group.id}" type="button" class="site-nav-group-toggle" data-nav-toggle="telemetry-${group.id}" aria-expanded="${Boolean(expanded)}" aria-controls="telemetry-${group.id}-links"><span>${group.label}</span><svg class="site-nav-group-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></h3><div id="telemetry-${group.id}-links" class="site-nav-metric-links"${expanded ? "" : " hidden"}>${metrics.map(([key, metric]) => {
      const source = key === OAUTH_METRIC ? oauthSource : metricSource;
      const href = telemetryChartURL({metric: key, source, ...(key === OAUTH_METRIC ? oauthSelection : {})}).hash;
      return `<a href="${esc(href)}" data-metric="${esc(key)}" data-group="${group.id}"><span>${esc(metric.label || key)}</span></a>`;
    }).join("")}</div></div>`;
  }).join("");
  syncSiteNavigation();
}
let telemetryNavigationLoading = false;
async function loadTelemetryNavigation() {
  const container = $("#telemetry-nav-links");
  if (!manifest || telemetryNavigationLoading || container.querySelector("[data-metric]")) return;
  telemetryNavigationLoading = true;
  try {
    const glean = await loadGlean();
    // A chart navigation may have already populated a different data source.
    if (!container.querySelector("[data-metric]")) renderTelemetryNavigation(telemetryMetricChoices(glean?.metrics));
  } catch {
    if (!container.querySelector("[data-metric]"))
      container.innerHTML = '<p class="site-nav-status">Charts could not be loaded.</p><a href="#telemetry">Open Telemetry</a>';
  } finally {
    telemetryNavigationLoading = false;
  }
}
const secondarySources = new Map();
const oauthSelection = { provider: "", dimension: "issuer" };
let secondarySourceTab;
let manifest,
  releases = [],
  currentEsrMajor = null,
  currentReleaseMajor = null,
  allTotals = [],
  dailySeries = [],
  chart,
  secondaryCharts = [],
  currentResult,
  baseExplorerResult,
  currentRecords = [],
  currentRecordRange,
  currentCalculationKey,
  currentDateIndexes = new Map(),
  requestId = 0,
  legendDate,
  defaultLegendDate,
  visibilityFrame = null,
  toastTimer,
  sharedViewBaseline = null,
  lastReadHash = null;
function defaultLegendState() {
  return {
    grouping: "major",
    versionCutoff: 128,
    combineReleaseVersions: true,
    channels: [...CHANNELS],
    groups: createPresetGroups("latest-esr"),
    hiddenSeries: [],
    showSmallVersions: false,
    groupSmallSeries: false,
  };
}
const legendDefaults = defaultLegendState();
const defaultGroupsKey = JSON.stringify(cleanGroups(legendDefaults.groups));
let state = {
  ...defaultLegendState(),
  mode: "percent",
  range: "6m",
  startDate: "",
  endDate: "",
};
const knownTabs = [
  "explore",
  "daily",
  "mau",
  "telemetry",
  "addons",
  "platforms",
  "financials",
  "support",
];
const aliases = {
  oauth: "telemetry",
  default: "daily",
  ami: "mau",
  beta: "explore",
  version: "explore",
  platlang: "platforms",
};
let activeTab = "explore";

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4000);
  announceStatus(message);
}
let statusFrame;
function announceStatus(message) {
  cancelAnimationFrame(statusFrame);
  const status = $("#screen-reader-status");
  status.textContent = "";
  statusFrame = requestAnimationFrame(() => { status.textContent = message; });
}
function notice(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
  if (message) announceStatus(message);
}
async function json(path) {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(path)
        .then((r) => {
          if (!r.ok) throw new Error(`Unable to load ${path} (${r.status})`);
          return r.json();
        })
        .catch((e) => {
          cache.delete(path);
          throw e;
        }),
    );
  return cache.get(path);
}
function isDay(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function cleanGroups(value) {
  if (!Array.isArray(value) || value.length > 40)
    throw new Error("Use an array of up to 40 groups.");
  return value.map((g, i) => {
    if (!g || typeof g !== "object")
      throw new Error("Each group must be an object.");
    const result = {
      id: String(g.id || `group-${i}`).slice(0, 80),
      name: String(g.name || `Group ${i + 1}`).slice(0, 80),
      color: /^#[\da-f]{6}$/i.test(g.color || "")
        ? g.color
        : colorForSeries(String(g.id || i)),
    };
    for (const key of ["versions", "excludeVersions"])
      if (g[key])
        result[key] = (
          Array.isArray(g[key]) ? g[key] : String(g[key]).split(",")
        )
          .map((v) => String(v).trim().slice(0, 70))
          .filter(Boolean)
          .slice(0, 150);
    for (const key of ["channels", "excludeChannels"])
      if (g[key])
        result[key] = (
          Array.isArray(g[key]) ? g[key] : String(g[key]).split(",")
        ).filter((v) => CHANNELS.includes(v));
    for (const key of ["minVersion", "maxVersion"])
      if (g[key]) result[key] = String(g[key]).slice(0, 70);
    for (const key of ["minMajor", "maxMajor", "pinnedMajor"])
      if (
        g[key] != null &&
        Number.isInteger(Number(g[key])) &&
        Number(g[key]) >= 0
      )
        result[key] = Number(g[key]);
    if (["historical", "pinned"].includes(g.latestEsr))
      result.latestEsr = g.latestEsr;
    for (const key of ["latestPatch", "remainder"])
      if (g[key] === true) result[key] = true;
    if (typeof g.esrVersion === "boolean") result.esrVersion = g.esrVersion;
    if (g.visible === false) result.visible = false;
    return result;
  });
}
function restore(value) {
  if (!value || typeof value !== "object") return;
  if (["major", "versions", "channels", "custom"].includes(value.grouping))
    state.grouping = value.grouping;
  if (value.versionCutoff === null || (Number.isInteger(value.versionCutoff) && value.versionCutoff > 0 && value.versionCutoff < 10000))
    state.versionCutoff = value.versionCutoff;
  if (typeof value.combineReleaseVersions === "boolean")
    state.combineReleaseVersions = value.combineReleaseVersions;
  if (typeof value.showSmallVersions === "boolean")
    state.showSmallVersions = value.showSmallVersions;
  if (typeof value.groupSmallSeries === "boolean")
    state.groupSmallSeries = value.groupSmallSeries;
  if (["percent", "count", "lines"].includes(value.mode))
    state.mode = value.mode;
  if (Array.isArray(value.channels))
    state.channels = value.channels.filter((v) => CHANNELS.includes(v));
  if (value.groups) state.groups = cleanGroups(value.groups);
  if (Array.isArray(value.hiddenSeries))
    state.hiddenSeries = value.hiddenSeries.map(String).slice(0, 5000);
  if (isDay(value.startDate)) state.startDate = value.startDate;
  if (isDay(value.endDate)) state.endDate = value.endDate;
  if (["1m", "3m", "6m", "1y", "all", "custom"].includes(value.range))
    state.range = value.range;
}
function save() {
  const serialized = JSON.stringify(state);
  storage.set("tb-stats-view", serialized);
  // A shared URL captures one state. Subsequent edits become the local view.
  if (sharedViewBaseline !== null && sharedViewBaseline !== serialized) {
    history.replaceState(null, "", `#${activeTab}`);
    sharedViewBaseline = null;
    lastReadHash = location.hash;
  }
}
function readHash() {
  const [name, query] = location.hash.slice(1).split("?");
  const tab = aliases[name] || name || "explore";
  activeTab = knownTabs.includes(tab) ? tab : "explore";
  if (lastReadHash === location.hash) return;
  const params = new URLSearchParams(query);
  if (name === "oauth") {
    params.set("metric", OAUTH_METRIC);
    history.replaceState(null, "", `#telemetry?${params}`);
  }
  lastReadHash = location.hash;
  sharedViewBaseline = null;
  if (query) {
    try {
      const text = params.get("state");
      if (text && text.length < 60000) {
        restore(JSON.parse(text));
        if (manifest && state.range !== "custom") setRange(state.range);
        sharedViewBaseline = JSON.stringify(state);
      }
    } catch {
      toast("This saved view could not be read. Showing the default view.");
    }
  }
}
function telemetryLinkFromHash() {
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const metric = params.get("metric");
  if (!metric) return null;
  return {
    metric,
    source: params.get("source") === "legacy" ? "legacy" : "current",
    provider: params.get("provider") || "",
    dimension: params.get("group") || "issuer",
    chart: ["authentication", "accounts"].includes(params.get("chart")) ? params.get("chart") : "",
  };
}
function telemetryChartURL({metric, source = "current", provider = "", dimension = "issuer", chart = ""}) {
  const url = new URL(location.href);
  const params = new URLSearchParams({metric});
  if (source === "legacy") params.set("source", source);
  if (metric === OAUTH_METRIC) {
    if (provider) params.set("provider", provider);
    if (dimension !== "issuer") params.set("group", dimension);
    if (chart === "authentication" || (chart === "accounts" && source !== "legacy")) params.set("chart", chart);
  }
  url.hash = `telemetry?${params}`;
  return url;
}
function updateTelemetryURL(selection) {
  const url = telemetryChartURL(selection);
  history.replaceState(null, "", url);
  lastReadHash = location.hash;
  syncSiteNavigation();
  updatePageTitle();
  return url;
}
async function copyViewLink(url, message) {
  history.replaceState(null, "", url);
  lastReadHash = location.hash;
  try {
    await navigator.clipboard.writeText(url.href);
    toast(message);
  } catch {
    toast("This view is saved in the address bar. Copy its URL to share.");
  }
}
function syncReportChannels() {
  const supportsChannels = !["financials", "support"].includes(activeTab);
  const noChannels = state.channels.length === 0;
  $("#report-channels").hidden = !supportsChannels;
  $("#secondary-content").hidden = supportsChannels && noChannels;
  $("#channel-empty-state").hidden = !supportsChannels || !noChannels;
  const allSelected = CHANNELS.every(channel => state.channels.includes(channel));
  $("#all-report-channels").setAttribute("aria-pressed", String(allSelected));
  $("#no-report-channels").setAttribute("aria-pressed", String(noChannels));
  $$(".channel-set input").forEach(input => {
    input.checked = state.channels.includes(input.value);
  });
  const status = noChannels
    ? "No channels selected. Choose a channel or All channels to restore the chart."
    : "Choose one or more channels. Double click to isolate one channel by itself.";
  const message = $("#channel-filter-status");
  if (message.textContent !== status) message.textContent = status;
}
function setReportChannels(channels) {
  state.channels = channels;
  syncReportChannels();
  if (activeTab === "explore") refreshExplorer();
  else {
    if (channels.length) secondaryCharts.forEach(chart => chart.refreshChannels?.());
    save();
  }
}
function syncControls() {
  $("#grouping").value = state.grouping;
  $("#legend-small-versions-control").hidden = !["major", "versions"].includes(state.grouping);
  $("#legend-show-small-versions").checked = state.showSmallVersions;
  $("#group-small-series-control").hidden = state.grouping === "custom";
  $("#group-small-series").checked = state.groupSmallSeries;
  $("#version-cutoff-control").hidden = state.grouping !== "major";
  $("#release-bucket-control").hidden = state.grouping !== "major";
  $("#combine-release-versions").checked = state.combineReleaseVersions;
  $("#combine-release-label").textContent = `Combine Release versions prior to ${currentReleaseMajor ?? "the current version"}`;
  const cutoff = $("#version-cutoff");
  if (state.versionCutoff != null && ![...cutoff.options].some(option => option.value === String(state.versionCutoff)))
    cutoff.add(new Option(`${state.versionCutoff} and below`, state.versionCutoff));
  cutoff.value = state.versionCutoff == null ? "" : String(state.versionCutoff);
  $$("[data-mode]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.mode === state.mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
  });
  syncReportChannels();
  $("#start-date").value = state.startDate;
  $("#end-date").value = state.endDate;
  $$("#explore-view [data-range]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.range === state.range);
    b.setAttribute("aria-pressed", String(b.dataset.range === state.range));
  });
}
function setRange(range) {
  Object.assign(state, presetDateRange(range, manifest.adi.start, manifest.adi.end));
  syncControls();
}
async function adiRecords(start, end) {
  if (manifest.adi.files?.length) {
    const files = manifest.adi.files.filter(
      (f) => f.end >= start && f.start <= end,
    );
    const parts = await Promise.all(
      files.map((f) => {
        if (!/^adi-\d{4}\.json$/.test(f.file))
          throw new Error("Invalid data manifest");
        return json(`data/${f.file}`);
      }),
    );
    return parts
      .flatMap((p) =>
        Object.entries(p)
          .filter(([d]) => d >= start && d <= end)
          .map(([date, r]) => ({ date, ...r })),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const d = await json("thunderbird_adi.json");
  return Object.entries(d)
    .filter(([date]) => date >= start && date <= end)
    .map(([date, r]) => ({ date, ...r }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
async function adiTotals() {
  if (manifest.adi.totals) {
    if (manifest.adi.totals !== "adi-totals.json")
      throw new Error("Invalid totals manifest");
    const totals = await json("data/adi-totals.json");
    return Object.entries(totals)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return (await adiRecords(manifest.adi.start, manifest.adi.end)).map((r) => ({
    date: r.date,
    total: r.count,
  }));
}
function updateSeriesVisibility() {
  const hidden = new Set(state.hiddenSeries);
  const firstRemainder = state.groups.find(group => group.remainder);
  const customGroups = state.groups.filter(group => !group.remainder || group === firstRemainder);
  let changed = false;
  baseExplorerResult.series.forEach((series, index) => {
    const visible = !hidden.has(series.id) && (state.grouping !== "custom" || customGroups[index]?.visible !== false);
    changed ||= series.visible !== visible;
    series.visible = visible;
  });
  const next = groupSmallSeries(baseExplorerResult.series, {enabled: state.groupSmallSeries && state.grouping !== "custom"});
  for (const series of next) if (series.smallSeries) series.visible = !hidden.has(series.id);
  changed ||= next.length !== currentResult.series.length || next.some((series, index) =>
    series.id !== currentResult.series[index]?.id || series.visible !== currentResult.series[index]?.visible);
  currentResult.series = next;
  return changed;
}
function refreshLegendSelection() {
  if (!currentResult) return;
  const changed = updateSeriesVisibility();
  save();
  renderLegend();
  if (!changed) return;
  // Respond to selection immediately, and combine rapid toggles into one redraw.
  if (visibilityFrame !== null) cancelAnimationFrame(visibilityFrame);
  const result = currentResult;
  visibilityFrame = requestAnimationFrame(() => {
    visibilityFrame = null;
    if (currentResult !== result || activeTab !== "explore") return;
    chart?.update(result.series);
    if ($(".data-table-details").open) renderTable();
  });
}
async function refreshExplorer() {
  if (visibilityFrame !== null) cancelAnimationFrame(visibilityFrame);
  visibilityFrame = null;
  const id = ++requestId;
  syncControls();
  save();
  notice("");
  const invalidRange = !isDay(state.startDate) || !isDay(state.endDate) || state.startDate > state.endDate;
  for (const input of [$("#start-date"), $("#end-date")]) {
    input.setAttribute("aria-invalid", String(invalidRange));
    input.setAttribute("aria-describedby", "notice");
  }
  if (invalidRange) {
    notice("Choose a start date before the end date.");
    return;
  }
  try {
    const recordRange = `${state.startDate}:${state.endDate}`;
    const records = recordRange === currentRecordRange ? currentRecords : await adiRecords(state.startDate, state.endDate);
    if (id !== requestId || activeTab !== "explore") return;
    if (records !== currentRecords) {
      currentRecords = records;
      currentRecordRange = recordRange;
    }
    // Visibility and count/share presentation do not change group membership.
    // Keep only the current calculation so long histories do not accumulate.
    const calculationKey = JSON.stringify({recordRange, grouping: state.grouping,
      versionCutoff: state.grouping === "major" ? state.versionCutoff : null,
      combineReleaseVersions: state.grouping === "major" && state.combineReleaseVersions,
      currentEsrMajor: ["major", "versions"].includes(state.grouping) ? currentEsrMajor : null,
      currentReleaseMajor: ["major", "versions"].includes(state.grouping) ? currentReleaseMajor : null,
      channels: state.channels, mode: state.mode === "lines" ? "lines" : "stacked",
      groups: state.grouping === "custom" ? state.groups.map(({visible, ...group}) => group) : null});
    if (calculationKey !== currentCalculationKey) {
      baseExplorerResult = buildSeries(records, {...state, currentEsrMajor, currentReleaseMajor, hiddenSeries: []}, releases);
      currentResult = {...baseExplorerResult};
      currentCalculationKey = calculationKey;
      currentDateIndexes = new Map(currentResult.totals.map((point, index) => [point.date, index]));
    }
    updateSeriesVisibility();
    currentResult.mode = state.mode;
    const channelView = state.grouping === "channels" || state.channels.length !== CHANNELS.length || (state.grouping === "custom" && state.groups.some(group => group.channels?.length || group.excludeChannels?.length || group.latestEsr));
    const channelLegendDate = records.filter(record => record.date >= manifest.adi.channel_start && record.date <= manifest.adi.channel_end).at(-1)?.date;
    defaultLegendDate = channelView && channelLegendDate ? channelLegendDate : records.at(-1)?.date;
    legendDate = defaultLegendDate;
    const versionView = ["major", "versions"].includes(state.grouping);
    const opts = {
      mode: state.mode,
      height: 365,
      title: "Thunderbird version adoption",
      emptyMessage: state.channels.length ? "No observations for this selection" : "No channels selected",
      unit: "installations",
      yLabel: state.mode === "percent" ? "Share of selected installations (%)" : "Active daily installations",
      totalLabel: "Selected population",
      dataTableId: "explorer-data-table",
      tooltipMinPercent: versionView && state.mode !== "count" ? 0.1 : 0,
      tooltipMinValue: versionView && state.mode === "count" ? 1 : null,
      overview: allTotals,
      startDate: state.startDate,
      endDate: state.endDate,
      onDateSelect: (date) => {
        legendDate =
          typeof date === "string"
            ? date
            : new Date(date).toISOString().slice(0, 10);
        renderLegend();
      },
      onRangeChange: (range) => {
        if (Array.isArray(range) && range.length === 2) {
          state.startDate = new Date(range[0]).toISOString().slice(0, 10);
          state.endDate = new Date(range[1]).toISOString().slice(0, 10);
          state.range = "custom";
          refreshExplorer();
        }
      },
    };
    if (chart) chart.update(currentResult.series, opts);
    else {
      $("#explorer-chart").replaceChildren();
      chart = renderChart($("#explorer-chart"), currentResult.series, opts);
    }
    $("#chart-subtitle").textContent =
      state.mode === "percent"
        ? "Share of active daily installations"
        : state.mode === "count"
          ? "Active daily installations by group"
          : "Compare active daily installations";
    const warnings = currentResult.warnings.map((warning) =>
      warning.includes("no recorded channel")
        ? "Some Thunderbird update pings have no recorded channel and remain unclassified."
        : warning,
    );
    if (
      channelView && manifest.adi.channel_start &&
      state.startDate < manifest.adi.channel_start
    )
      warnings.push(
        `Recorded channel history begins ${dateLabel(manifest.adi.channel_start)}. Earlier dates are unclassified.`,
      );
    const channelCoverage = manifest.adi.channel_start && manifest.adi.channel_end;
    const outsideChannelCoverage = channelView && channelCoverage && (state.startDate < manifest.adi.channel_start || state.endDate > manifest.adi.channel_end);
    const channelsExcluded = state.channels.length !== CHANNELS.length;
    $("#channel-coverage-action").hidden = !outsideChannelCoverage && !channelsExcluded;
    $("#use-channel-dates").hidden = !outsideChannelCoverage;
    $("#include-all-channels").hidden = !channelsExcluded;
    if (channelView && channelCoverage && state.endDate > manifest.adi.channel_end) warnings.push(`Recorded channel history ends ${dateLabel(manifest.adi.channel_end)}. Later totals have no recorded channel.`);
    if (state.grouping === "custom" && state.groups.some(group => group.versions?.includes("stage:beta"))) {
      warnings.push("Beta build groups include only versions with a b suffix. Versions without that suffix are excluded, so this is not total Beta usage. Choose Channels for recorded Beta totals.");
      if (!records.some(record => Object.keys(record.versions || {}).some(version => /b\d*(?:$|[.-])/i.test(version))))
        warnings.push("No b-suffixed versions are published in these dates; this does not mean zero Beta usage.");
    }
    if (!records.length) warnings.push("No observations in this date range.");
    $("#chart-warning").textContent = warnings.join(" ");
    $("#chart-warning").hidden = !warnings.length;
    $("#denominator-note").textContent =
      state.mode === "percent"
        ? "Share of all installations in the selected channels. Hidden series keep their share."
        : "Estimated installations from update requests. Missing dates remain gaps.";
    const excludedChannels = $$(".channel-set input:not(:checked)").map(input => input.closest("label").textContent.trim());
    if (excludedChannels.length) $("#denominator-note").textContent += ` Excluded channels: ${excludedChannels.join(", ")}.`;
    let versionHelp = "Every recorded version is available individually.";
    if (state.grouping === "major") {
      versionHelp = state.versionCutoff == null ? "No version cutoff is applied." : `All versions ${state.versionCutoff} and below are combined, regardless of channel.`;
      versionHelp += " ESR builds are listed separately from other builds with the same version number. Unclassified stable builds use dated ESR release history.";
      if (currentReleaseMajor != null) versionHelp += state.combineReleaseVersions
        ? ` Other Release versions combines Release activity outside the current ${currentReleaseMajor} family${state.versionCutoff == null ? "" : ", above the version cutoff"}. Unclassified stable builds use published Release families; ESR families stay separate.`
        : " Other Release versions are shown as individual major families.";
    }
    $(".series-help").textContent = versionView
      ? `${versionHelp} Search the legend or toggle groups to focus the chart. ${state.mode === "count" ? "Count tooltips show every nonzero value." : state.groupSmallSeries ? "Tooltips include Other alongside shares of 0.1% or more." : "Tooltips show shares of 0.1% or more."}`
      : "Search any recorded version above to add it to a custom comparison.";
    if (state.grouping === "custom" && state.groups.some(group => group.versions?.some(selector => selector.startsWith("stage:"))))
      $(".series-help").textContent = "Beta/Nightly build groups follow the b/a version suffix across all history. They describe build labels, independently of the recorded update channel.";
    renderLegend();
    if ($(".data-table-details").open) renderTable();
  } catch (e) {
    if (id === requestId) {
      notice(e.message);
      chart?.destroy();
      $("#explorer-chart").innerHTML =
        '<div class="loading-state">The chart could not be loaded. Try another date range.</div>';
      chart = null;
    }
  }
}
function renderLegend() {
  if (!currentResult) return;
  const date = legendDate || defaultLegendDate;
  $("#legend-date").textContent = date ? dateLabel(date) : "No observations";
  const search = $("#legend-search");
  const query = search.value.trim().toLowerCase();
  const dateIndex = currentDateIndexes.get(date);
  const pointForSeries = series => series.values[dateIndex];
  const hideSmallVersions = ["major", "versions"].includes(state.grouping) && !state.showSmallVersions && !query;
  // A search must still find small versions so they can be selected explicitly.
  const matching = currentResult.series.filter(series => series.name.toLowerCase().includes(query) &&
    (!hideSmallVersions || series.smallSeries || pointForSeries(series)?.percent >= 0.1));
  const ordered = state.mode === "lines" ? matching : orderSeriesByValue(matching, series => {
    const point = pointForSeries(series);
    return state.mode === "percent" ? point?.percent : point?.value;
  });
  const entries = ordered.map(series => ({id: `series:${series.id}`, name: series.name, series}));
  if (query) {
    const names = new Set(currentResult.series.map(series => series.name));
    const suggestions = currentResult.versionChoices
      .filter(
        (v) =>
          v.name.toLowerCase().includes(query) &&
          !names.has(v.name),
      )
      .slice(0, 20);
    entries.push(...suggestions.map(choice => ({id: choice.id, name: choice.name, version: choice.version, esrVersion: choice.esrVersion})));
  }
  const buttons = globalThis.d3.select($("#explorer-legend")).selectAll("button").data(entries, entry => entry.id).join(enter => {
    const button = enter.append("button").attr("type", "button");
    button.append("span").attr("class", "legend-swatch").attr("aria-hidden", "true");
    button.append("span").attr("class", "legend-name");
    button.append("span").attr("class", "legend-value");
    return button;
  });
  buttons.each(function(entry) {
    const className = `legend-item${entry.version != null ? " version-suggestion" : entry.series.visible ? "" : " off"}`;
    if (this.className !== className) this.className = className;
    const attributes = {
      "data-series": entry.series?.id,
      "data-version": entry.version,
      "data-esr-version": entry.version != null ? String(entry.esrVersion) : null,
      "aria-pressed": entry.series ? String(entry.series.visible) : null,
      title: entry.series ? `${entry.series.visible ? "Hide" : "Show"} ${entry.name} on chart` : `Compare ${entry.name}`,
    };
    for (const [key, value] of Object.entries(attributes)) {
      if (value == null) { if (this.hasAttribute(key)) this.removeAttribute(key); }
      else if (this.getAttribute(key) !== value) this.setAttribute(key, value);
    }
    const swatch = this.children[0];
    const color = entry.series?.color || "";
    if (swatch.dataset.color !== color) { swatch.style.background = color; swatch.dataset.color = color; }
    const point = entry.series && pointForSeries(entry.series);
    const text = [entry.version != null ? "+" : "", entry.name, !entry.series ? "Compare" : point?.value == null ? "—" :
      state.mode === "percent" ? (Number.isFinite(point.percent) ? formatPercentage(point.percent) : "—") : compact(point.value)];
    const valueDescription = point?.value == null ? 'No observation' : state.mode === 'percent'
      ? Number.isFinite(point.percent) ? formatPercentage(point.percent) : 'Share unavailable'
      : `${number(point.value)} active daily installations`;
    const accessibleDescription = entry.series
      ? `${legendDate ? dateLabel(legendDate) + ': ' : ''}${valueDescription}. ${entry.series.visible ? 'Shown on' : 'Hidden from'} the chart.`
      : 'Add this recorded version to a custom comparison.';
    if (this.getAttribute('aria-description') !== accessibleDescription) this.setAttribute('aria-description', accessibleDescription);
    text.forEach((value, index) => { if (this.children[index].textContent !== value) this.children[index].textContent = value; });
  });
  const visibleCount = currentResult.series.filter(series => series.visible).length;
  $("#legend-status").textContent = `${matching.length} of ${currentResult.series.length} series listed · ${visibleCount} shown on chart.${hideSmallVersions ? " Shares below 0.1% hidden from this list." : query ? " Search includes small versions." : ""}`;
  $("#clear-legend-search").hidden = !search.value;
  $("#focus-matching").disabled = !query || !matching.length;
  $("#hide-series").disabled = !visibleCount;
  $("#reset-hidden").disabled = state.grouping === legendDefaults.grouping &&
    state.versionCutoff === legendDefaults.versionCutoff &&
    state.combineReleaseVersions === legendDefaults.combineReleaseVersions &&
    state.groupSmallSeries === legendDefaults.groupSmallSeries &&
    state.channels.length === legendDefaults.channels.length && legendDefaults.channels.every(channel => state.channels.includes(channel)) &&
    !search.value && !state.showSmallVersions && !state.hiddenSeries.length &&
    JSON.stringify(cleanGroups(state.groups)) === defaultGroupsKey && legendDate === defaultLegendDate;
  $("#legend-empty").hidden = Boolean(entries.length);
  $("#legend-empty").textContent = query ? "No matching series. Try another search or reset the legend." : hideSmallVersions ?
    "No versions reach 0.1% on this date. Show versions below 0.1% or select another date." : "No series available for this selection.";
}
function explorerExportSeries() { return currentResult.series.filter(series => $("#explorer-include-hidden").checked || series.visible); }
function renderTable() {
  if (!currentResult) return;
  const rows = currentResult.totals.slice(-200).reverse();
  const series = explorerExportSeries();
  $("#explorer-table").innerHTML =
    `<p>Latest ${rows.length} dates. CSV includes the full selected range. ${$("#explorer-include-hidden").checked ? "Includes hidden series." : "Visible series only."}</p><table><caption class="sr-only">Versions and channels: ${esc(dateLabel(state.startDate))} to ${esc(dateLabel(state.endDate))}. Counts are active daily installations.</caption><thead><tr><th scope="col">Date</th><th scope="col">Selected population</th>${series.map((s) => `<th scope="col">${esc(s.name)}</th>${state.mode === "percent" ? `<th scope="col">${esc(s.name)} share</th>` : ""}`).join("")}</tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr><th scope="row">${r.date}</th><td>${r.value == null ? "—" : number(r.value)}</td>${series
            .map((s) => {
              const p = s.values[currentDateIndexes.get(r.date)];
              return `<td>${p?.value == null ? "—" : number(p.value)}</td>${state.mode === "percent" ? `<td>${Number.isFinite(p?.percent) ? formatPercentage(p.percent) : "—"}</td>` : ""}`;
            })
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`;
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
function exportCSV() {
  if (!currentResult) return;
  const header = [
    "Date",
    "Selected population",
    ...explorerExportSeries().flatMap((s) => state.mode === "percent" ? [s.name, `${s.name} share (%)`] : [s.name]),
  ];
  const rows = currentResult.totals.map((t, i) => [
    t.date,
    t.value,
    ...explorerExportSeries().flatMap((s) => state.mode === "percent" ? [s.values[i]?.value, Number.isFinite(s.values[i]?.percent) ? Number(s.values[i].percent.toFixed(4)) : null] : [s.values[i]?.value]),
  ]);
  download(
    "thunderbird-adoption.csv",
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function groupEditor() {
  const active = document.activeElement;
  const focusedRow = active.closest?.('[data-group]')?.dataset.group;
  const focusedField = active.dataset?.field;
  $("#group-rows").innerHTML = state.groups
    .map(
      (g, i) =>
        `<div class="group-row" data-group="${i}"><label><span class="sr-only">Color for ${esc(g.name)}</span><input type="color" data-field="color" value="${esc(g.color || colorForSeries(g.id))}"></label><label>Group name<input type="text" data-field="name" value="${esc(g.name)}" maxlength="80"></label><label>From version<input type="text" data-field="minVersion" value="${esc(g.minVersion ?? g.minMajor ?? "")}" placeholder="Any" ${g.remainder ? "disabled" : ""}></label><label>Through version<input type="text" data-field="maxVersion" value="${esc(g.maxVersion ?? g.maxMajor ?? "")}" placeholder="Any" ${g.remainder ? "disabled" : ""}></label><label>Include versions<input type="text" data-field="versions" value="${esc((g.versions || []).join(", "))}" placeholder="e.g. 128, 140.0.1" ${g.remainder ? "disabled" : ""}></label><div class="group-actions"><button class="icon-button" data-action="up" aria-label="Move ${esc(g.name)} up" ${i === 0 ? "disabled" : ""}>↑</button><button class="icon-button" data-action="down" aria-label="Move ${esc(g.name)} down" ${i === state.groups.length - 1 ? "disabled" : ""}>↓</button><button class="icon-button" data-action="remove" aria-label="Remove ${esc(g.name)}">×</button></div><div class="group-extra">${g.remainder ? "<span>All installations not matched above</span>" : `<label>Channels<input type="text" data-field="channels" value="${esc((g.channels || []).join(", "))}" placeholder="Any, or esr, release"></label><label>Exclude channels<input type="text" data-field="excludeChannels" value="${esc((g.excludeChannels || []).join(", "))}" placeholder="e.g. beta, nightly"></label><label>Exclude versions<input type="text" data-field="excludeVersions" value="${esc((g.excludeVersions || []).join(", "))}" placeholder="e.g. 128.0"></label><label>Latest ESR<select data-field="latestEsr"><option value="">Off</option><option value="historical" ${g.latestEsr === "historical" ? "selected" : ""}>At each date</option><option value="pinned" ${g.latestEsr === "pinned" ? "selected" : ""}>Pinned family</option></select></label>${g.latestEsr === "pinned" ? `<label>Family<input type="number" min="1" data-field="pinnedMajor" value="${g.pinnedMajor || 140}"></label>` : ""}<label><input type="checkbox" data-field="latestPatch" ${g.latestPatch ? "checked" : ""}>Latest patch only</label>`}<label><input type="checkbox" data-field="visible" ${g.visible !== false ? "checked" : ""}>Visible</label></div></div>`,
    )
    .join("");
  if (focusedRow != null && focusedField)
    $(`#group-rows [data-group="${focusedRow}"] [data-field="${focusedField}"]`)?.focus();
}
function toggleEditor(open) {
  const restoreFocus = $("#group-editor").contains(document.activeElement);
  $("#group-editor").hidden = !open;
  $("#edit-groups").setAttribute("aria-expanded", String(open));
  if (open) { groupEditor(); $("#group-preset").focus(); }
  else if (restoreFocus) $("#edit-groups").focus();
}
function basicSeries(records, definitions, cadence = 0, bounds = []) {
  if (cadence && records.length) {
    const byDate = new Map(records);
    const complete = [];
    for (
      let t = Date.parse(bounds[0] || records[0][0]);
      t <= Date.parse(bounds.at(-1) || records.at(-1)[0]);
      t += cadence * 86400000
    ) {
      const date = new Date(t).toISOString().slice(0, 10);
      complete.push([date, byDate.get(date)]);
    }
    records = complete;
  }
  const colors = assignSeriesColors(definitions.map((d) => ({ id: d.id || d.name, color: d.color })));
  return definitions.map((d, i) => ({
    id: d.id || d.name,
    name: d.name,
    color: colors[i],
    visible: true,
    values: records.map(([date, r]) => {
      if (r == null)
        return { date, value: null, percent: null, total: null, missing: true };
      const value = d.value(r);
      return {
        date,
        value: value == null ? null : value,
        percent: d.percent ? d.percent(r) : null,
        total: d.total ? d.total(r) : value,
        missing: value == null,
        unpublished: value == null && Boolean(d.note),
        note: d.note ? d.note(r) : undefined,
      };
    }),
  }));
}
function card(id, title, description, series, options = {}) {
  const {meta: suppliedMeta = "", unit = "", yLabel = "", height = 325,
    dateRange = true, overview = null, curve, initialRange = "all",
    breakdown = false, totalLabel = "", monthComparison = false} = options;
  const modes = options.modes || (breakdown ? ["lines", "area", "bars", "count", "percent"] : ["lines", "area", "bars"]);
  const savedKey = options.stateKey || `${id}:${description}`;
  const saved = secondaryViews.get(savedKey) || {};
  const seriesControls = options.seriesControls || [];
  const controlValues = Object.fromEntries(seriesControls.map(control => [control.id, saved.controls?.[control.id] ?? control.checked]));
  const hiddenSeries = new Set(saved.hidden || []);
  const prepareSeries = items => items.map(s => ({...s, visible: s.visible !== false && !hiddenSeries.has(s.id)}));
  let sourceSeries = options.seriesForControls ? options.seriesForControls(controlValues) : series;
  series = prepareSeries(sourceSeries);
  const allowSmallGrouping = breakdown && series.length > 1;
  let combineSmall = saved.combineSmall ?? false, preparedKey = null;
  let filterLegend = () => {};
  let mode = modes.includes(saved.mode) ? saved.mode : options.mode || modes[0];
  let view = breakdown && saved.view === "snapshot" ? "snapshot" : "history";
  let scale = saved.scale || "linear", snapshotDate = saved.snapshotDate;
  let includeHidden = false, includeShares = false;
  const article = document.createElement("article");
  article.className = "chart-card secondary-card";
  article.setAttribute("aria-labelledby", `${id}-title`);
  const observed = [...new Set(series.flatMap(s => s.values.filter(v => !v.missing).map(v => v.date)))].sort();
  const timelineDates = [...new Set(series.flatMap(item => item.values.map(point => point.date)))].sort();
  const first = monthComparison ? options.startDate : timelineDates[0];
  const last = monthComparison ? options.endDate : timelineDates.at(-1);
  const monthLabel = date => new Intl.DateTimeFormat("en", {timeZone:"UTC", month:"long"}).format(new Date(`${date}T00:00:00Z`));
  const labelDate = monthComparison ? monthLabel : dateLabel;
  let meta = suppliedMeta;
  if (series.some(s => s.id === "__other__")) meta += " Other (publication aggregate) contains labels combined when preparing the public dataset, including labels below its reporting threshold; the site cannot reconstruct their individual values. All individually published categories remain available.";
  if (!monthComparison) meta = `${observed.length ? `Observations: ${dateLabel(observed[0])} – ${dateLabel(observed.at(-1))}.` : "No observations."} ${meta}`;
  article.innerHTML = `
    <div class="card-top">
      <div><h3 id="${id}-title">${esc(title)}</h3><p>${esc(description)}</p></div>
      <div class="chart-exports">
        ${options.link ? `<button type="button" class="button quiet" data-chart-link title="Copy direct link to ${esc(title)}">Copy link</button>` : ""}
        <button type="button" class="button quiet" data-svg>Download SVG</button>
        <button type="button" class="button quiet" data-export="${id}">Download CSV</button>
      </div>
    </div>
    ${breakdown ? `<div class="chart-controls chart-specific-controls">
      <label>View<select data-chart-view><option value="history">History</option><option value="snapshot">Latest breakdown</option></select></label>
      <label data-snapshot-control hidden>Observation<select data-snapshot-date></select></label>
      <label data-scale-control hidden>Scale<select data-snapshot-scale><option value="linear">Linear</option><option value="log">Logarithmic</option></select></label>
      ${seriesControls.map(control => `<label class="series-grouping-control"><input type="checkbox" data-series-control="${esc(control.id)}"${controlValues[control.id] ? " checked" : ""}> ${esc(control.label)}</label>`).join("")}
      ${allowSmallGrouping ? `<label class="series-grouping-control" title="${esc(SMALL_SERIES_HELP)}"><input type="checkbox" data-group-small-series aria-describedby="${id}-small-series-help"${combineSmall ? " checked" : ""}> ${SMALL_SERIES_LABEL}</label><span class="sr-only" id="${id}-small-series-help">${esc(SMALL_SERIES_HELP)}</span>` : ""}
    </div>` : ""}
    <div id="${id}" class="secondary-chart"></div>
    <div class="secondary-legend"></div>
    ${meta ? `<p class="secondary-meta">${esc(meta)}</p>` : ""}`;
  article.querySelector('[data-chart-link]')?.addEventListener('click', () => copyViewLink(options.link, "Chart link copied."));
  $("#secondary-content").append(article);
  const legend = article.querySelector('.secondary-legend');
  const legendItems = new Map();
  function renderLegend() {
    legend.innerHTML = series.map(s => `<button type="button" class="legend-item${s.visible ? '' : ' off'}" aria-pressed="${s.visible}" aria-label="Toggle ${esc(s.name)}"><span class="legend-swatch" style="background:${esc(s.color)}"></span>${esc(s.name)}</button>`).join("");
    legendItems.clear();
    [...legend.children].forEach((node, index) => {
      const item = series[index];
      node.dataset.series = item.id;
      globalThis.d3.select(node).datum(item);
      legendItems.set(item.id, node);
    });
  }
  renderLegend();
  const rangeKey = `${savedKey}:${first}:${last}`;
  let selectedRange = dateRange && first && last ? secondaryRanges.get(rangeKey) || presetDateRange(initialRange, first, last) : null;
  // Reuse the Explorer toolbar so shared controls keep the same layout on every tab.
  const toolbar = $("#explore-view .chart-toolbar").cloneNode(true);
  const styles = toolbar.querySelector('.chart-style-buttons');
  styles.id = `${id}-styles`;
  styles.innerHTML = chartStyleButtons(modes, mode, id);
  article.querySelector('.card-top').after(toolbar);
  if (!selectedRange) toolbar.querySelector('.range-toolbar').remove();
  const selectSeries = (items = series) => selectedRange ? items.map(s => ({...s, values:s.values.filter(p => p.date >= selectedRange.startDate && p.date <= selectedRange.endDate)})) : items;
  let displayedSeries = selectSeries(), rangeControls, rangeError, dataDetails, controller;
  const plot = article.querySelector('.secondary-chart');
  const formatValue = value => unit === "currency" ? new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0}).format(value) : unit === "percent" ? `${new Intl.NumberFormat("en",{maximumFractionDigits:2}).format(value)}%` : number(value);
  function remember() { secondaryViews.set(savedKey, {mode,view,scale,snapshotDate,combineSmall,hidden:[...hiddenSeries],controls:{...controlValues}}); }
  function selectedDates() { return [...new Set(displayedSeries.flatMap(s => s.values.filter(p => !p.missing).map(p => p.date)))].sort(); }
  function syncSnapshot() {
    if (!breakdown) return;
    const dates = selectedDates();
    if (!dates.includes(snapshotDate)) snapshotDate = dates.at(-1);
    const select = article.querySelector('[data-snapshot-date]');
    select.replaceChildren(...[...dates].reverse().map(date => new Option(labelDate(date),date)));
    select.value = snapshotDate || "";
  }
  function renderPlot(recreate = false) {
    if (recreate && controller) { controller.destroy(); controller = null; }
    const key = JSON.stringify([selectedRange, controlValues, combineSmall]);
    if (preparedKey !== key) {
      series = prepareSeries(groupSmallSeries(selectSeries(prepareSeries(sourceSeries)), {enabled: allowSmallGrouping && combineSmall}));
      preparedKey = key;
      renderLegend(); filterLegend();
    }
    displayedSeries = selectSeries();
    syncSnapshot(); remember();
    let legendOrder = series;
    if (view === "history" && ["area", "count", "percent"].includes(mode)) {
      const referenceDate = selectedDates().findLast(date => displayedSeries.some(item => Number.isFinite(item.values.find(point => point.date === date)?.value)));
      legendOrder = orderSeriesByValue(displayedSeries, item => {
        const point = item.values.find(point => point.date === referenceDate);
        return mode === "percent" ? point?.percent : point?.value;
      });
    }
    globalThis.d3.select(legend).selectAll('.legend-item').data(legendOrder, item => item.id).order();
    article.querySelectorAll('[data-chart-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.chartMode === mode)));
    article.querySelector('[data-mode-control]').hidden = view === "snapshot";
    if (breakdown) {
      article.querySelector('[data-chart-view]').value = view;
      article.querySelector('[data-snapshot-control]').hidden = view !== "snapshot";
      article.querySelector('[data-scale-control]').hidden = view !== "snapshot";
      article.querySelector('[data-snapshot-scale]').value = scale;
    }
    if (view === "snapshot") {
      const items = displayedSeries.filter(s => s.visible).map(s => ({...s,...s.values.find(p => p.date === snapshotDate), total: totalLabel ? s.values.find(p => p.date === snapshotDate)?.total : undefined}));
      const opts = {title:`${title} · ${snapshotDate ? labelDate(snapshotDate) : 'No observation'}`,scale,unit:unit === 'percent' || unit === 'currency' ? '' : unit,integerValues:unit !== 'percent',formatValue,totalLabel,formatTotal:number,dataTableId:`${id}-data-table`};
      if (controller) controller.update(items,opts); else controller = renderBreakdown(plot,items,opts);
    } else {
      const opts = {mode,height,title,curve,...(selectedRange || {}),
        yLabel: mode === "percent" ? `Share of ${unit || "published values"} (%)` : yLabel || (unit === "currency" ? "USD" : unit === "percent" ? "Share of reporting clients (%)" : unit || "Reported value"),
        unit,formatValue,totalLabel,formatTotal:number,annotations:options.annotations,tickInterval:options.tickInterval,dataTableId:`${id}-data-table`,
        ...(monthComparison ? {tickInterval:'month',formatDate:date => monthLabel(date.toISOString().slice(0,10)),formatTick:date => new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'short'}).format(date)} : {}),
        ...(overview && selectedRange ? {overview,onRangeChange:([startDate,endDate]) => changeRange({range:"custom",startDate,endDate})} : {})};
      if (controller) controller.update(displayedSeries,opts); else controller = renderChart(plot,displayedSeries,opts);
    }
    if (dataDetails?.open) renderDataTable();
  }
  if (selectedRange) {
    if (monthComparison) {
      rangeControls = document.createElement('div');
      rangeControls.className = 'range-toolbar comparison-month-range';
      const months = Array.from({length:12},(_,i) => `${first.slice(0,4)}-${String(i+1).padStart(2,'0')}-01`);
      rangeControls.innerHTML = `<div class="range-presets" role="group" aria-label="Date range"><span class="range-label">Month range</span><button class="button quiet" data-card-range="all">All months</button></div><div class="date-fields"><label><span>From</span><select data-month-start>${months.map(d=>`<option value="${d}">${monthLabel(d)}</option>`).join('')}</select></label><span aria-hidden="true">—</span><label><span>To</span><select data-month-end>${months.map(d=>`<option value="${d}">${monthLabel(d)}</option>`).join('')}</select></label></div>`;
      toolbar.querySelector('.range-toolbar').replaceWith(rangeControls);
    } else {
      rangeControls = toolbar.querySelector('.range-toolbar');
      const [start,end] = rangeControls.querySelectorAll('input[type="date"]');
      start.id = `${id}-start-date`; end.id = `${id}-end-date`;
      for(const input of [start,end]) { input.min=first; input.max=last; }
      if (options.rangePresets) {
        const presets = rangeControls.querySelector('.range-presets');
        presets.querySelectorAll('button').forEach(button => button.remove());
        for (const range of options.rangePresets) {
          const button = document.createElement('button'); button.dataset.range = range;
          button.textContent = ({'5y':'5Y','10y':'10Y',all:'All time'})[range] || range.toUpperCase();
          presets.append(button);
        }
      }
      rangeControls.querySelectorAll('[data-range]').forEach(button=>{button.dataset.cardRange=button.dataset.range;delete button.dataset.range;});
    }
    rangeError = document.createElement('p');rangeError.id=`${id}-range-error`;rangeError.className='chart-warning';rangeError.setAttribute('role','alert');rangeError.hidden=true;toolbar.after(rangeError);
    rangeControls.querySelectorAll('input,select').forEach(input=>input.setAttribute('aria-describedby',rangeError.id));
    if(overview) { const hint=document.createElement('p');hint.className='range-help';hint.textContent='Choose a preset, set dates, or drag the timeline handles below the chart.';rangeError.after(hint); }
  }
  function syncRange() {
    if(!rangeControls) return;
    if(monthComparison) { rangeControls.querySelector('[data-month-start]').value=selectedRange.startDate;rangeControls.querySelector('[data-month-end]').value=selectedRange.endDate; }
    else { rangeControls.querySelector('input[id$="-start-date"]').value=selectedRange.startDate;rangeControls.querySelector('input[id$="-end-date"]').value=selectedRange.endDate; }
    rangeControls.querySelectorAll('[data-card-range]').forEach(button=>{const active=button.dataset.cardRange===selectedRange.range;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  }
  function changeRange(next) {
    const invalid=!isDay(next.startDate)||!isDay(next.endDate)||next.startDate>next.endDate||next.startDate<first||next.endDate>last;
    rangeControls.querySelectorAll('input,select').forEach(input=>input.setAttribute('aria-invalid',String(invalid)));
    if(invalid) {
      rangeError.textContent=`Choose ${monthComparison?'months':'dates'} from ${labelDate(first)} to ${labelDate(last)}, with the start before the end.`;rangeError.hidden=false;return;
    }
    rangeError.hidden=true;selectedRange=next;secondaryRanges.set(rangeKey,next);syncRange();renderPlot();
  }
  syncRange();renderPlot();
  secondaryCharts.push({
    destroy:()=>controller?.destroy(),
    ...(options.channelSensitive ? {refreshChannels:()=>{
      sourceSeries=options.seriesForControls(controlValues);
      preparedKey=null;
      renderPlot();
    }} : {}),
  });
  rangeControls?.querySelectorAll('[data-card-range]').forEach(button=>button.addEventListener('click',()=>changeRange(presetDateRange(button.dataset.cardRange,first,last))));
  rangeControls?.querySelectorAll('input[type="date"],select').forEach(input=>input.addEventListener('change',()=>{
    const [start,end]=rangeControls.querySelectorAll(monthComparison?'select':'input[type="date"]');changeRange({range:'custom',startDate:start.value,endDate:end.value});
  }));
  const announceChart = () => announceStatus(`${title} updated. ${view === 'snapshot' ? `Breakdown for ${snapshotDate ? labelDate(snapshotDate) : 'no observation'}.` : `${chartStyles[mode].label}.`} ${series.filter(item=>item.visible).length} series shown.`);
  article.querySelectorAll('[data-chart-mode]').forEach(button => button.addEventListener('click',()=>{mode=button.dataset.chartMode;renderPlot();announceChart();}));
  article.querySelector('[data-chart-view]')?.addEventListener('change',event=>{view=event.target.value;renderPlot(true);announceChart();});
  article.querySelector('[data-snapshot-date]')?.addEventListener('change',event=>{snapshotDate=event.target.value;renderPlot();announceChart();});
  article.querySelector('[data-snapshot-scale]')?.addEventListener('change',event=>{scale=event.target.value;renderPlot();announceChart();});
  function syncLegend() { series.forEach(item=>{if(item.visible)hiddenSeries.delete(item.id);else hiddenSeries.add(item.id);const button=legendItems.get(item.id);button.classList.toggle('off',!item.visible);button.setAttribute('aria-pressed',String(item.visible));});renderPlot(); }
  legend.addEventListener('click',event=>{
    const button=event.target.closest('[data-series]');
    if(!button)return;
    const item=series.find(item=>item.id===button.dataset.series);
    item.visible=!item.visible;syncLegend();announceChart();
  });
  {
    const tools=document.createElement('div');tools.className='series-selection-controls';
    tools.innerHTML='<label>Find series<input type="search" placeholder="Filter the legend…" /></label><button class="button quiet" data-select-series="all">Show all</button><button class="button quiet" data-select-series="none">Hide all</button><button class="button quiet" data-select-series="matching">Show only matching</button>';
    legend.before(tools);const search=tools.querySelector('input');
    filterLegend = () => {
      tools.hidden=series.length<=4&&!search.value;
      globalThis.d3.select(legend).selectAll('.legend-item').each(function(item){this.hidden=!item.name.toLowerCase().includes(search.value.trim().toLowerCase());});
    };
    filterLegend();
    search.addEventListener('input',()=>{
      filterLegend();
      announceStatus(`${series.filter(item=>!legendItems.get(item.id).hidden).length} matching series in ${title}.`);
    });
    tools.querySelectorAll('[data-select-series]').forEach(button=>button.addEventListener('click',()=>{series.forEach(s=>{s.visible=button.dataset.selectSeries==='all'||(button.dataset.selectSeries==='matching'&&s.name.toLowerCase().includes(search.value.trim().toLowerCase()));});syncLegend();announceChart();}));
    article.querySelectorAll('[data-series-control]').forEach(input=>input.addEventListener('change',()=>{
      controlValues[input.dataset.seriesControl]=input.checked;
      sourceSeries=options.seriesForControls(controlValues);
      preparedKey=null;
      renderPlot();announceChart();
    }));
    article.querySelector('[data-group-small-series]')?.addEventListener('change',event=>{
      combineSmall=event.target.checked;
      renderPlot();announceChart();
    });
  }
  dataDetails=document.createElement('details');dataDetails.className='data-table-details chart-data-table secondary-data-table';
  dataDetails.id=`${id}-data-table`;
  dataDetails.innerHTML=`<summary aria-label="View data table for ${esc(title)}">View data table</summary><div class="data-scope"><label><input type="checkbox" data-hidden-series> Include hidden series in table and CSV</label>${series.some(s=>s.values.some(p=>p.percent!=null))&&unit!=='percent'?'<label><input type="checkbox" data-shares> Include shares (%)</label>':''}</div><div class="table-scroll" tabindex="0" role="region" aria-label="${esc(title)} data table"></div>`;
  article.append(dataDetails);
  const exportSeries=()=>displayedSeries.filter(s=>includeHidden||s.visible);
  function exportRows() {
    const selected=exportSeries();
    const dates=view==='snapshot' ? (snapshotDate?[snapshotDate]:[]) : [...new Set(selected.flatMap(s=>s.values.map(p=>p.date)))].sort();
    const header=[monthComparison?'Month':'Date',...selected.flatMap(s=>[`${s.name}${unit?` (${unit==='currency'?'USD':unit==='percent'?'%':unit})`:''}`,...(includeShares?[`${s.name} share (%)`]:[])])];
    return [header,...dates.map(d=>[monthComparison?monthLabel(d):d,...selected.flatMap(s=>{const p=s.values.find(p=>p.date===d);return[p?.value,...(includeShares?[p?.percent]:[])];})])];
  }
  function renderDataTable() {
    const [header,...rows]=exportRows();const shown=rows.slice(-200).reverse();
    dataDetails.querySelector('.table-scroll').innerHTML=`<p>${view==='snapshot'?'Selected observation':`Latest ${shown.length} selected dates`}. Values: ${esc(unit==='currency'?'USD':unit==='percent'?'percent':unit||'reported values')}. ${includeHidden?'Includes hidden series.':'Visible series only.'} Download CSV for the full selection.</p><table><caption class="sr-only">${esc(title)}: ${view==='snapshot'&&snapshotDate?esc(labelDate(snapshotDate)):selectedRange?`${esc(labelDate(selectedRange.startDate))} to ${esc(labelDate(selectedRange.endDate))}`:'all observations'}. Values in ${esc(unit||'reported units')}.</caption><thead><tr>${header.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map(row=>`<tr><th scope="row">${esc(row[0])}</th>${row.slice(1).map((value,index)=>`<td>${value==null?'—':(unit==='percent'||(includeShares&&index%2===1)?new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(value):number(value))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  dataDetails.addEventListener('toggle',()=>{if(dataDetails.open)renderDataTable();});
  dataDetails.querySelector('[data-hidden-series]').addEventListener('change',event=>{includeHidden=event.target.checked;renderDataTable();});
  dataDetails.querySelector('[data-shares]')?.addEventListener('change',event=>{includeShares=event.target.checked;renderDataTable();});
  article.querySelector('[data-export]').addEventListener('click',()=>download(`${id}.csv`,exportRows().map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8'));
  article.querySelector('[data-svg]').addEventListener('click',()=>download(`${id}.svg`,controller.exportSVG(),'image/svg+xml;charset=utf-8'));
  return article;
}
const tabInfo = {
  daily: [
    "Daily active installations",
    "The daily rhythm of Thunderbird, estimated from application and add-on update requests.",
  ],
  mau: [
    "Monthly active installations",
    "A weekly view of estimated monthly activity, using the existing Glean coverage adjustment.",
  ],
  telemetry: [
    "A closer look at the community.",
    "Feature use reported by Thunderbird Desktop through Glean.",
  ],
  addons: [
    "Small additions. Big possibilities.",
    "Explore add-on adoption across the Thunderbird community.",
  ],
  platforms: [
    "Different systems. Shared conversations.",
    "Operating systems and application languages reported by Thunderbird Desktop.",
  ],
  financials: [
    "Built on your support.",
    "Donations and spending from the existing published financial data.",
  ],
  support: [
    "A community that shows up.",
    "Questions asked in Thunderbird Support, using the existing SUMO data.",
  ],
};
async function loadGlean() {
  if (!manifest.glean) return null;
  return json(`data/${manifest.glean}`);
}
function empty(title, description) {
  $("#secondary-content").innerHTML =
    `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`;
}
async function showSecondary(tab, link = null) {
  const id = ++requestId;
  secondaryCharts.forEach((c) => c.destroy());
  secondaryCharts = [];
  const [introTitle, introDescription] = tabInfo[tab];
  if (link) {
    metricSelections.set("telemetry-view", link.metric);
    if (link.metric === OAUTH_METRIC) {
      oauthSelection.provider = link.provider;
      oauthSelection.dimension = link.dimension;
    } else {
      metricSelections.set(link.source === "legacy" ? "legacy" : "glean", link.metric);
    }
  }
  const oauthView = tab === "telemetry" && metricSelections.get("telemetry-view") === OAUTH_METRIC;
  const sourceKey = oauthView ? "telemetry-oauth" : tab;
  if (secondarySourceTab) secondarySources.set(secondarySourceTab, $("#archive").value);
  const previousSource = link?.source || secondarySources.get(sourceKey) || "current";
  secondarySourceTab = sourceKey;
  $("#archive").innerHTML =
    `<option value="current">${tab === "addons" ? "Existing telemetry" : "Current · Glean"}</option>${tab === "addons" ? '<option value="glean">Glean add-ons · different population</option><option value="updates">Earlier update-request estimates</option>' : ""}<option value="legacy">${oauthView ? "Archived Glean · 2025 snapshot" : "Historical · through May 2025"}</option>`;
  $("#archive").value =
    previousSource === "glean" && tab !== "addons" ? "current" : previousSource;
  $("#secondary-title").textContent = introTitle;
  $("#secondary-description").textContent = introDescription;
  $("#archive-control").hidden = !["telemetry", "platforms", "addons"].includes(
    tab,
  );
  $("#secondary-content").innerHTML =
    '<div class="loading-state">Loading observations…</div>';
  $("#secondary-content").setAttribute("aria-busy", "true");
  notice("");
  try {
    const historical = $("#archive").value === "legacy";
    const glean =
      (["telemetry", "platforms"].includes(tab) && (!historical || oauthView)) ||
      (tab === "addons" && $("#archive").value === "glean")
        ? await loadGlean()
        : null;
    if (id !== requestId) return;
    const weeks = Object.keys(glean?.coverage?.weeks || {}).sort();
    $("#secondary-content").innerHTML = "";
    if (glean && !historical) {
      const firstWeek = weeks[0], requestedStart = glean.coverage?.start;
      const pending = glean.coverage?.pending || [];
      const relevantSections = tab === "platforms" ? ["baseline"]
        : tab === "telemetry" ? (oauthView ? ["metrics", "oauth"] : ["metrics"]) : ["addons"];
      const unavailable = weeks.filter(week => relevantSections.some(section =>
        glean.coverage.weeks[week][section]?.status === "unavailable"));
      const recovered = tab === "platforms" ? weeks.filter(week =>
        glean.coverage.weeks[week].baseline?.source === "baseline_clients_last_seen") : [];
      const explanations = [];
      if (unavailable.length) explanations.push(
        `Glean source data is unavailable for ${unavailable.length} week${unavailable.length === 1 ? "" : "s"} ending ${dateLabel(unavailable[0])}–${dateLabel(unavailable.at(-1))}. Missing values are gaps, not zero activity.`,
      );
      if (recovered.length) explanations.push(
        `Weeks ending ${dateLabel(recovered[0])}–${dateLabel(recovered.at(-1))} use archived Glean daily summaries, with each client's latest daily modal dimensions. Later weeks use the latest ping. Older Windows versions may combine Windows 10 and 11 where build numbers were unavailable.`,
      );
      if ((requestedStart && firstWeek && requestedStart < firstWeek) || pending.length) {
        explanations.push(`${requestedStart && firstWeek && requestedStart < firstWeek ? `Published Glean week endings begin ${dateLabel(firstWeek)}. Earlier requested weeks since ${dateLabel(requestedStart)} are not available in this snapshot; the gap is not zero activity. ` : ""}${pending.length ? `${pending.length} requested week${pending.length === 1 ? " is" : "s are"} still pending collection.` : ""}`);
      }
      if (explanations.length) {
        const coverage = document.createElement("p"); coverage.className = "coverage-note"; coverage.setAttribute("role", "note");
        coverage.textContent = explanations.join(" ");
        $("#secondary-content").append(coverage);
      }
    }
    if (historical && !oauthView) {
      const cutoff = document.createElement("p"); cutoff.className = "coverage-note";
      cutoff.textContent = "This legacy archive intentionally ends May 31, 2025. The complete original source files are retained.";
      $("#secondary-content").append(cutoff);
    }
    if (tab === "daily") {
      if (id !== requestId) return;
      card(
        "daily-history",
        "Daily active installations",
        "Daily observations and their trailing 7-day moving average · all reported versions",
        dailySeries.map((s) => ({...s})),
        {
          dateRange: true,
          unit: "installations",
          mode: "area",
          initialRange: "6m",
          overview: allTotals,
          height: 390,
          curve: "linear",
          meta: "The moving average includes the selected day and the previous six calendar days. All seven observations are required; missing days remain gaps. ADI estimates installations from update requests, not individual people.",
        },
      );
    } else if (tab === "mau") {
      const data = await json("thunderbird_ami.json");
      if (id !== requestId) return;
      const records = Object.entries(data).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      card(
        "monthly-history",
        "Monthly active installations",
        "Weekly observations · existing coverage-adjusted estimate",
        basicSeries(
          records,
          [
            {
              name: "Monthly active installations",
              color: "#458cd9",
              value: (r) => Math.trunc(r.ami / r["78"]),
            },
          ],
          7,
        ),
        {
          dateRange: true, unit: "installations", mode: "area",
          annotations: [{date: "2025-05-04", label: "Glean coverage adjustment begins"}],
          meta: "From May 4, 2025, raw 28-day Glean activity is adjusted using the existing weekday ADI coverage factor. Earlier values retain the legacy method.",
        },
      );
    } else if (tab === "telemetry") {
      let metrics;
      if (historical && !oauthView) {
        const data = await json("telemetry.json");
        metrics = Object.fromEntries(
          Object.entries(data).map(([key, records]) => [
            key,
            {
              label: key,
              unit: "reporting clients",
              description: "Legacy telemetry · through May 31, 2025",
              records: Object.fromEntries(
                Object.entries(records).filter(
                  ([d]) => d <= manifest.archive_end,
                ),
              ),
            },
          ]),
        );
      } else if (glean?.metrics) {
        metrics = glean.metrics;
      }
      if (id !== requestId) return;
      const archive = oauthView && historical ? await json("oauth.json") : null;
      if (id !== requestId) return;
      const available = telemetryMetricChoices(metrics);
      const rememberedMetric = metricSelections.get(historical ? "legacy" : "glean");
      const selectedMetric = oauthView ? OAUTH_METRIC : available.some(([key]) => key === rememberedMetric) ? rememberedMetric : available[0]?.[0] || OAUTH_METRIC;
      metricSelections.set("telemetry-view", selectedMetric);
      if (selectedMetric !== OAUTH_METRIC) metricSelections.set(historical ? "legacy" : "glean", selectedMetric);
      if (link && link.metric !== selectedMetric) toast("That telemetry metric is unavailable in this data source. Showing an available metric.");
      if (!oauthView && selectedMetric === OAUTH_METRIC) {
        showSecondary(tab, link ? {...link, metric: OAUTH_METRIC} : null);
        return;
      }
      renderTelemetryNavigation(available, {
        metricSource: historical && !oauthView ? "legacy" : "current",
        oauthSource: oauthView ? historical ? "legacy" : "current" : secondarySources.get("telemetry-oauth") || "current",
      });
      const host = document.createElement("div");
      host.id = "metric-content";
      host.setAttribute("role", "region");
      host.setAttribute("aria-label", `Telemetry: ${selectedMetric === OAUTH_METRIC ? "OAuth Providers" : available.find(([key]) => key === selectedMetric)[1].label || selectedMetric}`);
      $("#secondary-content").append(host);
      if (selectedMetric === OAUTH_METRIC) {
        showOAuth(glean, archive, weeks, host);
      } else {
        const [key, m] = available.find(([key]) => key === selectedMetric);
        const records = Object.entries(m.records).sort(([a], [b]) => a.localeCompare(b));
        const definitions = rankedDefinitions(records);
        const series = basicSeries(records, definitions, 7, weeks);
        const url = updateTelemetryURL({metric: key, source: historical ? "legacy" : "current"});
        const articleParent = $("#secondary-content");
        const before = articleParent.children.length;
        card("feature-usage", m.label || key, m.description || m.unit, series, {
          mode: !historical && m.kind === "gauge" ? "count" : "lines",
          breakdown: true, totalLabel: "Reporting clients", stateKey: `metric:${historical}:${key}`,
          link: url,
          unit: m.unit || "reported values",
          meta: `${historical ? "Legacy telemetry" : "Glean"} · ${m.unit || "reported values"}. ${m.methodology || m.aggregation || ""} Latest week: ${number(records.at(-1)[1].count)} reporting clients. Every published category is available individually. Counts refer to this metric’s reporting population.`,
        });
        host.append(articleParent.children[before]);
      }
      if (link) {
        const chartId = selectedMetric === OAUTH_METRIC
          ? link.chart === "accounts" && !historical ? "oauth-accounts" : `oauth-authentication-${historical ? "archive" : "current"}-${oauthSelection.dimension}`
          : "feature-usage";
        const target = document.getElementById(chartId)?.closest("article") || host.querySelector(".empty-state") || host.querySelector("article");
        if (target) {
          target.tabIndex = -1;
          target.focus({preventScroll: true});
          target.scrollIntoView({block: "start"});
        }
      }
    } else if (tab === "platforms") {
      if (historical) {
        for (const [file, title] of [
          ["locales.json", "Application languages"],
          ["platforms.json", "Operating systems"],
        ]) {
          const d = await json(file);
          if (id !== requestId) return;
          dimensionCard(
            file.replace(".json", ""),
            title,
            {
              description: file === "platforms.json"
                ? "The historical archive cannot separate Windows 10 from Windows 11, and did not record macOS or Linux versions."
                : undefined,
              records: Object.fromEntries(
                Object.entries(d).filter(
                  ([day]) => day <= manifest.archive_end,
                ),
              ),
            },
            true,
            [],
            file === "platforms.json",
          );
        }
      } else if (
        glean?.platforms &&
        Object.keys(glean.platforms.records || {}).length
      ) {
        dimensionCard(
          "glean-locales",
          "Application languages",
          glean.locales,
          false,
          weeks,
        );
        dimensionCard(
          "glean-platforms",
          "Operating systems",
          glean.platforms,
          false,
          weeks,
          true,
        );
      } else
        empty(
          "Glean platform data is not published yet.",
          "The next successful Glean collection will populate this view. Use the data-source selector to explore historical platforms and languages.",
        );
    } else if (tab === "addons") {
      const hasGlean =
        $("#archive").value === "glean" &&
        glean?.addons &&
        Object.keys(glean.addons.records || {}).length;
      if ($("#archive").value === "glean" && !hasGlean) {
        empty(
          "Glean add-on observations are not available yet.",
          "The existing telemetry series remains available from the data-source selector.",
        );
        return;
      }
      const updateRequests = $("#archive").value === "updates";
      const data = hasGlean
        ? glean.addons.records
        : await json(updateRequests ? "2020_addon_stats.json" : "addon_stats.json");
      if (id !== requestId) return;
      const records = Object.entries(data)
        .filter(([day]) => !historical || day <= manifest.archive_end)
        .sort(([a], [b]) => a.localeCompare(b));
      if (!hasGlean && !updateRequests && records.length) {
        $("#archive option[value=current]").textContent =
          `Existing telemetry · through ${dateLabel(records.at(-1)[0])}`;
      }
      const defs = [
        {
          name: "With add-ons",
          color: "#7561dc",
          value: (r) => (r.total ? (100 * r.addon_count) / r.total : null),
          total: (r) => r.total,
          percent: (r) => (r.total ? (100 * r.addon_count) / r.total : null),
        },
      ];
      if (records.some(([, r]) => r.minustop10_count != null))
        defs.push({
          name: hasGlean
            ? "Excluding Glean's weekly top 10"
            : "Excluding top 10 add-ons",
          color: "#40a3ce",
          value: (r) => (r.total ? (100 * r.minustop10_count) / r.total : null),
          total: (r) => r.total,
          percent: (r) =>
            r.total ? (100 * r.minustop10_count) / r.total : null,
        });
      card(
        "addon-adoption",
        "Add-on adoption",
        hasGlean
          ? "Glean · share of reporting clients"
          : updateRequests ? "Earlier update-request estimates · share of installations" : "Existing legacy telemetry · share of reporting clients",
        basicSeries(records, defs, updateRequests ? 1 : 7, hasGlean ? weeks : []),
        {
          mode: "lines", modes: ["lines", "area", "bars"], unit: "percent", totalLabel: updateRequests ? "Estimated installations" : "Reporting clients",
          yLabel: updateRequests ? "Share of estimated installations (%)" : "Share of reporting clients (%)",
          meta: updateRequests ? "Earlier estimates from add-on update requests, retained as a separate historical population. These estimates must not be spliced into the later telemetry or Glean series." : hasGlean
            ? `${glean.addons.description || "Glean active add-on snapshots, deduplicated by client."} ${glean.addons.comparison || "Top ten are ranked within Glean. This population and ranking differ from the existing telemetry series."}`
            : "The existing source and ATN top-ten ranking are retained. Glean add-on observations are available separately in the data-source selector because their population and top-ten definition differ.",
        },
      );

    } else if (tab === "support") {
      const data = await json("sumo.json");
      if (id !== requestId) return;
      card(
        "support-questions",
        "Questions in Thunderbird Support",
        "Questions asked over time",
        basicSeries(
          Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
          [{ name: "Support questions", color: "#3f9cad", value: (r) => r }],
        ),
        { unit: "questions", meta: "Source: existing SUMO collection." },
      );
    } else if (tab === "financials") {
      const d = await json("financials.json");
      if (id !== requestId) return;
      renderFunding(d, {container: $("#secondary-content"), card, announce: announceStatus, destroyCharts: () => {
        secondaryCharts.forEach(chart => chart.destroy()); secondaryCharts = [];
      }});
    }
  } catch (e) {
    if (id === requestId) {
      notice(e.message);
      empty(
        "This view could not be loaded.",
        "Please try again after the data is available.",
      );
    }
  } finally {
    if (id === requestId) {
      $("#secondary-content").setAttribute("aria-busy", "false");
      updatePageTitle();
      if (!$("#notice").textContent) announceStatus(`${document.title.split(' — ')[0]} loaded.`);
    }
  }
}
function showOAuth(glean, archive, weeks, container) {
  const historical = archive !== null;
  const selection = () => ({metric: OAUTH_METRIC, source: historical ? "legacy" : "current", ...oauthSelection});
  updateTelemetryURL({...selection(), chart: telemetryLinkFromHash()?.chart});
  const eventRecords = historical ? Object.entries(archive.total || {}) : Object.entries(glean?.oauth?.records || {});
  eventRecords.sort(([a], [b]) => a.localeCompare(b));
  const accounts = historical ? null : glean?.metrics?.mail_oauth2_provider_count;
  const accountRecords = Object.entries(accounts?.records || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!eventRecords.length && !accountRecords.length) {
    container.innerHTML = `<div class="empty-state"><h3>OAuth Providers</h3><p>${historical
      ? "The archived Glean snapshot contains no observations."
      : "OAuth observations are not available yet. The next OAuth Glean collection will populate this view. The earlier Glean snapshot is available from the data-source selector."}</p></div>`;
    return;
  }
  const archiveEntries = historical ? Object.entries(archive).filter(([key]) => key !== "total").map(([key, values]) => ({params: new URLSearchParams(key), values})) : [];
  const providers = [...new Set([
    ...eventRecords.flatMap(([, record]) => historical ? [] : [
      ...Object.keys(record.issuers || {}), ...Object.keys(record.breakdowns?.issuer || {}),
    ]),
    ...archiveEntries.map(({params}) => params.get("issuer")).filter(Boolean),
    ...accountRecords.flatMap(([, record]) => Object.keys(record.versions || {})),
  ])].sort();
  const dimensions = [
    ["issuer", "Provider"], ["result", "Outcome"], ["reason", "Reason"],
    ["channel", "Release channel"], ["version", historical ? "Version" : "Major version"],
    ...(!historical ? [["where", "Window type"]] : []),
  ];
  if (!providers.includes(oauthSelection.provider)) oauthSelection.provider = "";
  if (!dimensions.some(([key]) => key === oauthSelection.dimension)) oauthSelection.dimension = "issuer";
  const controls = document.createElement("div");
  controls.className = "chart-card secondary-card";
  controls.innerHTML = `<div class="card-top"><div><h3>OAuth Providers</h3><p>Incoming mail accounts and authentication prompts reported through Glean.</p></div></div><div class="oauth-controls"><label for="oauth-provider">Provider<select id="oauth-provider"><option value="">All providers</option>${providers.map(provider => `<option value="${esc(provider)}">${esc(provider === "__other__" ? "Other (publication aggregate)" : provider)}</option>`).join("")}</select></label><label for="oauth-grouping">Group authentication prompts by<select id="oauth-grouping">${dimensions.map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label></div>`;
  container.append(controls);
  const host = document.createElement("div");
  host.id = "oauth-charts";
  container.append(host);
  const providerSelect = controls.querySelector("#oauth-provider");
  const dimensionSelect = controls.querySelector("#oauth-grouping");
  providerSelect.value = oauthSelection.provider;
  dimensionSelect.value = oauthSelection.dimension;

  function render() {
    oauthSelection.provider = providerSelect.value;
    oauthSelection.dimension = dimensionSelect.value;
    updateTelemetryURL({...selection(), chart: telemetryLinkFromHash()?.chart});
    secondaryCharts.forEach(chart => chart.destroy());
    secondaryCharts = [];
    host.replaceChildren();
    const provider = oauthSelection.provider;
    const dimension = oauthSelection.dimension;
    const providerLabel = provider ? providerSelect.selectedOptions[0].textContent : "All providers";
    const records = eventRecords.map(([date, record]) => {
      if (historical) {
        const values = new Map();
        for (const {params, values: byDate} of archiveEntries) {
          if ((provider && params.get("issuer") !== provider) ||
              (dimension === "issuer" ? [...params.keys()].length !== 1 : !params.has(dimension))) continue;
          const label = params.get(dimension);
          if (!Object.hasOwn(byDate, date)) continue;
          values.set(label, (values.get(label) || 0) + byDate[date]);
        }
        return [date, {versions: Object.fromEntries(values)}];
      }
      const selected = provider ? record.issuers?.[provider] : record;
      if (provider && !selected) {
        const hasTotal = Object.hasOwn(record.breakdowns?.issuer || {}, provider);
        const total = hasTotal ? record.breakdowns.issuer[provider] : record.total === 0 ? 0 : null;
        // An absent or suppressed provider is not a published count of zero.
        if (total == null || (total > 0 && dimension !== "issuer")) return [date, null];
        return [date, {total, count: total === 0 ? 0 : null, explicitZero: total === 0,
          versions: dimension === "issuer" ? {[provider]: total} : {}}];
      }
      const values = dimension === "issuer" && provider
        ? {[provider]: selected.total}
        : selected?.breakdowns?.[dimension];
      if (!values) return [date, null];
      return [date, {...selected, versions: values}];
    });
    if (records.length) {
      const last = records.at(-1)[1];
      const meta = historical
        ? "Archived Glean authentication events. This daily snapshot is retained separately from the current weekly collection; no reporting-client denominator was stored."
        : `Glean · completed Monday–Sunday UTC submission windows. ${last?.count == null ? "" : `Latest week: ${number(last.count)} reporting clients.`} Each authentication window is counted once in the chosen breakdown. These are prompts, not background token refreshes or unique users. Missing window types remain explicit.`;
      const definitions = rankedDefinitions(records.filter(([, record]) => record)).map(definition => ({...definition,
        name: definition.id === "other" && dimension === "version"
          ? "Other (suppressed or unknown versions)"
          : definition.id === "other" && dimension === "channel"
            ? "Other / unknown channels" : definition.name,
      }));
      if (definitions.length) {
        card(`oauth-authentication-${historical ? "archive" : "current"}-${dimension}`, "OAuth authentication prompts",
          `${providerLabel} · ${historical ? "archived daily Glean snapshot" : "weekly Glean events"} · grouped by ${dimensionSelect.selectedOptions[0].textContent.toLowerCase()}`,
          basicSeries(records, definitions, historical ? 1 : 7, historical ? [] : weeks),
          {mode: "count", breakdown: true, link: telemetryChartURL({...selection(), chart: "authentication"}), totalLabel: historical ? "" : "Reporting clients", unit: "authentication prompts", meta: meta + (dimension === "version" && !historical ? " Versions with fewer than 100 reporting clients are combined with unknown versions by the public data source." : "")});
        host.append($("#secondary-content").lastElementChild);
      } else {
        const noPrompts = document.createElement("div");
        noPrompts.className = "empty-state secondary-card";
        const withheld = !historical && provider && eventRecords.some(([, record]) => record.total !== 0 && record.breakdowns?.issuer?.[provider] !== 0);
        noPrompts.innerHTML = withheld
          ? "<h3>No published breakdown available.</h3><p>Authentication prompts were recorded for this provider, but this breakdown is not available in the published data.</p>"
          : "<h3>No authentication prompts recorded.</h3><p>There are no published prompt observations for this provider in the available data.</p>";
        host.append(noPrompts);
      }
    }
    if (accountRecords.length) {
      const definitions = rankedDefinitions(accountRecords).filter(item => !provider || item.id === provider);
      if (definitions.length) {
        const last = accountRecords.at(-1)[1];
        const population = provider && last.label_clients?.[provider] != null
          ? `${number(last.label_clients[provider])} reporting clients for this provider`
          : `${number(last.count)} reporting clients across all providers`;
        card("oauth-accounts", "Accounts using OAuth", `${providerLabel} · incoming mail accounts`,
          basicSeries(accountRecords, definitions, 7, weeks),
          {mode: "count", breakdown: true, link: telemetryChartURL({...selection(), chart: "accounts"}), totalLabel: "Reporting clients", unit: "accounts", meta: `Glean · each client's latest account snapshot in the completed week. ${accounts.description || ""} Counts measure configured accounts, not authentication prompts or unique users. Latest week: ${population}.`});
        host.append($("#secondary-content").lastElementChild);
      }
    }
  }
  providerSelect.addEventListener("change", render);
  dimensionSelect.addEventListener("change", render);
  render();
}

function rankedDefinitions(records) {
  const weights = new Map();
  for (const [, r] of records)
    for (const [k, v] of Object.entries(r.versions || {}))
      weights.set(k, (weights.get(k) || 0) + v);
  const categories = [...weights]
    .sort((a, b) => (a[0] === "__other__") - (b[0] === "__other__") || b[1] - a[1])
    .map(([k]) => k);
  return categories.map((name) => {
    const value = r => Object.hasOwn(r.versions || {}, name) ? r.versions[name] : r.explicitZero ? 0 : null;
    return {
      id: name,
      name: name === "all" ? "All reported events" : name === "__other__" ? "Other (publication aggregate)" : name,
      value,
      total: r => r.count,
      note: r => value(r) == null ? "Not published separately for this observation." : undefined,
      percent: r => {
        const denominator = r.total || Object.values(r.versions || {}).reduce((sum, amount) => sum + amount, 0);
        return value(r) != null && denominator ? 100 * value(r) / denominator : null;
      },
    };
  });
}
function dimensionCard(id, title, dimension, historical = false, bounds = [], platforms = false) {
  const records = Object.entries(dimension.records || {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const buildDimensionSeries = controls => {
    const selected = historical ? records : selectChannelRecords(records, state.channels);
    const grouped = platforms ? groupPlatformRecords(selected, controls) : selected;
    const all = platforms ? groupPlatformRecords(records, controls) : records;
    // Keep the complete category set so filtering cannot remove an axis, date
    // range or hidden-series preference when a selected channel has no data.
    const definitions = rankedDefinitions([...all, ...grouped]).map(definition => ({
      ...definition,
      name: platforms ? formatPlatformLabel(definition.name) : definition.name,
      note: record => record.channelUnavailable
        ? "Channel breakdown unavailable for this observation. Select all channels to view the total."
        : definition.note(record),
    }));
    return basicSeries(grouped, definitions, 7, bounds);
  };
  card(
    id,
    title,
    historical
      ? "Legacy telemetry · through May 2025"
      : "Glean · unique reporting clients per completed week",
    platforms ? [] : buildDimensionSeries(),
    {
      mode: "percent", breakdown: true, unit: "reporting clients", totalLabel: "Reporting clients",
      seriesForControls: buildDimensionSeries,
      channelSensitive: !historical,
      ...(platforms ? {
        seriesControls: [
          {id: "darwin", label: "Combine macOS versions", checked: true},
          {id: "linux", label: "Combine Linux versions", checked: true},
        ],
      } : {}),
      meta:
        dimension.description ||
        (historical
          ? "Legacy telemetry weekly aggregates. This archive ends on May 31, 2025."
          : "Application locale and operating system are taken from the latest baseline ping per reporting client."),
    },
  );
}
function setNavigationSection(section, expanded) {
  const toggle = $(`[data-nav-toggle="${section}"]`);
  toggle.setAttribute("aria-expanded", String(expanded));
  document.getElementById(toggle.getAttribute("aria-controls")).hidden = !expanded;
}
function syncSiteNavigation(reveal = false) {
  const selectedMetric = telemetryLinkFromHash()?.metric || metricSelections.get("telemetry-view");
  $$("#site-nav a").forEach((a) => {
    const active = a.dataset.metric
      ? activeTab === "telemetry" && a.dataset.metric === selectedMetric
      : a.dataset.tab === activeTab;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
    if (active && a.dataset.metric) a.href = location.hash;
  });
  const section = ["explore", "daily"].includes(activeTab) ? "daily" : activeTab;
  $$("[data-nav-section]").forEach(group => {
    group.dataset.active = String(group.dataset.navSection === section);
    if (reveal) setNavigationSection(group.dataset.navSection, group.dataset.navSection === section);
  });
  $$("[data-metric-group]").forEach(group => {
    const active = activeTab === "telemetry" && group.dataset.metricGroup === telemetryGroup(selectedMetric || "");
    group.dataset.active = String(active);
    if (reveal) setNavigationSection(`telemetry-${group.dataset.metricGroup}`, active);
  });
  const current = $("#site-nav [aria-current=page]");
  $("#site-nav-current").textContent = current
    ? current.dataset.metric ? `Telemetry · ${current.textContent}` : current.dataset.navLabel || current.textContent
    : "Telemetry";
  const sidebar = $(".site-sidebar");
  if (current?.getClientRects().length && sidebar.scrollHeight > sidebar.clientHeight) {
    const linkBounds = current.getBoundingClientRect(), sidebarBounds = sidebar.getBoundingClientRect();
    if (linkBounds.top < sidebarBounds.top + 8) sidebar.scrollTop += linkBounds.top - sidebarBounds.top - 8;
    else if (linkBounds.bottom > sidebarBounds.bottom - 8) sidebar.scrollTop += linkBounds.bottom - sidebarBounds.bottom + 8;
  }
}
function updatePageTitle() {
  const labels = {explore:"Daily Versions & Channels",daily:"Daily Active",mau:"Monthly Active",telemetry:"Telemetry",addons:"Add-Ons",platforms:"Platforms & Languages",financials:"Funding",support:"Support"};
  const metric = activeTab === 'telemetry' ? $('#site-nav [data-metric][aria-current="page"]')?.textContent.trim() : '';
  document.title = `${labels[activeTab]}${metric ? `: ${metric}` : ''} — Thunderbird Data Report`;
}
async function route(event) {
  const navigationHadFocus = event?.type === 'hashchange' && $(".site-sidebar").contains(document.activeElement);
  readHash();
  const requestedTab = activeTab;
  syncSiteNavigation(true);
  $(".site-sidebar").dataset.open = "false";
  $("#site-nav-toggle").setAttribute("aria-expanded", "false");
  $("#explore-view").hidden = activeTab !== "explore";
  $("#secondary-view").hidden = activeTab === "explore";
  syncReportChannels();
  updatePageTitle();
  if (activeTab === "explore") await refreshExplorer();
  else await showSecondary(activeTab, activeTab === "telemetry" ? telemetryLinkFromHash() : null);
  if (navigationHadFocus && activeTab === requestedTab && $(".site-sidebar").contains(document.activeElement))
    $(activeTab === "explore" ? "#explore-title" : "#secondary-title").focus();
}
function initSiteNavigation() {
  const sidebar = $(".site-sidebar");
  const trigger = $("#site-nav-toggle");
  function close(restoreFocus = false) {
    sidebar.dataset.open = "false";
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }
  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") !== "true";
    sidebar.dataset.open = String(open);
    trigger.setAttribute("aria-expanded", String(open));
  });
  sidebar.addEventListener("keydown", event => {
    if (event.key === "Escape" && trigger.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      close(true);
    }
  });
  sidebar.addEventListener("click", event => {
    const toggle = event.target.closest("[data-nav-toggle]");
    if (toggle) {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      if (expanded && toggle.closest(".site-nav-metric-group")) {
        $$("#telemetry-nav-links [data-nav-toggle]").forEach(sibling => {
          if (sibling !== toggle) setNavigationSection(sibling.dataset.navToggle, false);
        });
      }
      setNavigationSection(toggle.dataset.navToggle, expanded);
      if (expanded && toggle.dataset.navToggle === "telemetry") loadTelemetryNavigation();
    }
    if (event.target.closest("a") && trigger.getAttribute("aria-expanded") === "true") close(true);
  });
  document.addEventListener("pointerdown", event => {
    if (!sidebar.contains(event.target)) close();
  });
}
function initThemeMenu() {
  const container = $(".theme-switch");
  const trigger = $("#theme");
  const menu = $("#theme-menu");
  const options = [...menu.querySelectorAll("[data-theme-choice]")];
  function applyTheme(value, persist = true) {
    const selected = options.find((option) => option.dataset.themeChoice === value) || options.at(-1);
    value = selected.dataset.themeChoice;
    if (persist) storage.set("tb-stats-theme", value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    const label = selected.getAttribute("aria-label");
    $("#theme-current-label").textContent = label;
    $("#theme-current-icon").replaceChildren(selected.querySelector("svg").cloneNode(true));
    trigger.setAttribute("aria-label", `Color theme: ${label}`);
    options.forEach((option) => option.setAttribute("aria-checked", String(option === selected)));
  }
  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }
  function openMenu(index = options.findIndex((option) => option.getAttribute("aria-checked") === "true")) {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    options[index].focus();
  }
  trigger.addEventListener("click", () => menu.hidden ? openMenu() : closeMenu());
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openMenu(event.key === "ArrowUp" ? options.length - 1 : 0);
    } else if (event.key === "Escape") closeMenu();
  });
  options.forEach((option) => option.addEventListener("click", () => {
    applyTheme(option.dataset.themeChoice);
    closeMenu(true);
  }));
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      options[next].focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const match = options.find((option) => option.getAttribute("aria-label").toLowerCase().startsWith(event.key.toLowerCase()));
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!container.contains(event.target)) closeMenu();
  });
  container.addEventListener("focusout", (event) => {
    if (!container.contains(event.relatedTarget)) closeMenu();
  });
  applyTheme(storage.get("tb-stats-theme"), false);
}
async function init() {
  trackFocusInput(document);
  $('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    $('#main').focus({preventScroll:true});
    $('#main').scrollIntoView({block:'start'});
  });
  $('#group-editor').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); toggleEditor(false); }
  });
  try {
    const saved = storage.get("tb-stats-view");
    if (saved) restore(JSON.parse(saved));
  } catch {}
  readHash();
  initSiteNavigation();
  initThemeMenu();
  $("#explorer-styles").innerHTML = chartStyleButtons(["percent", "count", "lines"], state.mode, "explorer", "data-mode");
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") $$(".chart-style-button:hover, .chart-style-button:focus-visible").forEach(button => button.classList.add("tooltip-dismissed"));
  });
  document.addEventListener("focusin", event => event.target.closest(".chart-style-button")?.classList.remove("tooltip-dismissed"));
  document.addEventListener("pointerover", event => {
    const button = event.target.closest(".chart-style-button");
    if (button && !button.contains(event.relatedTarget)) button.classList.remove("tooltip-dismissed");
  });
  try {
    manifest = await json("data/index.json");
  } catch {
    const raw = await json("thunderbird_adi.json");
    const dates = Object.keys(raw).sort();
    manifest = {
      adi: { start: dates[0], end: dates.at(-1), files: [] },
      archive_end: "2025-05-31",
      glean: null,
      releases: null,
    };
  }
  if (manifest.releases) {
    try {
      releases = await json(`data/${manifest.releases}`);
    } catch {
      notice(
        "Release-date metadata is unavailable. Latest-ESR groups cannot yet be resolved.",
      );
    }
  }
  const cutoffFamilies = [...new Set([128, ...normalizeReleases(releases).map(release => release.major)])].sort((a, b) => b - a);
  $("#version-cutoff").replaceChildren(...cutoffFamilies.map(major => new Option(`${major} and below`, major)), new Option("No version cutoff", ""));
  currentEsrMajor = resolveLatestEsr(manifest.adi.end, releases)?.major ?? null;
  currentReleaseMajor = resolveLatestRelease(manifest.adi.end, releases)?.major ?? null;
  for (const sel of ["#start-date", "#end-date"]) {
    $(sel).min = manifest.adi.start;
    $(sel).max = manifest.adi.end;
  }
  if (
    state.range !== "custom" ||
    !state.startDate ||
    !state.endDate ||
    state.endDate > manifest.adi.end ||
    state.startDate < manifest.adi.start
  )
    setRange(state.range === "custom" ? "6m" : state.range);
  else syncControls();
  if (sharedViewBaseline !== null) sharedViewBaseline = JSON.stringify(state);
  $("#updated-label").textContent =
    `Data through ${dateLabel(manifest.adi.end)}`;
  allTotals = await adiTotals();
  const averages = movingAverage(allTotals);
  dailySeries = [
    {id: "daily-observations", name: "Daily observations", color: "#6e9ed6", opacity: 0.6, strokeWidth: 1.2,
      values: normalizeOverview(allTotals).map((p) => ({date: p.date.toISOString().slice(0, 10), value: p.value, missing: !p.observed}))},
    {id: "moving-average-7", name: "7-day moving average", color: "#9680ed", strokeWidth: 2.8, values: averages},
  ];
  const latestAverage = averages.at(-1);
  if (latestAverage?.value != null) {
    $("#daily-kpi").textContent = compact(latestAverage.value);
    $("#daily-kpi").title = `${number(latestAverage.value)} estimated installations`;
    $("#daily-caption").textContent =
      `7-day average · through ${dateLabel(latestAverage.date)}`;
  } else {
    $("#daily-caption").textContent = "7-day average unavailable · incomplete observations";
  }
  try {
    const mau = await json("thunderbird_ami.json");
    const day = Object.keys(mau).sort().at(-1);
    $("#monthly-kpi").textContent = compact(
      Math.trunc(mau[day].ami / mau[day]["78"]),
    );
    $("#monthly-caption").textContent = `Monthly estimate · ${dateLabel(day)}`;
  } catch {
    $("#monthly-caption").textContent = "Monthly data is unavailable";
  }
  $$("#explore-view [data-range]").forEach((b) =>
    b.addEventListener("click", () => {
      setRange(b.dataset.range);
      refreshExplorer();
    }),
  );
  $$("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      refreshExplorer();
    }),
  );
  $("#grouping").addEventListener("change", (e) => {
    state.grouping = e.target.value;
    refreshExplorer();
  });
  $("#version-cutoff").addEventListener("change", (e) => {
    state.versionCutoff = e.target.value === "" ? null : Number(e.target.value);
    refreshExplorer();
  });
  $("#combine-release-versions").addEventListener("change", (e) => {
    state.combineReleaseVersions = e.target.checked;
    refreshExplorer();
  });
  $$(".channel-set input").forEach((i) =>
    i.addEventListener("change", () => {
      setReportChannels($$(".channel-set input:checked").map((input) => input.value));
    }),
  );
  $(".channel-set").addEventListener("click", event => {
    // Native checkbox activation can emit a second click without a dblclick
    // event. Synchronize selection before its ensuing input/change events.
    if (event.target.matches("input") && event.detail === 2)
      setReportChannels([event.target.value]);
  });
  $(".channel-set").addEventListener("dblclick", event => {
    const input = event.target.closest("label")?.querySelector("input");
    if (!input) return;
    event.preventDefault();
    setReportChannels([input.value]);
  });
  $("#all-report-channels").addEventListener("click", () => setReportChannels([...CHANNELS]));
  $("#no-report-channels").addEventListener("click", () => setReportChannels([]));
  for (const sel of ["#start-date", "#end-date"])
    $(sel).addEventListener("change", () => {
      if (!isDay($("#start-date").value) || !isDay($("#end-date").value))
        return;
      state.startDate = $("#start-date").value;
      state.endDate = $("#end-date").value;
      state.range = "custom";
      refreshExplorer();
    });
  $("#explorer-legend").addEventListener("click", (e) => {
    const selected = e.target.closest("[data-version]");
    if (selected) {
      const v = selected.dataset.version;
      const esrVersion = selected.dataset.esrVersion === "true";
      const added = {
        id: `exact:${v}${esrVersion ? ":esr" : ""}`,
        name: `${v}${esrVersion ? " ESR" : ""}`,
        versions: [`=${v}`],
        esrVersion,
        color: colorForSeries(`version:${v}${esrVersion ? ":esr" : ""}`, {currentEsrMajor, currentReleaseMajor}),
      };
      if (
        state.grouping === "custom" &&
        state.groups.length >= 40 &&
        !state.groups.some((g) => g.id === added.id)
      ) {
        toast("A view can contain up to 40 custom groups.");
        return;
      }
      state.groups =
        state.grouping === "custom"
          ? [
              added,
              ...state.groups.filter((g) => !g.remainder && g.id !== added.id),
              {
                id: "remainder",
                name: "Everything else",
                remainder: true,
                color: "#8493a7",
              },
            ]
          : [
              added,
              {
                id: "remainder",
                name: "Everything else",
                remainder: true,
                color: "#8493a7",
              },
            ];
      state.grouping = "custom";
      state.hiddenSeries = [];
      $("#legend-search").value = "";
      if (!$("#group-editor").hidden) groupEditor();
      refreshExplorer();
      return;
    }
    const button = e.target.closest("[data-series]");
    if (!button) return;
    const id = button.dataset.series;
    const group = state.groups.find((g) => g.id === id);
    if (group?.visible === false) {
      group.visible = true;
      state.hiddenSeries = state.hiddenSeries.filter((k) => k !== id);
    } else
      state.hiddenSeries = state.hiddenSeries.includes(id)
        ? state.hiddenSeries.filter((k) => k !== id)
        : [...state.hiddenSeries, id];
    refreshLegendSelection();
  });
  $("#legend-search").addEventListener("input", renderLegend);
  $("#legend-search").addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      $("#legend-search").value = "";
      renderLegend();
    }
  });
  $("#clear-legend-search").addEventListener("click", () => {
    $("#legend-search").value = "";
    renderLegend();
    $("#legend-search").focus();
  });
  $("#legend-show-small-versions").addEventListener("change", event => {
    state.showSmallVersions = event.target.checked;
    save();
    renderLegend();
  });
  $("#group-small-series").addEventListener("change", event => {
    state.groupSmallSeries = event.target.checked;
    refreshExplorer();
  });
  $("#focus-matching").addEventListener("click", () => {
    const query = $("#legend-search").value.trim().toLowerCase();
    if (!query || !currentResult?.series.some(series => series.name.toLowerCase().includes(query))) return;
    state.hiddenSeries = currentResult.series.filter((s) => !s.name.toLowerCase().includes(query)).map((s) => s.id);
    state.groups.forEach((g) => (g.visible = true));
    refreshLegendSelection();
  });
  $("#hide-series").addEventListener("click", () => {
    if (!currentResult) return;
    state.hiddenSeries = currentResult.series.map((s) => s.id);
    refreshLegendSelection();
  });
  $("#reset-hidden").addEventListener("click", () => {
    Object.assign(state, defaultLegendState());
    $("#legend-search").value = "";
    legendDate = defaultLegendDate;
    $("#explorer-legend").scrollTop = 0;
    $("#group-preset").value = "latest-esr";
    toggleEditor(false);
    groupEditor();
    refreshExplorer();
  });
  $(".data-table-details").addEventListener("toggle", () => {
    if ($(".data-table-details").open) renderTable();
  });
  $("#explorer-include-hidden").addEventListener("change", renderTable);
  $("#use-channel-dates").addEventListener("click", () => {
    state.startDate = manifest.adi.channel_start; state.endDate = manifest.adi.channel_end; state.range = "custom"; refreshExplorer();
  });
  $("#include-all-channels").addEventListener("click", () => {
    setReportChannels([...CHANNELS]);
  });
  $("#export-csv").addEventListener("click", exportCSV);
  $("#export-svg").addEventListener("click", () => {
    if (chart)
      download(
        "thunderbird-adoption.svg",
        chart.exportSVG(),
        "image/svg+xml;charset=utf-8",
      );
  });
  $("#share").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.hash = `explore?${new URLSearchParams({ state: JSON.stringify(state) })}`;
    sharedViewBaseline = JSON.stringify(state);
    await copyViewLink(url, "Link copied. Your groups and date range are included.");
  });
  $("#edit-groups").addEventListener("click", () =>
    toggleEditor($("#group-editor").hidden),
  );
  $("#close-groups").addEventListener("click", () => toggleEditor(false));
  $("#apply-preset").addEventListener("click", () => {
    state.groups = createPresetGroups($("#group-preset").value, releases, {currentEsrMajor, currentReleaseMajor});
    state.hiddenSeries = [];
    state.grouping = "custom";
    groupEditor();
    refreshExplorer();
  });
  $("#add-group").addEventListener("click", () => {
    if (state.groups.length >= 40) {
      toast("A view can contain up to 40 custom groups.");
      return;
    }
    state.groups.push({
      id: `group-${Date.now()}`,
      name: "New group",
      color: colorForSeries(String(Date.now())),
    });
    state.grouping = "custom";
    groupEditor();
    $('#group-rows [data-group]:last-child [data-field="name"]').focus();
    announceStatus('New group added. Enter a group name and its rules.');
    refreshExplorer();
  });
  $("#group-rows").addEventListener("change", (e) => {
    const i = Number(e.target.closest("[data-group]")?.dataset.group);
    const field = e.target.dataset.field;
    if (!field || !state.groups[i]) return;
    const g = state.groups[i];
    let value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (
      ["versions", "excludeVersions", "channels", "excludeChannels"].includes(
        field,
      )
    )
      value = String(value)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    if (["channels", "excludeChannels"].includes(field))
      value = value.filter((v) => CHANNELS.includes(v));
    if (field === "pinnedMajor") value = Number(value);
    // A delayed blur can emit change again after another control was used.
    // Reapplying an identical field must not switch grouping or move controls.
    if (JSON.stringify(value) === JSON.stringify(g[field])) return;
    g[field] = value;
    if (field === "latestEsr" && value === "pinned" && !g.pinnedMajor)
      g.pinnedMajor = Number(
        (Array.isArray(releases) ? releases : releases.releases || [])
          .at(-1)
          ?.version.split(".")[0] || 140,
      );
    if (field === "minVersion") delete g.minMajor;
    if (field === "maxVersion") delete g.maxMajor;
    state.grouping = "custom";
    if (field === "latestEsr") groupEditor();
    refreshExplorer();
  });
  $("#group-rows").addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const i = Number(e.target.closest("[data-group]").dataset.group);
    if (action === "remove") state.groups.splice(i, 1);
    else {
      const j = i + (action === "up" ? -1 : 1);
      if (j >= 0 && j < state.groups.length)
        [state.groups[i], state.groups[j]] = [state.groups[j], state.groups[i]];
    }
    state.grouping = "custom";
    groupEditor();
    const nextIndex = action === 'remove' ? Math.min(i, state.groups.length - 1) : i + (action === 'up' ? -1 : 1);
    const row = $(`#group-rows [data-group="${nextIndex}"]`);
    (row?.querySelector(`[data-action="${action}"]:not(:disabled)`) || row?.querySelector('[data-field="name"]') || $('#add-group')).focus();
    announceStatus(action === 'remove' ? 'Group removed.' : `Group moved ${action}.`);
    refreshExplorer();
  });
  $("#export-groups").addEventListener("click", () =>
    download(
      "thunderbird-groups.json",
      JSON.stringify({ schema: 1, groups: state.groups }, null, 2),
      "application/json",
    ),
  );
  $("#import-groups").addEventListener("change", async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 100000)
        throw new Error("Group configuration must be smaller than 100 KB.");
      const data = JSON.parse(await file.text());
      state.groups = cleanGroups(data.groups || data);
      state.grouping = "custom";
      state.hiddenSeries = [];
      groupEditor();
      refreshExplorer();
      toast("Groups imported.");
    } catch (error) {
      toast(error.message);
    }
    e.target.value = "";
  });
  $("#archive").addEventListener("change", () => showSecondary(activeTab));
  window.addEventListener("hashchange", route);
  route();
  if ($("#telemetry-nav-toggle").getAttribute("aria-expanded") === "true") loadTelemetryNavigation();
}
init().catch((e) => {
  notice(e.message);
  chart?.destroy();
  $("#explorer-chart").innerHTML =
    '<div class="loading-state">Statistics could not be loaded. Reload to try again.</div>';
});
