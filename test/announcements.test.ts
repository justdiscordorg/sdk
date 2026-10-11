import { afterEach, describe, expect, it, vi } from "vitest";
import { Api } from "../src/api.js";

function stub(...responses: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const wire = {
  code: "k7m2xq9p",
  title: "Beatra 4.0",
  summary: "Gapless playback, a new queue, and lyrics that keep up.",
  category: "feature",
  state: "published",
  url: "/bots/beatra/announcements/k7m2xq9p",
  cover_url: "/media/announcement/ab/cd/x.webp",
  published_at: "2026-08-13T09:12:44.021Z",
  updated_at: null,
  review: { state: "approved", reason: null, submitted_at: "2026-08-12T20:04:11.930Z" },
};

describe("announcements", () => {
  it("lists them under the bot and maps the wire shape", async () => {
    const calls = stub({
      status: 200,
      body: {
        announcements: [wire],
        count: 1,
        limits: {
          title: { min: 5, max: 120 },
          summary: { min: 30, max: 160 },
          body: { min: 200, max: 10000 },
          cover_max_bytes: 2097152,
          max_pending: 3,
        },
      },
    });
    const list = await new Api("jd_test", { botId: "7740" }).getAnnouncements();

    expect(calls[0]!.url).toBe("https://justdiscord.org/api/v1/bots/7740/announcements");
    expect(list.count).toBe(1);
    expect(list.limits.coverMaxBytes).toBe(2097152);
    const one = list.announcements[0]!;
    expect(one.category).toBe("feature");
    expect(one.coverUrl).toBe(wire.cover_url);
    expect(one.publishedAt).toEqual(new Date(wire.published_at));
    expect(one.review?.submittedAt).toEqual(new Date(wire.review.submitted_at));
  });

  it("uses the server when the client holds only a serverId", async () => {
    const calls = stub({ status: 200, body: wire });
    await new Api("jd_test", { serverId: "1234" }).getAnnouncement("k7m2xq9p");
    expect(calls[0]!.url).toBe("https://justdiscord.org/api/v1/servers/1234/announcements/k7m2xq9p");
  });

  it("posts multipart with the category and the cover as a file", async () => {
    const calls = stub({ status: 201, body: { code: "k7m2xq9p", state: "pending", message: "Submitted." } });
    const receipt = await new Api("jd_test", { botId: "7740" }).createAnnouncement({
      title: "Beatra 4.0",
      summary: "Gapless playback, a new queue, and lyrics that keep up.",
      body: "## What changed\n\n" + "x".repeat(200),
      category: "feature",
      cover: new Uint8Array([137, 80, 78, 71]),
    });

    expect(receipt.code).toBe("k7m2xq9p");
    const init = calls[0]!.init;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    /* fetch writes the multipart Content-Type itself, boundary and all. */
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("category")).toBe("feature");
    expect(form.get("cover")).toBeInstanceOf(Blob);
  });

  it("sends only what an edit changes", async () => {
    const calls = stub({ status: 200, body: { code: "k7m2xq9p", state: "pending", message: "Edit submitted." } });
    await new Api("jd_test", { botId: "7740" }).updateAnnouncement("k7m2xq9p", { title: "Beatra 4.0.1" });

    const init = calls[0]!.init;
    expect(init.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://justdiscord.org/api/v1/bots/7740/announcements/k7m2xq9p");
    const form = init.body as FormData;
    expect(form.get("title")).toBe("Beatra 4.0.1");
    expect(form.has("category")).toBe(false);
    expect(form.has("cover")).toBe(false);
  });
});

describe("the public catalogue", () => {
  it("needs no token and sends none", async () => {
    const calls = stub({ status: 200, body: { items: [{ kind: "bot", slug: "beatra", listedAt: "2026-08-04T10:21:07.000Z" }], count: 1, limit: 10 } });
    const result = await new Api().getListings({ kind: "bot", tag: "music", limit: 10 });

    expect(calls[0]!.url).toBe("https://justdiscord.org/api/v1/listings?kind=bot&tag=music&limit=10");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(result.items[0]!.listedAt).toEqual(new Date("2026-08-04T10:21:07.000Z"));
  });

  it("reads one listing from the plural path", async () => {
    const calls = stub({ status: 200, body: { kind: "server", slug: "x", listedAt: "2026-08-04T10:21:07.000Z", reviews: [], histogram: null, description: "" } });
    await new Api().getListing("server", "x");
    expect(calls[0]!.url).toBe("https://justdiscord.org/api/v1/listings/servers/x");
  });

  it("refuses a listing's own endpoints without a token, before any request", async () => {
    const calls = stub({ status: 200, body: {} });
    await expect(new Api(undefined, { botId: "7740" }).hasVoted("1")).rejects.toThrow(TypeError);
    expect(calls.length).toBe(0);
  });
});
