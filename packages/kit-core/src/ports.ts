export interface Clock {
  now(): Date
}

export interface IdGenerator {
  next(): string
}

/**
 * A transaction. All modules share one pool, so it CAN span modules, but by convention it stays within one module:
 * that is what lets a module move to its own database later without rewriting its use cases.
 */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/** Minimal logger for the application layer (pino satisfies this shape). */
export interface Log {
  info(fields: object, message: string): void
  warn(fields: object, message: string): void
  error(fields: object, message: string): void
}
