import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookVote } from "./types.js";

/* ─────────────────────────────────────────────────────────────
   RECEIVING A VOTE

   The verifier is the same rule the site signs with, written the same
   way. A sender and a receiver that disagree about how a signature is
   computed is the failure this file exists to prevent, so there is one
   description of it and both sides use it.

   Two modes, because a listing can be configured either way:

     SIGNED — HMAC-SHA256 over `{timestamp}.{raw body}`, in
     `x-justdiscord-signature`. Nothing secret travels, and a captured
     delivery cannot be replayed.

     SHARED SECRET — the secret in a plain `Authorization` header, with
     a flat body. Weaker; supported so an endpoint somebody already has
     keeps working.
   ───────────────────────────────────────────────────────────── */

export const SIGNATURE_HEADER = "x-justdiscord-signature";
export const EVENT_HEADER = "x-justdiscord-event";
export const DELIVERY_HEADER = "x-justdiscord-delivery";

/** How old a signature may be. Long enough for a slow queue, short
    enough that a captured request is not a replay tomorrow. */
export const TOLERANCE_SECONDS = 300;

export interface VerifyInput {
  /** The body exactly as it arrived. Not a re-serialised object: that
      is a different string and will not match. */
  body: string;
  /** All request headers, however your framework spells them. */
  headers: Record<string, string | string[] | undefined>;
}

function header(headers: VerifyInput["headers"], name: string): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export class Webhook {
  readonly #secret: string;

  constructor(secret: string) {
    if (!secret) {
      throw new TypeError("A webhook secret is required. Copy it from your panel, under the listing's API & webhooks tab.");
    }
    this.#secret = secret;
  }

  /** Whether this request really came from JustDiscord. Handles both
      modes: signed first, shared secret as the fallback. */
  verify(input: VerifyInput, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    const signature = header(input.headers, SIGNATURE_HEADER);
    if (signature) return this.#verifySignature(input.body, signature, nowSeconds);

    const authorization = header(input.headers, "authorization");
    if (!authorization) return false;
    return this.#constantTimeEqual(Buffer.from(authorization), Buffer.from(this.#secret));
  }

  #verifySignature(body: string, signature: string, nowSeconds: number): boolean {
    const parts: Record<string, string> = {};
    for (const piece of signature.split(",")) {
      const at = piece.indexOf("=");
      if (at > 0) parts[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
    }

    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;

    const expected = createHmac("sha256", this.#secret).update(`${timestamp}.${body}`).digest();
    let given: Buffer;
    try {
      given = Buffer.from(parts.v1 ?? "", "hex");
    } catch {
      return false;
    }
    return this.#constantTimeEqual(given, expected);
  }

  #constantTimeEqual(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Verifies and parses in one step.
   *
   * Returns null when the signature does not check out — answer 401 and
   * do nothing else. Never parse a payload you have not verified.
   */
  parse(input: VerifyInput): WebhookVote | null {
    if (!this.verify(input)) return null;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(input.body) as Record<string, unknown>;
    } catch {
      return null;
    }

    const deliveryId = header(input.headers, DELIVERY_HEADER);

    // Signed shape: { type, data: { project, user, created_at, … } }
    if (raw.data && typeof raw.data === "object") {
      const data = raw.data as Record<string, any>;
      return {
        event: (raw.type as WebhookVote["event"]) ?? "vote.create",
        project: {
          type: (data.project?.type as "bot" | "server") ?? "bot",
          id: String(data.project?.platform_id ?? ""),
        },
        user: {
          id: String(data.user?.id ?? ""),
          username: String(data.user?.username ?? ""),
          avatarUrl: data.user?.avatar_url ?? null,
        },
        createdAt: data.created_at ? new Date(data.created_at) : new Date(),
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
        deliveryId,
        raw,
      };
    }

    // Shared-secret shape: { bot | guild, user, type, query }
    const isServer = typeof raw.guild === "string";
    return {
      event: raw.type === "test" ? "webhook.test" : "vote.create",
      project: { type: isServer ? "server" : "bot", id: String(raw.guild ?? raw.bot ?? "") },
      user: { id: String(raw.user ?? ""), username: "", avatarUrl: null },
      createdAt: new Date(),
      expiresAt: null,
      deliveryId,
      raw,
    };
  }

  /**
   * An Express-shaped handler.
   *
   * Answers before your work runs, deliberately: an endpoint that
   * finishes its job before it replies is an endpoint that gets retried
   * while it is still working. Mount it with a raw body parser —
   * `express.raw({ type: "application/json" })` — because the signature
   * covers the exact bytes.
   */
  listener(handler: (vote: WebhookVote) => void | Promise<void>) {
    return (
      request: { body: unknown; headers: Record<string, string | string[] | undefined> },
      response: { status: (code: number) => { end: () => void } },
    ): void => {
      const body = Buffer.isBuffer(request.body)
        ? request.body.toString("utf8")
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? {});

      const vote = this.parse({ body, headers: request.headers });
      if (!vote) {
        response.status(401).end();
        return;
      }

      response.status(204).end();
      if (vote.event === "vote.create") void handler(vote);
    };
  }
}
