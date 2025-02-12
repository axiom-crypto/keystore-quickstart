export function bold(text: string) {
  return `\x1b[1m${text}\x1b[0m`;
}

export function green(text: string) {
  return `\x1b[32m${text}\x1b[0m`;
}

export function yellow(text: string) {
  return `\x1b[33m${text}\x1b[0m`;
}

export function hyperlink(text: string, url: string) {
  return `\x1b[1;34m\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\\x1b[0m`;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
