/**
 * Why a reply stopped at its length, naming the setting that made it when
 * the gateway said (`x_eugene_plexus.output_cap`).
 *
 * **Why (2026-10-10).** A Strata answer stopped mid-thought at 4,096 tokens
 * and the words blamed the request's own setting; the cap was the install's
 * `defaultMaxTokens`, saved long before.
 */

import type { CompletionRoutingInfo } from "./types";

type OutputCap = NonNullable<CompletionRoutingInfo["output_cap"]>;

export function lengthStopWords(cap: OutputCap | null | undefined): {
  badge: string;
  title: string;
} {
  if (!cap) {
    return {
      badge: "hit a length limit",
      title:
        "The reply stopped at a length limit, not at a natural end: an output cap, the " +
        "model's context window, or its backend's own limit.",
    };
  }
  const tokens = cap.tokens.toLocaleString("en-US");
  switch (cap.source) {
    case "request":
      return {
        badge: `hit max_tokens (${tokens})`,
        title: `The reply stopped at this request's max_tokens, ${tokens}. Raise it in Request settings, or clear it.`,
      };
    case "profile":
      return {
        badge: `hit the profile's cap (${tokens})`,
        title: `The reply stopped at ${tokens} tokens, the Maximum output tokens on this model's default Library profile. Change it on the profile.`,
      };
    case "install":
      return {
        badge: `hit the install's cap (${tokens})`,
        title: `The reply stopped at ${tokens} tokens, this install's Default max output tokens (Settings, gateway). Clear it there for no cap.`,
      };
  }
}
