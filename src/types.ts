/* The shapes the API speaks, as types.
 *
 * Written out rather than generated: an OpenAPI generator produces
 * names nobody chose and a file nobody reads, and this API is six
 * endpoints. What a caller sees here is what the documentation says.
 */

/** A bot listing, or a server listing. */
export type ProjectType = "bot" | "server";

export interface Vote {
  /** Discord id of the person who voted. */
  userId: string;
  username: string;
  /** Path on justdiscord.org, or null when they have no avatar here. */
  avatarUrl: string | null;
  votedAt: Date;
}

export interface VotePage {
  votes: Vote[];
  /** Pass to the next call to continue. `null` on the last page. */
  cursor: string | null;
}

export interface BotStats {
  serverCount: number | null;
  shardCount: number | null;
  reportedAt: Date | null;
}

export interface ServerStats {
  memberCount: number | null;
  onlineCount: number | null;
  checkedAt: Date | null;
}

export interface StatsInput {
  serverCount: number;
  shardCount?: number | null;
}

export interface Command {
  name: string;
  description: string;
  /** Groups the command on your listing. Free text. */
  category?: string | null;
  /** How it is called, in your own syntax: `/play <song>`. */
  usage?: string | null;
  /** Discord permission names, as you name them. */
  permissions?: string[];
}

/* ── Webhooks ────────────────────────────────────────────────── */

export interface WebhookUser {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface WebhookVote {
  /** `vote.create`, or `webhook.test` for the panel's test button. */
  event: "vote.create" | "webhook.test";
  project: { type: ProjectType; id: string };
  user: WebhookUser;
  createdAt: Date;
  /** When the vote stops counting, and the same person may vote again. */
  expiresAt: Date | null;
  /** Delivery id, for making your handler idempotent. */
  deliveryId: string | null;
  /** Everything as it arrived, in case you want a field we do not map. */
  raw: unknown;
}
