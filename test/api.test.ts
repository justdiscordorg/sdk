import { afterEach, describe, expect, it, vi } from "vitest";
import { Api } from "../src/api.js";
import { JustDiscordError } from "../src/errors.js";

/* The client is mostly plumbing, and plumbing is where the bugs are:
   which header, which path, what happens on a 429. Fetch is stubbed so
   these run anywhere, including in CI with no network. */

function stub(...responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Api", () => {
  it("sends the token and reads a vote check", async () => {
    const calls = stub({ status: 200, body: { voted: 1 } });
    const jd = new Api("jd_test", { botId: "7740" });

    expect(await jd.hasVoted("5183")).toBe(true);
    expect(calls[0]!.url).toBe("https://justdiscord.org/api/v0/bots/7740/check?userId=5183");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("jd_test");
  });

  it("treats anything other than 1 as not voted", async () => {
    stub({ status: 200, body: { voted: 0 } });
    expect(await new Api("jd_test", { botId: "7740" }).hasVoted("5183")).toBe(false);
  });

  it("posts stats in the shape the API expects", async () => {
    const calls = stub({ status: 200, body: {} });
    await new Api("jd_test", { botId: "7740" }).postStats({ serverCount: 12, shardCount: 2 });

    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ server_count: 12, shard_count: 2 });
  });

  it("omits shard_count when there is none", async () => {
    const calls = stub({ status: 200, body: {} });
    await new Api("jd_test", { botId: "7740" }).postStats({ serverCount: 12 });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ server_count: 12 });
  });

  it("maps voters and their dates", async () => {
    stub({
      status: 200,
      body: {
        votes: [{ id: "5183", username: "umutxyp", avatar: null, voted_at: "2026-08-06T21:04:11.930Z" }],
        cursor: "8412",
      },
    });
    const page = await new Api("jd_test", { botId: "7740" }).getVotes();
    expect(page.votes[0]!.userId).toBe("5183");
    expect(page.votes[0]!.votedAt).toBeInstanceOf(Date);
    expect(page.cursor).toBe("8412");
  });

  it("throws with the API's own code and message", async () => {
    stub({ status: 403, body: { error: "forbidden", message: "That token belongs to a different listing." } });
    await expect(new Api("jd_test", { botId: "7740" }).getStats()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("waits out a 429 and retries, once told when", async () => {
    vi.useFakeTimers();
    const calls = stub(
      { status: 429, body: { error: "rate_limited", message: "Slow down." }, headers: { "retry-after": "1" } },
      { status: 200, body: { voted: 1 } },
    );
    const promise = new Api("jd_test", { botId: "7740" }).hasVoted("5183");
    await vi.advanceTimersByTimeAsync(1100);
    expect(await promise).toBe(true);
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it("gives up when retries run out, and says how long to wait", async () => {
    vi.useFakeTimers();
    stub({ status: 429, body: { error: "rate_limited", message: "Slow down." }, headers: { "retry-after": "1" } });
    const jd = new Api("jd_test", { botId: "7740", retries: 1 });
    const promise = jd.hasVoted("5183").catch((error: JustDiscordError) => error);
    await vi.advanceTimersByTimeAsync(2000);
    const error = (await promise) as JustDiscordError;
    expect(error.isRateLimited).toBe(true);
    expect(error.retryAfter).toBe(1);
    vi.useRealTimers();
  });

  it("refuses to be built without a token, or called without an id", async () => {
    expect(() => new Api("")).toThrow(TypeError);
    await expect(new Api("jd_test").hasVoted("5183")).rejects.toThrow(/botId is required/);
  });
});
