const BAR_WIDTH = 30;

export function formatProgress(
  file: string,
  percent: number | null,
): string {
  if (percent === null) {
    return `  Downloading ${file}...`;
  }

  const filled = Math.round((percent / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
  return `  ${file} [${bar}] ${percent.toFixed(0)}%`;
}

export function writeProgress(line: string): void {
  if (process.stderr.isTTY === true) {
    process.stderr.write(`\r\x1b[K${line}`);
  }
}

export function clearProgress(): void {
  if (process.stderr.isTTY === true) {
    process.stderr.write("\r\x1b[K");
  }
}
