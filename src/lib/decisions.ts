/**
 * The decision panel's pure half: the sample ticket, the request the
 * three question kinds produce, the copyable client lines, and the
 * answer descriptions. Kept out of the component so every piece a test
 * should pin — the request shape, the curl escaping, the SDK snippet's
 * retry-off flag — is a function of its inputs.
 *
 * The protocol is the pinned TypeSafe System One shape
 * (specs/docs/design/decision-models.md). The panel exists to be a
 * usable first client and a diagnostic — "the panel decides fine, so my
 * problem is in my app" — which is why the curl line reproduces the
 * exact request and why the SDK example disables the SDK's automatic
 * retries: a hidden retry against a decision endpoint is a second
 * decision nobody asked for.
 */

import type { components as GatewayComponents } from "@/generated/gateway";

export type SystemOneRequest = GatewayComponents["schemas"]["SystemOneRequest"];
export type SystemOneResponse = GatewayComponents["schemas"]["SystemOneResponse"];
export type SystemOneAnswer = GatewayComponents["schemas"]["SystemOneAnswer"];

/** A support ticket, structured — `state` takes objects verbatim. */
export const SAMPLE_TICKET = {
  ticket: "T-1042",
  customer: "I was charged twice for order A-1 and I want my money back.",
  agent: "I found the duplicate charge and issued a full refund just now.",
} as const;

/** One of each question kind, the shapes the protocol pins. */
export function sampleQuestions(): SystemOneRequest["questions"] {
  return {
    refunded: {
      type: "noul",
      instructions: "Was a refund issued?",
      criteria: { true: "money was returned", false: "no money returned yet" },
    },
    route: {
      type: "choice",
      instructions: "Route this ticket to the right team.",
      criteria: {
        billing: "payments, charges, refunds",
        shipping: "delivery problems",
        technical: "application bugs",
      },
    },
    urgency: {
      type: "score",
      instructions: "How urgent is this ticket now?",
      criteria: [
        "low: resolved or informational",
        "medium: needs a reply",
        "high: money or data at risk",
      ],
    },
  };
}

export function buildRequest(
  model: string,
  state: unknown,
  questions: SystemOneRequest["questions"],
): SystemOneRequest {
  return { model, state: state as SystemOneRequest["state"], questions };
}

/**
 * The exact request as a curl line, ASCII-escaped for the same reason
 * the playground's chat curl is: Git Bash on Windows hands non-ASCII to
 * curl through the ANSI code page one byte short (measured at the
 * playground-diagnostic run), and `\uXXXX` escapes are the same JSON
 * value.
 */
export function curlLine(baseUrl: string, request: SystemOneRequest): string {
  const body = JSON.stringify(request, null, 2).replace(
    /[\u007f-￿]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  const url = baseUrl.replace(/\/+$/, "") + "/v1/systemone";
  return [
    `curl ${url} \\`,
    `  -H "Authorization: Bearer $EUGENE_PLEXUS_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${body.replace(/'/g, "'\\''")}'`,
  ].join("\n");
}

/**
 * The pinned TypeSafe Python SDK example. `max_retries=0` is not
 * decoration: TypeSafe's SDKs retry automatically by default, and a
 * retried decision is a second decision (and a second bill) nobody
 * asked for — the pin's own docs say the SDKs handle retries, so the
 * example turns that off explicitly.
 */
export function sdkSnippet(baseUrl: string, model: string): string {
  const url = baseUrl.replace(/\/+$/, "");
  return [
    "# pip install typesafe==1.13.*   (pin the major.minor you tested)",
    "from typesafe import TypeSafe",
    "",
    "client = TypeSafe(",
    `    base_url="${url}",`,
    '    api_key="YOUR_EUGENE_CLIENT_KEY",  # Home -> Use it from your apps',
    "    max_retries=0,  # a retried decision is a second decision",
    ")",
    "result = client.systemone.create(",
    `    model="${model}",`,
    '    state="I was charged twice for order A-1.",',
    "    questions={",
    '        "refunded": {"type": "noul", "instructions": "Was a refund issued?"},',
    "    },",
    ")",
    'print(result.answers["refunded"].noul)',
  ].join("\n");
}

/** One sentence per answer, for the result inspector. */
export function describeAnswer(name: string, answer: SystemOneAnswer): string {
  if (answer.type === "noul") {
    const p = answer.noul ?? 0;
    return `${name}: ${(p * 100).toFixed(0)}% yes`;
  }
  if (answer.type === "choice") {
    const confidence =
      answer.confidence != null ? ` (confidence ${(answer.confidence * 100).toFixed(0)}%)` : "";
    return `${name}: ${answer.choice}${confidence}`;
  }
  const legend = answer.legend ?? {};
  const nearest = Math.round(answer.score ?? 0);
  const label = legend[String(nearest)] ?? String(answer.score);
  return `${name}: ${answer.score?.toFixed(2)} — nearest level "${label}"`;
}

/**
 * Registering another System One-compatible server, as the panel's own
 * recipe text: the contract checks it must pass are the driver's, and
 * naming them here is what makes "compatible" checkable rather than
 * aspirational.
 */
export const REGISTER_SERVER_RECIPE = [
  "Run a driver with provider `systemone_custom` and `baseUrl` pointing at the server",
  "(Config on any inference driver, or declare a new one). The server must answer",
  "POST /v1/systemone in the pinned TypeSafe shape: noul/choice/score questions,",
  "answers keyed by the request's question names, every question answered with the",
  "matching type, choice distributions over the request's own options summing to 1.",
  "Malformed answers are refused as backend errors — Eugene never repairs a",
  "decision. Set `backendLocality` honestly: only a confirmed-local server can",
  "serve local-only keys.",
].join(" ");
