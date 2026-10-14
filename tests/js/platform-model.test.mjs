import test from "node:test";
import assert from "node:assert/strict";
import {formatPlatformLabel, groupPlatformRecords} from "../../docs/media/js/platform-model.mjs";

test("platform grouping sums macOS and Linux versions without changing populations or Windows detail", () => {
  const records = [["2026-09-27", {count: 100, total: 100, explicitZero: true, versions: {
    "Windows 10": 30, "Windows 11": 45, Darwin: 1, "Darwin 24.6.0": 8,
    "Darwin Unknown": 1, "Linux 6.8": 10, "Linux 6.12": 4, "Linux Unknown": 1,
  }}]];
  const original = structuredClone(records);
  assert.deepEqual(groupPlatformRecords(records), [["2026-09-27", {
    count: 100, total: 100, explicitZero: true,
    versions: {"Windows 10": 30, "Windows 11": 45, Darwin: 10, Linux: 15},
  }]]);
  assert.deepEqual(groupPlatformRecords(records, {darwin: false})[0][1].versions, {
    "Windows 10": 30, "Windows 11": 45, Darwin: 1, "Darwin 24.6.0": 8,
    "Darwin Unknown": 1, Linux: 15,
  });
  assert.deepEqual(groupPlatformRecords(records, {linux: false})[0][1].versions, {
    "Windows 10": 30, "Windows 11": 45, Darwin: 10,
    "Linux 6.8": 10, "Linux 6.12": 4, "Linux Unknown": 1,
  });
  assert.deepEqual(groupPlatformRecords(records, {darwin: false, linux: false}), records);
  assert.deepEqual(records, original);
});

test("platform grouping preserves absent, zero and unpublished values", () => {
  const grouped = groupPlatformRecords([
    ["2026-09-06", {count: 10, versions: {"Darwin 24.6.0": 0, "Windows 10": 10}}],
    ["2026-09-13", {count: 10, versions: {"Windows 10": 10}}],
    ["2026-09-20", {count: 10, versions: {"Linux 6.8": 2, "Linux Unknown": null}}],
    ["2026-09-27", {count: 10, versions: {"Linux Unknown": null, "Linux 6.8": 2}}],
  ]);
  assert.equal(grouped[0][1].versions.Darwin, 0);
  assert.equal(Object.hasOwn(grouped[1][1].versions, "Darwin"), false);
  assert.equal(grouped[2][1].versions.Linux, null);
  assert.equal(grouped[3][1].versions.Linux, null);
});

test("historical Windows identifiers use product names without inventing a Windows 10/11 split", () => {
  for (const [source, label] of Object.entries({
    "Windows_954.0": "Windows 95", "Windows_984.10": "Windows 98",
    "Windows_NT4.0": "Windows NT 4.0", "Windows_NT5.0": "Windows 2000",
    "Windows_NT5.1": "Windows XP", "Windows_NT5.2": "Windows XP x64 / Server 2003",
    "Windows_NT6.0": "Windows Vista", "Windows_NT6.1": "Windows 7",
    "Windows_NT6.2": "Windows 8", "Windows_NT6.3": "Windows 8.1",
    "Windows_NT10.0": "Windows 10 / 11", Windows_NT: "Windows (version unknown)",
  })) assert.equal(formatPlatformLabel(source), label);
  for (const label of ["Windows 10", "Windows 11", "Other (publication aggregate)", "Unrecognized OS"])
    assert.equal(formatPlatformLabel(label), label);
  assert.equal(formatPlatformLabel("Windows_NT6.4"), "Windows NT 6.4");
});

test("macOS and Linux retain the reported kernel version and label unknown versions accurately", () => {
  assert.equal(formatPlatformLabel("Darwin"), "macOS");
  assert.equal(formatPlatformLabel("Darwin 19.6.0"), "macOS 10.15 (Darwin 19.6.0)");
  assert.equal(formatPlatformLabel("Darwin 20.6.0"), "macOS 11 (Darwin 20.6.0)");
  assert.equal(formatPlatformLabel("Darwin 24.6.0"), "macOS 15 (Darwin 24.6.0)");
  assert.equal(formatPlatformLabel("Darwin 25.6.0"), "macOS 26 (Darwin 25.6.0)");
  assert.equal(formatPlatformLabel("Darwin 27.0.0"), "macOS (Darwin 27.0.0)");
  assert.equal(formatPlatformLabel("Darwin Unknown"), "macOS (version unknown)");
  assert.equal(formatPlatformLabel("Linux 6.8"), "Linux (kernel 6.8)");
  assert.equal(formatPlatformLabel("Linux Unknown"), "Linux (kernel unknown)");
  assert.equal(formatPlatformLabel("OpenBSD 7.7"), "OpenBSD 7.7");
});
