import { JustDiscordError } from "./errors.js";
import type {
  Announcement,
  AnnouncementEdit,
  AnnouncementInput,
  AnnouncementList,
  AnnouncementReceipt,
  BotStats,
  CatalogueQuery,
  Command,
  CoverInput,
  Listing,
  ListingDetail,
  ProjectType,
  ServerStats,
  StatsInput,
  VotePage,
} from "./types.js";

/* The wire shape of one announcement, before the client maps it. */
interface WireAnnouncement {
  code: string;
  title: string;
  summary: string;
  category: Announcement["category"];
  state: Announcement["state"];
  url: string | null;
  cover_url: string | null;
  published_at: string | null;
  updated_at: string | null;
  review: { state: string; reason: string | null; submitted_at: string } | null;
}

function toAnnouncement(row: WireAnnouncement): Announcement {
  return {
    code: row.code,
    title: row.title,
    summary: row.summary,
    category: row.category,
    state: row.state,
    url: row.url,
    coverUrl: row.cover_url,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    review: row.review
      ? { state: row.review.state, reason: row.review.reason, submittedAt: new Date(row.review.submitted_at) }
      : null,
  };
}

function coverBlob(cover: CoverInput): Blob {
  return cover instanceof Blob ? cover : new Blob([cover as ArrayBuffer]);
}

/* ─────────────────────────────────────────────────────────────
   THE CLIENT

   Everything a listing's own code needs, in one class and no
   dependencies. `fetch` is in every runtime this supports, so a client
   library that ships an HTTP stack ships a second one nobody asked for.

   The id is remembered rather than passed to every call: a bot has one
   application id and repeating it at six call sites is six chances to
   pass the wrong one.
   ───────────────────────────────────────────────────────────── */

export interface ApiOptions {
  /** Your bot's application id. Required for the bot methods. */
  botId?: string;
  /** Your server's guild id. Required for the server methods. */
  serverId?: string;
  /** Override for testing. Defaults to the live API. */
  baseUrl?: string;
  /** Per request, in milliseconds. Default 10s. */
  timeout?: number;
  /**
   * Wait and try again on a 429, up to this many times. Default 2.
   *
   * The wait comes from `Retry-After`, not from a guess: a client that
   * invents its own backoff is a client that hammers a service which
   * has already told it exactly when to come back.
   */
  retries?: number;
}

const DEFAULT_BASE = "https://justdiscord.org/api";

export class Api {
  readonly #token: string | null;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #botId?: string;
  readonly #serverId?: string;

  /**
   * `token` is needed for everything about your own listing. The public
   * catalogue (`getListings`, `getListing`) answers without one, so
   * `new Api()` is enough for that.
   */
  constructor(token?: string | null, options: ApiOptions = {}) {
    if (token != null && typeof token !== "string") {
      throw new TypeError("A JustDiscord API token must be a string.");
    }
    this.#token = token || null;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.#timeout = options.timeout ?? 10_000;
    this.#retries = options.retries ?? 2;
    this.#botId = options.botId;
    this.#serverId = options.serverId;
  }

  /* ── Bots ─────────────────────────────────────────────────── */

