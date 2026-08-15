import { JustDiscordError } from "./errors.js";
import type {
  BotStats,
  Command,
  ServerStats,
  StatsInput,
  VotePage,
} from "./types.js";

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
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #botId?: string;
  readonly #serverId?: string;

  constructor(token: string, options: ApiOptions = {}) {
    if (!token || typeof token !== "string") {
      throw new TypeError("A JustDiscord API token is required. Find it in your panel, under the listing's API & webhooks tab.");
    }
    this.#token = token;
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
      `onlineCount` was removed here in 1.0.2 rather than left as a
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

  /* ── Plumbing ─────────────────────────────────────────────── */

  #need(value: string | undefined, name: string): string {
    if (!value) {
      throw new TypeError(
        `${name} is required — pass it to the constructor (new Api(token, { ${name}: "…" })) or to this call.`,
      );
    }
    return value;
  }

  async #request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.#baseUrl + path, {
        method,
        headers: {
          Authorization: this.#token,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
      return this.#request<T>(method, path, body, attempt + 1);
    }

    throw new JustDiscordError(
      response.status,
      problem.error ?? "server_error",
      problem.message ?? `JustDiscord answered ${response.status}.`,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }
}
