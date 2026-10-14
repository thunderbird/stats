import {selectMetric} from "./navigation.mjs";
import {test, expect} from "@playwright/test";

test.beforeEach(async ({context}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route("**/data/glean.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const [key, label] of [["compose_mails_sent", "All messages sent"], ["mail_mails_read_secure", "Secure messages read"]]) {
      data.metrics[key] = {label, unit: "events", records: data.metrics.accounts.records};
    }
    await route.fulfill({json: data});
  });
});

test("every telemetry metric can be copied and opened directly in a fresh page", async ({page, context}) => {
  const fresh = await context.newPage();
  await page.goto("/#telemetry");
  for (const metric of ["accounts", "compose_mails_sent", "mail_mails_read_secure"]) {
    await selectMetric(page, metric);
    const card = page.locator("article:has(#feature-usage)");
    await expect(card.locator("svg.stats-chart")).toBeVisible();
    expect(new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("metric")).toBe(metric);
    await card.getByRole("button", {name: "Copy link", exact: true}).click();
    await expect(page.locator("#toast")).toHaveText("Chart link copied.");
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(page.url());
    await fresh.goto(link);
    await expect(fresh.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", metric);
    await expect(fresh.locator("#archive")).toHaveValue("current");
    const target = fresh.locator("article:has(#feature-usage)");
    await expect(target).toBeFocused();
    const bounds = await target.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeLessThan(40);
  }
  await fresh.setViewportSize({width: 320, height: 812});
  await expect(fresh.getByRole("button", {name: "Copy link", exact: true})).toBeVisible();
  expect(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await fresh.close();
});

test("historical links restore their source through reloads and same-tab history", async ({page}) => {
  await page.goto("/#telemetry?metric=legacy.metric&source=legacy");
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "legacy.metric");
  await expect(page.locator("#archive")).toHaveValue("legacy");
  await expect(page.locator("#feature-usage svg")).toBeVisible();
  await expect(page.locator("#secondary-content")).not.toContainText("must-not-display");
  await page.getByRole("button", {name: "Copy link", exact: true}).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#telemetry\?metric=legacy.metric&source=legacy$/);
  await page.reload();
  await expect(page.locator("#archive")).toHaveValue("legacy");
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "legacy.metric");
  await page.evaluate(() => {location.hash = "telemetry?metric=mail_mails_read_secure";});
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "mail_mails_read_secure");
  await expect(page.locator("#archive")).toHaveValue("current");
  await page.goBack();
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "legacy.metric");
  await expect(page.locator("#archive")).toHaveValue("legacy");
  await page.goForward();
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "mail_mails_read_secure");
  await expect(page.locator("#archive")).toHaveValue("current");
  await page.locator("#archive").selectOption("legacy");
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "legacy.metric");
  await expect(page).toHaveURL(link);
});

test("OAuth links restore filters and open the accounts or prompts chart, including the archive", async ({page, context}) => {
  const fresh = await context.newPage();
  await page.goto("/#telemetry?metric=oauth-providers");
  await page.locator("#oauth-provider").selectOption("accounts.google.com");
  await page.locator("#oauth-grouping").selectOption("result");
  for (const [chart, id] of [["authentication", "oauth-authentication-current-result"], ["accounts", "oauth-accounts"]]) {
    await page.locator(`article:has(#${id})`).getByRole("button", {name: "Copy link", exact: true}).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const params = new URLSearchParams(new URL(link).hash.split("?")[1]);
    expect(params.get("metric")).toBe("oauth-providers");
    expect(params.get("provider")).toBe("accounts.google.com");
    expect(params.get("group")).toBe("result");
    expect(params.get("chart")).toBe(chart);
    await fresh.goto(link);
    await expect(fresh.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "oauth-providers");
    await expect(fresh.locator("#oauth-provider")).toHaveValue("accounts.google.com");
    await expect(fresh.locator("#oauth-grouping")).toHaveValue("result");
    await expect(fresh.locator(`article:has(#${id})`)).toBeFocused();
    await expect(fresh.locator("#oauth-accounts").locator("..").locator(".secondary-legend")).not.toContainText("login.microsoftonline.com");
  }
  await page.locator("#archive").selectOption("legacy");
  const archive = page.locator("article:has(#oauth-authentication-archive-result)");
  await archive.getByRole("button", {name: "Copy link", exact: true}).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URLSearchParams(new URL(link).hash.split("?")[1]).get("source")).toBe("legacy");
  await fresh.goto(link);
  await expect(fresh.locator("#archive")).toHaveValue("legacy");
  await expect(fresh.locator("#oauth-provider")).toHaveValue("accounts.google.com");
  await expect(fresh.locator("#oauth-grouping")).toHaveValue("result");
  await expect(fresh.locator("article:has(#oauth-authentication-archive-result)")).toBeFocused();
  await expect(fresh.locator("#oauth-accounts")).toHaveCount(0);
  await fresh.close();
});

