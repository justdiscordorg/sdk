/**
 * The official JustDiscord client.
 *
 * ```js
 * import { Api, Webhook } from "@justdiscord/sdk";
 *
 * const jd = new Api(process.env.JUSTDISCORD_TOKEN, { botId: client.user.id });
 * await jd.postStats({ serverCount: client.guilds.cache.size });
 * if (await jd.hasVoted(userId)) { … }
 * ```
 *
 * Documentation: https://justdiscord.org/docs
 */
export { Api, type ApiOptions } from "./api.js";
export { JustDiscordError } from "./errors.js";
export {
  Webhook,
  SIGNATURE_HEADER,
  EVENT_HEADER,
  DELIVERY_HEADER,
  TOLERANCE_SECONDS,
  type VerifyInput,
} from "./webhook.js";
export type {
  BotStats,
  Command,
  ProjectType,
  ServerStats,
  StatsInput,
  Vote,
  VotePage,
  WebhookUser,
  WebhookVote,
} from "./types.js";
