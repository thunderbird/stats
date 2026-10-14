import {test, expect} from "@playwright/test";
import {selectReport} from "./navigation.mjs";

test("macOS and Linux group by default and ungroup independently without resetting the chart", async ({page}) => {
  await page.route("**/data/glean.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const record of Object.values(data.platforms.records)) record.versions = {
      "Windows_NT6.1": 20, "Windows 10": 30, "Windows 11": 25,
      "Darwin 24.6.0": 7, "Darwin 25.0.0": 2, "Darwin Unknown": 1,
      "Linux 6.8": 10, "Linux 6.12": 4, "Linux Unknown": 1,
    };
    await route.fulfill({json: data});
  });
  await page.goto("/#platforms");
  const card = page.locator("article:has(#glean-platforms)");
  const macos = card.getByRole("checkbox", {name: "Combine macOS versions"});
  const linux = card.getByRole("checkbox", {name: "Combine Linux versions"});
  await expect(macos).toBeChecked();
  await expect(linux).toBeChecked();
  await expect(page.locator("article:has(#glean-locales) [data-series-control]")).toHaveCount(0);
  await expect(card.locator(".legend-item")).toHaveText(["Windows 10", "Windows 11", "Windows 7", "Linux", "macOS"]);
  await card.locator("summary").click();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["30", "25", "20", "15", "10"]);
  await card.getByRole("checkbox", {name: "Include shares (%)", exact: true}).check();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["30", "30", "25", "25", "20", "20", "15", "15", "10", "10"]);
  await card.getByRole("button", {name: "Stacked counts", exact: true}).click();
  await card.locator("#glean-platforms-start-date").fill("2026-09-20");
  await card.locator("#glean-platforms-start-date").dispatchEvent("change");
  await card.getByRole("button", {name: "Toggle Windows 7", exact: true}).click();

  await linux.uncheck();
  await expect(macos).toBeChecked();
  await expect(card.getByRole("button", {name: "Toggle macOS", exact: true})).toBeVisible();
  await expect(card.getByRole("button", {name: "Toggle Linux (kernel 6.8)", exact: true})).toBeVisible();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["30", "30", "25", "25", "10", "10", "10", "10", "4", "4", "1", "1"]);
  await expect(card.locator("[data-chart-mode=count]")).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator("#glean-platforms-start-date")).toHaveValue("2026-09-20");
  await expect(card.getByRole("button", {name: "Toggle Windows 7", exact: true})).toHaveAttribute("aria-pressed", "false");
  await card.locator("[data-chart-view]").selectOption("snapshot");
  await card.locator("[data-snapshot-scale]").selectOption("log");
  await macos.uncheck();
  await expect(card.getByRole("button", {name: "Toggle macOS 15 (Darwin 24.6.0)", exact: true})).toBeVisible();
  await expect(card.locator("[data-chart-view]")).toHaveValue("snapshot");
  await expect(card.locator("[data-snapshot-scale]")).toHaveValue("log");
  await expect(card.locator("tbody tr")).toHaveCount(1);
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["30", "30", "25", "25", "10", "10", "7", "7", "4", "4", "2", "2", "1", "1", "1", "1"]);

  await linux.check();
  await macos.check();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["30", "30", "25", "25", "15", "15", "10", "10"]);
  const downloadEvent = page.waitForEvent("download");
  await card.locator("[data-export]").click();
  const stream = await (await downloadEvent).createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain('"Linux (reporting clients)","Linux share (%)","macOS (reporting clients)","macOS share (%)"');
  expect(csv).toContain('"2026-09-27","30","30","25","25","15","15","10","10"');
  expect(csv).not.toContain("Darwin");
  expect(csv).not.toContain("kernel");

  await macos.uncheck();
  await selectReport(page, "daily");
  await selectReport(page, "platforms");
  await expect(macos).not.toBeChecked();
  await expect(linux).toBeChecked();
  await expect(card.locator("[data-chart-view]")).toHaveValue("snapshot");
  await expect(card.getByRole("button", {name: "Toggle Windows 7", exact: true})).toHaveAttribute("aria-pressed", "false");
});

test("current OS versions retain distinct counts and readable labels in charts, tables and exports", async ({page}) => {
  await page.route("**/data/glean.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const record of Object.values(data.platforms.records)) record.versions = {
      "Windows_NT6.1": 20, "Windows 10": 30, "Windows 11": 25,
      "Darwin 24.6.0": 10, "Linux 6.8": 15,
    };
    await route.fulfill({json: data});
  });
  await page.goto("/#platforms");
  const card = page.locator("article:has(#glean-platforms)");
  await card.getByRole("checkbox", {name: "Combine macOS versions"}).uncheck();
  await card.getByRole("checkbox", {name: "Combine Linux versions"}).uncheck();
  await expect(page.locator("#secondary-content article h3")).toHaveText(["Application languages", "Operating systems"]);
  for (const label of ["Windows 7", "Windows 10", "Windows 11", "macOS 15 (Darwin 24.6.0)", "Linux (kernel 6.8)"])
    await expect(card.getByRole("button", {name: `Toggle ${label}`, exact: true})).toBeVisible();
  await card.locator("svg.stats-chart").focus();
  await page.keyboard.press("End");
  await expect(card.locator(".chart-tooltip")).toContainText("Windows 7");
  await expect(card.locator(".chart-tooltip")).toContainText("Windows 11");
  await expect(card.locator(".chart-tooltip")).not.toContainText("Windows_NT");
  await card.locator("summary").click();
  await expect(card.locator("thead th")).toHaveText([
    "Date", "Windows 10 (reporting clients)", "Windows 11 (reporting clients)",
    "Windows 7 (reporting clients)", "Linux (kernel 6.8) (reporting clients)",
    "macOS 15 (Darwin 24.6.0) (reporting clients)",
  ]);
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["30", "25", "20", "15", "10"]);
  const downloadEvent = page.waitForEvent("download");
  await card.locator("[data-export]").click();
  const stream = await (await downloadEvent).createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain('"Windows 7 (reporting clients)"');
  expect(csv).toContain('"2026-09-27","30","25","20","15","10"');
  expect(csv).not.toContain("Windows_NT");
});

test("historical platforms label NT versions and preserve the unsplit Windows 10/11 population", async ({page}) => {
  await page.route("**/platforms.json", route => route.fulfill({json: {
    "2025-05-25": {count: 100, versions: {"Windows_NT6.1": 20, "Windows_NT10.0": 50, Darwin: 20, Linux: 10}},
    "2025-06-01": {count: 100, versions: {"must-not-display": 100}},
  }}));
  await page.goto("/#platforms");
  await page.locator("#archive").selectOption("legacy");
  const card = page.locator("article:has(#platforms)");
  await expect(page.locator("#secondary-content article h3")).toHaveText(["Application languages", "Operating systems"]);
  await expect(card.getByRole("button", {name: "Toggle Windows 7", exact: true})).toBeVisible();
  await expect(card.getByRole("button", {name: "Toggle Windows 10 / 11", exact: true})).toBeVisible();
  await expect(card.locator(".secondary-meta")).toContainText("cannot separate Windows 10 from Windows 11");
  await expect(card).not.toContainText("must-not-display");
  await card.locator("summary").click();
  await expect(card.locator("thead")).toContainText("macOS (reporting clients)");
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["50", "20", "20", "10"]);
});