test("unavailable metrics and invalid OAuth filters fall back to usable charts", async ({page}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#telemetry?metric=removed.metric&source=legacy");
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "legacy.metric");
  await expect(page.locator("#toast")).toContainText("unavailable in this data source");
  await expect(page.locator("#feature-usage svg")).toBeVisible();
  await page.goto("/#telemetry?metric=oauth-providers&provider=unknown&group=invalid&chart=accounts");
  await expect(page.locator("#oauth-provider")).toHaveValue("");
  await expect(page.locator("#oauth-grouping")).toHaveValue("issuer");
  await expect(page.locator("article:has(#oauth-accounts)")).toBeFocused();
  await expect(page).toHaveURL(/#telemetry\?metric=oauth-providers&chart=accounts$/);
  expect(errors).toEqual([]);
});

test("copying a chart link keeps a shareable address when clipboard access fails", async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {value: async () => {throw new Error("Clipboard unavailable");}});
  });
  await page.goto("/#telemetry?metric=oauth-providers");
  await page.locator("article:has(#oauth-accounts)").getByRole("button", {name: "Copy link", exact: true}).click();
  await expect(page.locator("#toast")).toHaveText("This view is saved in the address bar. Copy its URL to share.");
  await expect(page).toHaveURL(/#telemetry\?metric=oauth-providers&chart=accounts$/);
  await page.reload();
  await expect(page.locator("article:has(#oauth-accounts)")).toBeFocused();
});

test("telemetry links support keyboard navigation, history, and per-chart date ranges", async ({page}) => {
  await page.goto('/#telemetry?metric=accounts');
  const directory = page.locator('#telemetry-nav-links');
  const accounts = directory.locator('[data-metric="accounts"]');
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', {name: 'Telemetry: Mail accounts', exact: true})).toBeVisible();
  await accounts.focus();
  await accounts.press('Shift+Tab');
  const oauth = directory.getByRole('link', {name: 'OAuth Providers', exact: true});
  await expect(oauth).toBeFocused();
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await oauth.press('Enter');
  await expect(oauth).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#oauth-accounts svg')).toBeVisible();
  await expect(page.locator('article:has(#oauth-authentication-current-issuer)')).toBeFocused();
  await page.goBack();
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await accounts.focus();
  await accounts.press('Tab');
  const mail = directory.getByRole('button', {name: 'Mail & Security', exact: true});
  await expect(mail).toBeFocused();
  await mail.press('Enter');
  await expect(mail).toHaveAttribute('aria-expanded', 'true');
  await expect(accounts).toBeHidden();
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await mail.press('Tab');
  const sent = directory.locator('[data-metric="compose_mails_sent"]');
  await expect(sent).toBeFocused();
  await sent.press('Tab');
  const secure = directory.locator('[data-metric="mail_mails_read_secure"]');
  await expect(secure).toBeFocused();
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await secure.press('Enter');
  await expect(secure).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/metric=mail_mails_read_secure$/);
  await expect(page.getByRole('region', {name: 'Telemetry: Secure messages read', exact: true})).toBeVisible();
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await page.locator('#feature-usage-start-date').fill('2026-09-20');
  await page.locator('#feature-usage-start-date').press('Tab');
  await secure.click();
  await expect(page.locator('#feature-usage-start-date')).toHaveValue('2026-09-20');
  await selectMetric(page, 'accounts');
  await expect(accounts).toHaveAttribute('aria-current', 'page');
  await selectMetric(page, 'mail_mails_read_secure');
  await expect(secure).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#feature-usage-start-date')).toHaveValue('2026-09-20');
});

