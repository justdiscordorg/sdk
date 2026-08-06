/**
 * Anything the API refused.
 *
 * One class rather than one per status: what a caller does about a 401
 * and a 403 is the same thing — look at `code` — and a hierarchy of
 * error classes is a hierarchy somebody has to `instanceof` through.
 */
export class JustDiscordError extends Error {
  /** The stable machine-readable code: `unauthorized`, `not_found`, … */
  readonly code: string;
  readonly status: number;
  /** Seconds to wait, on a `rate_limited`. */
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "JustDiscordError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }

  /** True when waiting and trying again is the right response. */
  get isRateLimited(): boolean {
    return this.code === "rate_limited";
  }
}
