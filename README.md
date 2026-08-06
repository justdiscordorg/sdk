# @justdiscord/sdk

The official client for the [JustDiscord](https://justdiscord.org) API.

Check whether somebody voted, post your bot's server count and its command
list, and verify the webhook we send when a vote happens.

TypeScript, no dependencies, ESM and CommonJS, Node 18+.

```bash
npm install @justdiscord/sdk
```

## Getting a token

Your panel → the listing → **Edit** → **API & webhooks** → **Create a token**.

It is shown once. We store a hash of it, so it cannot be shown again — copy it
into your environment, and press **Regenerate** if you ever lose it.

## Using it

```js
import { Api } from "@justdiscord/sdk";

const jd = new Api(process.env.JUSTDISCORD_TOKEN, { botId: client.user.id });

// Has this person voted in the last 12 hours?
if (await jd.hasVoted(interaction.user.id)) {
  // …
}

// How many servers you are in. On a timer, not on GUILD_CREATE.
setInterval(() => {
  jd.postStats({
    serverCount: client.guilds.cache.size,
    shardCount: client.shard?.count,
  });
}, 30 * 60 * 1000);

// Your commands, on your listing. Send the whole list; it replaces.
await jd.postCommands([
  { name: "play", description: "Play a song.", category: "Music", usage: "/play <song>" },
  { name: "queue", description: "Show what is playing next.", category: "Music" },
]);
```

### Server listings

People vote for servers here too. Same methods, keyed by guild id:

```js
const jd = new Api(process.env.JUSTDISCORD_TOKEN, { serverId: guild.id });

if (await jd.hasVotedServer(member.id)) await member.roles.add(supporterRole);

const { memberCount, onlineCount } = await jd.getServerStats();
```

## Webhooks

Point us at a URL in the panel and we `POST` to it the moment somebody votes.

```js
import express from "express";
import { Webhook } from "@justdiscord/sdk";

const app = express();
const hook = new Webhook(process.env.JUSTDISCORD_WEBHOOK_SECRET);

// Raw body: the signature covers the exact bytes, and a re-serialised
// object is a different string.
app.post(
  "/justdiscord/vote",
  express.raw({ type: "application/json" }),
  hook.listener(async (vote) => {
    console.log(`${vote.user.username} voted, valid until ${vote.expiresAt}`);
    await reward(vote.user.id);
  }),
);
```

`listener` answers `204` before your handler runs — an endpoint that finishes
its work before it replies is an endpoint that gets retried while it is still
working — and `401` when the signature does not check out.

Not using Express? Verify and parse yourself:

```js
const vote = hook.parse({ body: rawBodyString, headers: request.headers });
if (!vote) return respond(401);
```

Deliveries are **at-least-once**. Make your handler idempotent — key on
`vote.deliveryId`, or on `vote.user.id` plus `vote.createdAt`.

## Errors

Everything the API refuses throws a `JustDiscordError` carrying the API's own
code:

```js
import { JustDiscordError } from "@justdiscord/sdk";

try {
  await jd.postStats({ serverCount: 12 });
} catch (error) {
  if (error instanceof JustDiscordError && error.isRateLimited) {
    console.warn(`slow down for ${error.retryAfter}s`);
  }
}
```

| `code` | Meaning |
|---|---|
| `unauthorized` | No token, malformed, or revoked |
| `forbidden` | Valid token, someone else's listing |
| `not_found` | No published listing with that id |
| `invalid` | The body or a parameter is wrong |
| `rate_limited` | Over the limit — `retryAfter` says how long |

A `429` is waited out and retried automatically, twice by default, using the
`Retry-After` the server sends. Set `retries: 0` to handle it yourself.

## Reference

```ts
new Api(token, { botId?, serverId?, baseUrl?, timeout?, retries? })

jd.hasVoted(userId)                → boolean
jd.getVotes({ cursor?, limit? })   → { votes, cursor }
jd.getStats()                      → { serverCount, shardCount, reportedAt }
jd.postStats({ serverCount, shardCount? })
jd.postCommands(commands)          → number
jd.getCommands()                   → Command[]

jd.hasVotedServer(userId)          → boolean
jd.getServerVotes({ cursor? })     → { votes, cursor }
jd.getServerStats()                → { memberCount, onlineCount, checkedAt }

new Webhook(secret)
hook.verify({ body, headers })     → boolean
hook.parse({ body, headers })      → WebhookVote | null
hook.listener(handler)             → express handler
```

Full documentation, including the raw HTTP if you would rather not use a
library at all: **https://justdiscord.org/docs**

## Licence

MIT