test('telemetry groups expose every metric in its category and preserve unknown metrics', async ({page}) => {
  await page.route('**/data/glean.json', async route => {
    const data = await (await route.fetch()).json();
    for (const [key, label] of [
      ['compose_mails_sent', 'All messages sent'], ['mail_mails_read_secure', 'Secure messages read'],
      ['mail_account_count', 'Accounts'], ['mail_successful_email_account_setup', 'Successful account setup'],
      ['mail_failed_email_account_setup', 'Failed account setup'], ['mail_mails_read', 'All messages read'],
      ['mail_secure_mail_loaded', 'Secure messages loaded'], ['calendar_calendar_count', 'Calendars'],
      ['calendar_read_only_calendar_count', 'Read-only calendars'], ['addrbook_addressbook_count', 'Address books'],
      ['filelink_uploaded_size', 'Filelink uploads'], ['mail_websearch_usage', 'Web searches'],
      ['new_probe', 'New metric'],
    ]) data.metrics[key] = {label, unit: 'events', records: data.metrics.accounts.records};
    delete data.metrics.accounts;
    await route.fulfill({json: data});
  });
  await page.goto('/#telemetry?metric=calendar_calendar_count');
  const directory = page.locator('#telemetry-nav-links');
  await expect(directory.getByRole('button')).toHaveText(['Accounts & Authentication', 'Mail & Security', 'Calendars & Contacts', 'Other Features']);
  await expect(directory.locator('[aria-expanded="true"]')).toHaveText('Calendars & Contacts');
  await expect(directory.locator('[aria-current="page"]')).toHaveText('Calendars');
  await expect(directory.getByRole('group', {name: 'Calendars & Contacts'}).getByRole('link')).toHaveText(['Calendars', 'Read-only calendars', 'Address books']);
  await expect(directory.locator('#telemetry-mail-links')).toBeHidden();
  await expect(directory.locator('#telemetry-other-links')).toBeHidden();
  await directory.getByRole('link', {name: 'Read-only calendars', exact: true}).click();
  await expect(directory.locator('[aria-current="page"]')).toHaveText('Read-only calendars');
  const chartURL = page.url();
  await page.locator('#feature-usage svg').evaluate(node => { node.dataset.browseCheck = 'original'; });
  await directory.getByRole('button', {name: 'Mail & Security', exact: true}).click();
  await expect(directory.locator('[aria-expanded="true"]')).toHaveText('Mail & Security');
  await expect(directory.getByRole('group', {name: 'Mail & Security'}).getByRole('link')).toHaveText(['All messages sent', 'Secure messages read', 'All messages read', 'Secure messages loaded']);
  expect(page.url()).toBe(chartURL);
  await expect(page.locator('#feature-usage svg')).toHaveAttribute('data-browse-check', 'original');
  await directory.getByRole('button', {name: 'Other Features', exact: true}).click();
  await expect(directory.getByRole('group', {name: 'Other Features'}).getByRole('link')).toHaveText(['Filelink uploads', 'Web searches', 'New metric']);
  await directory.getByRole('link', {name: 'New metric', exact: true}).click();
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await expect(page).toHaveURL(/metric=new_probe$/);
  await page.setViewportSize({width: 1280, height: 600});
  await page.reload();
  await expect(directory.locator('[aria-current="page"]')).toHaveText('New metric');
  await expect(page.locator('#telemetry-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(directory.locator('[aria-expanded="true"]')).toHaveText('Other Features');
  const activeBounds = await directory.locator('[aria-current="page"]').boundingBox();
  const sidebarBounds = await page.locator('.site-sidebar').boundingBox();
  expect(activeBounds.y).toBeGreaterThanOrEqual(sidebarBounds.y);
  expect(activeBounds.y + activeBounds.height).toBeLessThanOrEqual(sidebarBounds.y + sidebarBounds.height);
});
