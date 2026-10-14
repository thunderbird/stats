// Legacy Telemetry uses Windows NT identifiers. Glean also provides OS and
// kernel versions; Windows 10/11 are separated by build in the baseline query.
const windowsVersions = {
  "4.0": "Windows NT 4.0",
  "5.0": "Windows 2000",
  "5.1": "Windows XP",
  "5.2": "Windows XP x64 / Server 2003",
  "6.0": "Windows Vista",
  "6.1": "Windows 7",
  "6.2": "Windows 8",
  "6.3": "Windows 8.1",
  "10.0": "Windows 10 / 11",
};

export function groupPlatformRecords(records, {darwin = true, linux = true} = {}) {
  return records.map(([date, record]) => {
    const versions = {};
    for (const [name, value] of Object.entries(record.versions || {})) {
      const group = darwin && /^Darwin(?: |$)/.test(name) ? "Darwin"
        : linux && /^Linux(?: |$)/.test(name) ? "Linux" : name;
      // An unpublished value cannot be reconstructed from the other versions.
      versions[group] = value == null || versions[group] === null
        ? null : (versions[group] || 0) + value;
    }
    return [date, {...record, versions}];
  });
}

export function formatPlatformLabel(value) {
  if (value === "Windows_954.0") return "Windows 95";
  if (value === "Windows_984.10") return "Windows 98";
  if (value === "Windows_NT") return "Windows (version unknown)";
  const windows = value.match(/^Windows_NT(\d+\.\d+)$/);
  if (windows) return windowsVersions[windows[1]] || `Windows NT ${windows[1]}`;
  if (value === "Darwin") return "macOS";
  if (value === "Darwin Unknown") return "macOS (version unknown)";
  const darwin = value.match(/^Darwin (\d+)(?:\.\d+)*$/);
  if (darwin) {
    const major = Number(darwin[1]);
    // Kernel releases identify the macOS family, not an exact macOS patch.
    // Preserve the reported kernel; leave unfamiliar families unmapped.
    const macos = major >= 4 && major <= 19 ? `10.${major - 4}`
      : major >= 20 && major <= 24 ? String(major - 9)
      : major === 25 ? "26" : "";
    return `macOS${macos ? ` ${macos}` : ""} (${value})`;
  }
  const linux = value.match(/^Linux (\d+(?:\.\d+)*)$/);
  if (linux) return `Linux (kernel ${linux[1]})`;
  if (value === "Linux Unknown") return "Linux (kernel unknown)";
  return value;
}
