export function bold(text: string) {
  return `\x1b[1m${text}\x1b[0m`;
}

export function green(text: string) {
  return `\x1b[32m${text}\x1b[0m`;
}

export function yellow(text: string) {
  return `\x1b[33m${text}\x1b[0m`;
}
