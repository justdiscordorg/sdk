/* The shapes the API speaks, as types.
 *
 * Written out rather than generated: an OpenAPI generator produces
 * names nobody chose and a file nobody reads, and this API is a
 * handful of endpoints. What a caller sees here is what the documentation says.
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

/* ── Announcements ───────────────────────────────────────────── */

/** What kind of news an announcement is. Required when you post one. */
export type AnnouncementCategory = "announcement" | "event" | "feature";

/** Where an announcement is in review. */
export type AnnouncementState =
  | "pending"
  | "published"
  | "edit_pending"
  | "changes_requested"
  | "rejected"
  | "removed";

export interface Announcement {
  /** Eight characters; the announcement's address and handle. */
  code: string;
  title: string;
  summary: string;
  category: AnnouncementCategory;
  state: AnnouncementState;
  /** Path on justdiscord.org once published, otherwise null. */
  url: string | null;
  coverUrl: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  /** The newest version's review, when there is one. */
  review: { state: string; reason: string | null; submittedAt: Date } | null;
}

export interface AnnouncementLimits {
  title: { min: number; max: number };
  summary: { min: number; max: number };
  body: { min: number; max: number };
  coverMaxBytes: number;
  maxPending: number;
}

export interface AnnouncementList {
  announcements: Announcement[];
  count: number;
  limits: AnnouncementLimits;
}

/** A cover image: the file's bytes, and its type when it is not a Blob. */
export type CoverInput = Blob | Uint8Array | ArrayBuffer;

export interface AnnouncementInput {
  title: string;
  summary: string;
  /** Markdown. */
  body: string;
  category: AnnouncementCategory;
  /** PNG, JPEG, WebP or GIF under 2 MB. Required to publish. */
  cover: CoverInput;
}

/** An edit: every field optional. A left-out cover or category keeps the current one. */
export type AnnouncementEdit = Partial<AnnouncementInput>;

export interface AnnouncementReceipt {
  code: string;
  state: "pending";
  message: string;
}

/* ── The public catalogue ────────────────────────────────────── */

export interface ListingRating {
  average: number;
  /** The figure the site orders by. */
  weighted: number;
  count: number;
  reviews: number;
}

export interface Listing {
  kind: ProjectType;
  slug: string;
  name: string;
  tagline: string;
  tags: string[];
  verified: boolean;
  /** Null until somebody has scored it. */
  rating: ListingRating | null;
  /** Path on justdiscord.org. */
  url: string;
  listedAt: Date;
  /** Servers. */
  members?: number | null;
  languages?: string[];
  /** Bots: what the bot posted about itself. */
  guildCountSelfReported?: number | null;
  votes?: number;
  prefix?: string | null;
}

export interface ListingReview {
  id: string;
  /** `deleted-account` when the author's account is gone. */
  author: string;
  authorAvatar: string | null;
  score: number;
  body: string;
  helpful: number;
  dislikes: number;
  createdAt: Date;
}

export interface ListingDetail extends Listing {
  /** Markdown. */
  description: string;
  /** Scores of 1 to 5, or null when there are none. */
  histogram: number[] | null;
  reviews: ListingReview[];
}

export interface CatalogueQuery {
  kind?: ProjectType | "emoji" | "sticker" | "pack";
  q?: string;
  tag?: string;
  sort?: "rating" | "votes" | "reviews" | "popular" | "newest" | "name" | "bumped";
  verified?: boolean;
  /** Up to 50. Default 25. */
  limit?: number;
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
