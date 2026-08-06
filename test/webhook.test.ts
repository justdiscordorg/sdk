import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Webhook, TOLERANCE_SECONDS } from "../src/webhook.js";

const SECRET = "whsec_example";
const BODY = JSON.stringify({
  type: "vote.create",
  data: {
    project: { type: "bot", platform_id: "7740" },
    user: { id: "5183", username: "umutxyp", avatar_url: null },
    created_at: "2026-08-06T21:04:11.930Z",
    expires_at: "2026-08-07T09:04:11.930Z",
  },
});

function sign(body: string, at: number, secret = SECRET) {
  const mac = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${mac}`;
}

const NOW = 1_800_000_000;

describe("Webhook.verify", () => {
  const hook = new Webhook(SECRET);

  it("accepts what we signed", () => {
    const headers = { "x-justdiscord-signature": sign(BODY, NOW) };
    expect(hook.verify({ body: BODY, headers }, NOW)).toBe(true);
  });

  it("rejects a changed body", () => {
    const headers = { "x-justdiscord-signature": sign(BODY, NOW) };
    expect(hook.verify({ body: BODY.replace("5183", "9999"), headers }, NOW)).toBe(false);
  });

  it("rejects another secret", () => {
    const headers = { "x-justdiscord-signature": sign(BODY, NOW, "whsec_other") };
    expect(hook.verify({ body: BODY, headers }, NOW)).toBe(false);
  });

  it("rejects a stale delivery, and accepts a recent one", () => {
    expect(
      hook.verify({ body: BODY, headers: { "x-justdiscord-signature": sign(BODY, NOW - TOLERANCE_SECONDS - 1) } }, NOW),
    ).toBe(false);
    expect(
      hook.verify({ body: BODY, headers: { "x-justdiscord-signature": sign(BODY, NOW - 60) } }, NOW),
    ).toBe(true);
  });

  it("rejects a replayed mac with a fresh timestamp", () => {
    const old = sign(BODY, NOW - 10_000);
    const forged = old.replace(/^t=\d+/, `t=${NOW}`);
    expect(hook.verify({ body: BODY, headers: { "x-justdiscord-signature": forged } }, NOW)).toBe(false);
  });

  it("rejects nonsense rather than throwing", () => {
    for (const value of ["", "garbage", "t=abc,v1=zz", "t=1,v1=nothex"]) {
      expect(hook.verify({ body: BODY, headers: { "x-justdiscord-signature": value } }, NOW)).toBe(false);
    }
    expect(hook.verify({ body: BODY, headers: {} }, NOW)).toBe(false);
  });

  it("accepts the shared-secret mode", () => {
    expect(hook.verify({ body: BODY, headers: { authorization: SECRET } }, NOW)).toBe(true);
    expect(hook.verify({ body: BODY, headers: { authorization: "wrong" } }, NOW)).toBe(false);
  });

  it("finds the header however the framework spells it", () => {
    const headers = { "X-JustDiscord-Signature": sign(BODY, NOW) };
    // Node lowercases incoming headers, but a test framework or a proxy
    // may not, and a verifier that only looks one way fails silently.
    expect(hook.verify({ body: BODY, headers: { ...headers, "x-justdiscord-signature": headers["X-JustDiscord-Signature"] } }, NOW)).toBe(true);
  });
});

describe("Webhook.parse", () => {
  const hook = new Webhook(SECRET);
  const headers = { "x-justdiscord-signature": sign(BODY, Math.floor(Date.now() / 1000)), "x-justdiscord-delivery": "8412" };

  it("maps the signed payload", () => {
    const vote = hook.parse({ body: BODY, headers })!;
    expect(vote.event).toBe("vote.create");
    expect(vote.project).toEqual({ type: "bot", id: "7740" });
    expect(vote.user.id).toBe("5183");
    expect(vote.user.username).toBe("umutxyp");
    expect(vote.expiresAt?.toISOString()).toBe("2026-08-07T09:04:11.930Z");
    expect(vote.deliveryId).toBe("8412");
  });

  it("maps the shared-secret payload, bot and server", () => {
    const flat = JSON.stringify({ bot: "7740", user: "5183", type: "upvote", query: "" });
    const bot = hook.parse({ body: flat, headers: { authorization: SECRET } })!;
    expect(bot.project).toEqual({ type: "bot", id: "7740" });
    expect(bot.user.id).toBe("5183");

    const guild = JSON.stringify({ guild: "1319", user: "5183", type: "upvote" });
    const server = hook.parse({ body: guild, headers: { authorization: SECRET } })!;
    expect(server.project).toEqual({ type: "server", id: "1319" });
  });

  it("returns null rather than a half-parsed vote", () => {
    expect(hook.parse({ body: BODY, headers: {} })).toBeNull();
    expect(hook.parse({ body: "not json", headers: { authorization: SECRET } })).toBeNull();
  });
});
