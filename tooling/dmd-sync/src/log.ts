function ts(): string {
  return new Date().toISOString()
}

export const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`[${ts()}] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[${ts()}] WARN  ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[${ts()}] ERROR ${msg}`, ...args),
  step: (msg: string) => console.log(`\n[${ts()}] === ${msg} ===`),
}
