import { api } from "./api";
import type { AdministrationLoginResponse } from "./types";

const pendingKey = "eugene-administration-signin";
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export async function beginAdministrationSignIn(): Promise<void> {
  if (!window.isSecureContext || !crypto.subtle)
    throw new Error(
      "Shared sign-in needs HTTPS or localhost. Local password sign-in is still available.",
    );
  const response = await fetch("/oidc/.well-known/openid-configuration", { cache: "no-store" });
  if (!response.ok)
    throw new Error(
      "Eugene's sign-in service is unavailable. Try again after the owner unlocks it.",
    );
  const metadata = await response.json();
  const issuer = new URL(metadata.issuer);
  if (issuer.origin !== window.location.origin)
    throw new Error(`Use ${issuer.origin}/administration/ for shared sign-in.`);
  const verifier = b64(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const redirectUri = window.location.origin + "/administration/";
  sessionStorage.setItem(
    pendingKey,
    JSON.stringify({
      verifier,
      state,
      issuer: issuer.href.replace(/\/$/, ""),
      redirectUri,
      expires: Date.now() + 600_000,
    }),
  );
  const url = new URL(issuer.href.replace(/\/$/, "") + "/authorize");
  url.search = new URLSearchParams({
    client_id: "eugene-administration",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile",
    state,
    nonce: b64(crypto.getRandomValues(new Uint8Array(32))),
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  window.location.assign(url.href);
}

export async function finishAdministrationSignIn(): Promise<string | null> {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) return null;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const issuer = url.searchParams.get("iss");
  const error = url.searchParams.get("error");
  for (const key of ["code", "state", "iss", "error", "error_description"])
    url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
  const raw = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (!raw)
    throw new Error("This sign-in was started in another browser or has expired. Start again.");
  const pending = JSON.parse(raw);
  if (pending.state !== state || pending.issuer !== issuer || pending.expires <= Date.now())
    throw new Error("This sign-in does not match the request from this browser. Start again.");
  if (error || !code)
    throw new Error(
      "Eugene did not grant administration access. Ask the owner to review your account.",
    );
  const answer = await api.post<AdministrationLoginResponse>(
    "control",
    "/v1/auth/administration/code",
    { code, verifier: pending.verifier, redirectUri: pending.redirectUri },
    { skipAuth: true },
  );
  return answer.sessionToken;
}