  /** Whether that person has an active vote for your bot. */
  async hasVoted(userId: string, botId = this.#botId): Promise<boolean> {
    const data = await this.#request<{ voted: number }>(
      "GET",
      `/v0/bots/${this.#need(botId, "botId")}/check?userId=${encodeURIComponent(userId)}`,
    );
    return data.voted === 1;
  }

  /** Recent voters, newest first. Pass `cursor` from the last page. */
  async getVotes(options: { cursor?: string | null; limit?: number; botId?: string } = {}): Promise<VotePage> {
    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();

    const data = await this.#request<{
      votes: { id: string; username: string; avatar: string | null; voted_at: string }[];
      cursor: string | null;
    }>("GET", `/v0/bots/${this.#need(options.botId ?? this.#botId, "botId")}/votes${query ? `?${query}` : ""}`);

    return {
      votes: data.votes.map((vote) => ({
        userId: vote.id,
        username: vote.username,
        avatarUrl: vote.avatar,
        votedAt: new Date(vote.voted_at),
      })),
      cursor: data.cursor,
    };
  }

  /** What your bot last reported about itself. */
  async getStats(botId = this.#botId): Promise<BotStats> {
    const data = await this.#request<{
      server_count: number | null;
      shard_count: number | null;
      reported_at: string | null;
    }>("GET", `/v0/bots/${this.#need(botId, "botId")}/stats`);
    return {
      serverCount: data.server_count,
      shardCount: data.shard_count,
      reportedAt: data.reported_at ? new Date(data.reported_at) : null,
    };
  }

  /**
   * Reports how many servers your bot is in.
   *
   * Call it on a timer — every 30 minutes is plenty — and not on
   * `GUILD_CREATE`: a restart would post it fifty times and spend your
   * hourly allowance in a minute.
   */
  async postStats(stats: StatsInput, botId = this.#botId): Promise<void> {
    await this.#request("POST", `/v0/bots/${this.#need(botId, "botId")}/stats`, {
      server_count: stats.serverCount,
      ...(stats.shardCount == null ? {} : { shard_count: stats.shardCount }),
    });
  }

  /**
   * Publishes your command list. It appears on your listing.
   *
   * Send the whole list every time: this replaces rather than merges,
   * so a command you drop stops being advertised.
   */
  async postCommands(commands: Command[], botId = this.#botId): Promise<number> {
    const data = await this.#request<{ count: number }>(
      "PUT",
      `/v1/bots/${this.#need(botId, "botId")}/commands`,
      { commands },
    );
    return data.count;
  }

  async getCommands(botId = this.#botId): Promise<Command[]> {
    const data = await this.#request<{ commands: Command[] }>(
      "GET",
      `/v1/bots/${this.#need(botId, "botId")}/commands`,
    );
    return data.commands;
  }

  /* ── Servers ──────────────────────────────────────────────── */

  /** Whether that person has an active vote for your server. */
  async hasVotedServer(userId: string, serverId = this.#serverId): Promise<boolean> {
    const data = await this.#request<{ voted: number }>(
      "GET",
      `/v0/servers/${this.#need(serverId, "serverId")}/check?userId=${encodeURIComponent(userId)}`,
    );
    return data.voted === 1;
  }

  async getServerVotes(options: { cursor?: string | null; limit?: number; serverId?: string } = {}): Promise<VotePage> {
    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();

    const data = await this.#request<{
      votes: { id: string; username: string; avatar: string | null; voted_at: string }[];
      cursor: string | null;
    }>(
      "GET",
      `/v0/servers/${this.#need(options.serverId ?? this.#serverId, "serverId")}/votes${query ? `?${query}` : ""}`,
    );

    return {
      votes: data.votes.map((vote) => ({
        userId: vote.id,
        username: vote.username,
        avatarUrl: vote.avatar,
        votedAt: new Date(vote.voted_at),
      })),
      cursor: data.cursor,
    };
  }

  /** The member count, as our bot last read it inside the server. There
      is nothing to post: a guild cannot claim its own.

      There is no online count. That figure needs Discord's presence
      intent, which is privileged, and the API stopped returning it —
      `onlineCount` was removed in 2.0 rather than left as a
      field that is always null. */
  async getServerStats(serverId = this.#serverId): Promise<ServerStats> {
    const data = await this.#request<{
      member_count: number | null;
      checked_at: string | null;
    }>("GET", `/v0/servers/${this.#need(serverId, "serverId")}/stats`);
    return {
      memberCount: data.member_count,
      checkedAt: data.checked_at ? new Date(data.checked_at) : null,
    };
  }

  /* ── Announcements ────────────────────────────────────────── */

  /*
   * Posts under your listing — a release, an event, a new feature. Every
   * one waits for a moderator before it is public, and an edit leaves the
   * live copy up until the new version is approved.
   *
   * They work for a bot or a server: `type` picks which, and defaults to
   * the bot when the client was given a `botId`, otherwise the server.
   */

  /** Everything this listing has posted, newest first, with its review state. */
  async getAnnouncements(type?: ProjectType): Promise<AnnouncementList> {
    const data = await this.#request<{
      announcements: WireAnnouncement[];
      count: number;
      limits: {
        title: { min: number; max: number };
        summary: { min: number; max: number };
        body: { min: number; max: number };
        cover_max_bytes: number;
        max_pending: number;
      };
    }>("GET", `${this.#listing(type)}/announcements`);
    return {
      announcements: data.announcements.map(toAnnouncement),
      count: data.count,
      limits: {
        title: data.limits.title,
        summary: data.limits.summary,
        body: data.limits.body,
        coverMaxBytes: data.limits.cover_max_bytes,
        maxPending: data.limits.max_pending,
      },
    };
  }

  /** One announcement by its code — to see where its review got to. */
  async getAnnouncement(code: string, type?: ProjectType): Promise<Announcement> {
    const data = await this.#request<WireAnnouncement>(
      "GET",
      `${this.#listing(type)}/announcements/${encodeURIComponent(code)}`,
    );
    return toAnnouncement(data);
  }

  /**
   * Submits a new announcement for review. Keep the returned `code`: it is
   * the announcement's address and the handle for every later call.
   */
  async createAnnouncement(input: AnnouncementInput, type?: ProjectType): Promise<AnnouncementReceipt> {
    return this.#request<AnnouncementReceipt>("POST", `${this.#listing(type)}/announcements`, announcementForm(input));
  }

  /**
   * Submits a new version of an announcement. Only what you pass changes;
   * a left-out cover or category keeps the current one.
   */
  async updateAnnouncement(code: string, edit: AnnouncementEdit, type?: ProjectType): Promise<AnnouncementReceipt> {
    return this.#request<AnnouncementReceipt>(
      "PATCH",
      `${this.#listing(type)}/announcements/${encodeURIComponent(code)}`,
      announcementForm(edit),
    );
  }

  /* ── The public catalogue ─────────────────────────────────── */

  /** Search servers, bots, emoji, stickers or packs. No token needed. */
  async getListings(query: CatalogueQuery = {}): Promise<{ items: Listing[]; count: number; limit: number }> {
    const params = new URLSearchParams();
    if (query.kind) params.set("kind", query.kind);
    if (query.q) params.set("q", query.q);
    if (query.tag) params.set("tag", query.tag);
    if (query.sort) params.set("sort", query.sort);
    if (query.verified) params.set("verified", "1");
    if (query.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    const data = await this.#request<{ items: (Listing & { listedAt: string })[]; count: number; limit: number }>(
      "GET",
      `/v1/listings${qs ? `?${qs}` : ""}`,
      undefined,
      0,
      false,
    );
    return {
      ...data,
      items: data.items.map((item) => ("listedAt" in item ? { ...item, listedAt: new Date(item.listedAt) } : item)),
    };
  }

  /** One server or bot, with its description, score histogram and reviews. No token needed. */
  async getListing(kind: ProjectType, slug: string): Promise<ListingDetail> {
    const data = await this.#request<ListingDetail & { listedAt: string; reviews: { createdAt: string }[] }>(
      "GET",
      `/v1/listings/${kind === "bot" ? "bots" : "servers"}/${encodeURIComponent(slug)}`,
      undefined,
      0,
      false,
    );
    return {
      ...data,
      listedAt: new Date(data.listedAt),
      reviews: data.reviews.map((review) => ({ ...review, createdAt: new Date(review.createdAt) })),
    } as ListingDetail;
  }

  /* ── Plumbing ─────────────────────────────────────────────── */

  /** `/v1/bots/<id>` or `/v1/servers/<id>`, from `type` or from what the client holds. */
  #listing(type?: ProjectType): string {
    const kind = type ?? (this.#botId ? "bot" : this.#serverId ? "server" : "bot");
    return kind === "bot"
      ? `/v1/bots/${this.#need(this.#botId, "botId")}`
      : `/v1/servers/${this.#need(this.#serverId, "serverId")}`;
  }

  #need(value: string | undefined, name: string): string {
    if (!value) {
      throw new TypeError(
        `${name} is required — pass it to the constructor (new Api(token, { ${name}: "…" })) or to this call.`,
      );
    }
    return value;
  }

  async #request<T>(method: string, path: string, body?: unknown, attempt = 0, authed = true): Promise<T> {
    if (authed && !this.#token) {
      throw new TypeError(
        "A JustDiscord API token is required for this. Find it in your panel, under the listing's API & webhooks tab.",
      );
    }
    /* A FormData body is sent as multipart and fetch writes its own
       Content-Type, boundary included; everything else is JSON. */
    const form = body instanceof FormData;
    let response: Response;
    try {
      response = await fetch(this.#baseUrl + path, {
        method,
        headers: {
          ...(this.#token ? { Authorization: this.#token } : {}),
          Accept: "application/json",
          ...(body === undefined || form ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: form ? (body as FormData) : JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#timeout),
      });
    } catch (cause) {
      throw new JustDiscordError(0, "network", `Could not reach JustDiscord: ${(cause as Error).message}`);
    }

    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const problem = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const retryAfter = Number(response.headers.get("retry-after"));

    /* One retry path, and only for the one status that says when to come
       back. Retrying a 400 changes nothing; retrying a 401 changes
       nothing and looks like a brute force. */
    if (response.status === 429 && attempt < this.#retries) {
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return this.#request<T>(method, path, body, attempt + 1, authed);
    }

    throw new JustDiscordError(
      response.status,
      problem.error ?? "server_error",
      problem.message ?? `JustDiscord answered ${response.status}.`,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
}

/* Multipart, because the cover is a file: base64 in JSON costs a third
   more bytes and the API accepts both. */
function announcementForm(input: AnnouncementEdit): FormData {
  const form = new FormData();
  for (const field of ["title", "summary", "body", "category"] as const) {
    const value = input[field];
    if (value !== undefined) form.set(field, value);
  }
  if (input.cover !== undefined) form.set("cover", coverBlob(input.cover), "cover");
  return form;
}
