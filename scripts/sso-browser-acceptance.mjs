// Production pages, real agent/root/Workbench APIs. Only the upstream IdP is a fixture.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
browser.on("context", (context) => context.setDefaultTimeout(15000));
const errors = [];
const statePath = config.output + "/browser-state.json";
try {
  for (const key of ["agent", "control", "workbench", "provider"])
    expect(new URL(config[key]).hostname).toBe("127.0.0.1");
  const owner = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const login = await owner.request.post(config.agent + "/v1/auth/login", {
    data: { passphrase: config.password },
  });
  expect(login.status()).toBe(200);
  await owner.addInitScript(
    (token) => sessionStorage.setItem("eugene-session-token", token),
    (await login.json()).sessionToken,
  );
  const ownerPage = await owner.newPage();
  ownerPage.on("pageerror", (error) => errors.push(error.message));
  await ownerPage.goto(config.agent + "/people/");
  let invitation;
  if (!config.resume) {
    await ownerPage.getByText("External sign-in", { exact: true }).click();
    await ownerPage
      .getByLabel("Eugene sign-in address", { exact: true })
      .fill(config.agent + "/oidc");
    await ownerPage.getByRole("button", { name: "Save sign-in address", exact: true }).click();
    await expect(
      ownerPage.getByText(config.agent + "/oidc/external/callback", { exact: true }),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Add sign-in provider" }).click();
    await ownerPage.getByRole("combobox", { name: "Provider", exact: true }).selectOption("oidc");
    await ownerPage.getByLabel("Button label", { exact: true }).fill("Example SSO");
    await ownerPage.getByLabel("Provider issuer", { exact: true }).fill(config.provider + "/");
    await ownerPage.getByLabel("Client ID", { exact: true }).fill("eugene-acceptance");
    await ownerPage.getByLabel("Client secret", { exact: true }).fill(config.password);
    await ownerPage
      .locator("select")
      .filter({ has: ownerPage.locator('option[value="client_secret_post"]') })
      .selectOption("client_secret_post");
    await ownerPage.getByRole("button", { name: "Save provider", exact: true }).click();
    await expect(ownerPage.getByRole("button", { name: "Edit Example SSO" })).toBeVisible();
    await ownerPage.screenshot({
      path: config.output + "/sso-providers-desktop.png",
      fullPage: true,
    });
    await ownerPage.getByRole("link", { name: "Manage Ada", exact: true }).click();
    await ownerPage
      .getByRole("combobox", { name: "Invite through", exact: true })
      .selectOption({ label: "Example SSO" });
    await ownerPage.getByRole("button", { name: "Create sign-in invitation" }).click();
    const panel = ownerPage.getByRole("region", { name: "Sign-in and sessions", exact: true });
    invitation = await panel.locator("code").innerText();
    await ownerPage.getByRole("button", { name: "I have copied the invitation" }).click();
  }
  const member = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    ...(config.resume ? { storageState: statePath } : {}),
  });
  const page = await member.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  if (!config.resume) {
    await page.goto(config.agent + "/oidc/invitation");
    await page.getByLabel("Invitation code").fill(invitation);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(/Eugene account/)).toContainText("Ada");
    await page.getByRole("button", { name: "Connect with Example SSO" }).click();
    await page.getByRole("button", { name: "Sign in as Ada" }).click();
  } else {
    await page.goto(config.agent + "/oidc/account");
  }
  await expect(page.getByRole("heading", { name: "Your sign-in and sessions" })).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toContainText("Ada");
  const signIns = await owner.request.get(config.control + `/v1/people/${config.person}/sign-in`, {
    headers: { Authorization: "Bearer " + config.owner },
  });
  expect(signIns.status()).toBe(200);
  expect((await signIns.json()).sessions.some((session) => session.label.includes("Chrome/"))).toBe(
    true,
  );
  await page.screenshot({ path: config.output + "/sso-account-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: config.output + "/sso-account-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  // The shared browser session reuses the original local account and its old chat.
  await page.goto(config.workbench + "/signin");
  await page.getByRole("button", { name: "Continue as Ada", exact: true }).click();
  await page.waitForURL(config.workbench + "/**");
  await expect(page.getByRole("link", { name: /My sign-in and sessions/ })).toBeVisible();
  const privateChat = await page.evaluate(async (id) => {
    const headers = { "X-Workbench-Secret": localStorage.getItem("workbench-secret") };
    const me = await fetch("/api/me", { headers }).then((r) => r.json());
    const chat = await fetch("/api/chats/" + id, { headers });
    return { me, status: chat.status };
  }, config.chat);
  expect(privateChat.me.sub).toBe(config.person);
  expect(privateChat.me.owner).toBe(false);
  expect(privateChat.status).toBe(200);
  expect(privateChat.me.accountUrl).toBe(config.agent + "/oidc/account");
  // Shared sign-in grants only this person's existing administration permissions.
  await page.goto(config.agent + "/administration/");
  await page.getByRole("button", { name: "Use shared sign-in or a provider" }).click();
  await page.getByRole("button", { name: "Continue as Ada", exact: true }).click();
  await expect(page.getByText("Signed in as Ada", { exact: true })).toBeVisible();
  const namedToken = await page.evaluate(() =>
    sessionStorage.getItem("eugene-administration-token"),
  );
  expect(namedToken).toBeTruthy();
  const forbidden = await member.request.get(config.agent + "/api/proxy/control/v1/config", {
    headers: { Authorization: "Bearer " + namedToken },
  });
  expect(forbidden.status()).toBe(401);
  await page.screenshot({
    path: config.output + "/sso-administration-desktop.png",
    fullPage: true,
  });
  if (!config.resume) {
    await member.storageState({ path: statePath });
  } else {
    // A fresh browser after restart must use the persisted identity and decrypt the saved secret.
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.goto(config.agent + "/oidc/account");
    await freshPage.getByRole("button", { name: "Continue with Example SSO" }).click();
    await freshPage.getByRole("button", { name: "Sign in as Ada" }).click();
    await expect(
      freshPage.getByRole("heading", { name: "Your sign-in and sessions" }),
    ).toBeVisible();
    await expect(freshPage.getByText(/Signed in as/)).toContainText("Ada");
    await fresh.close();
    await ownerPage.getByRole("link", { name: "Manage Ada", exact: true }).click();
    await expect(ownerPage.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
    await ownerPage.screenshot({ path: config.output + "/sso-person-desktop.png", fullPage: true });
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerPage
      .getByRole("region", { name: "Sign-in and sessions", exact: true })
      .scrollIntoViewIfNeeded();
    expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await ownerPage.screenshot({ path: config.output + "/sso-person-mobile.png", fullPage: true });
    await ownerPage.getByRole("button", { name: "Disconnect", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(
      ownerPage.getByText("No external accounts connected.", { exact: true }),
    ).toBeVisible();
    const refused = await member.request.get(config.agent + "/api/proxy/control/v1/people", {
      headers: { Authorization: "Bearer " + namedToken },
    });
    expect(refused.status()).toBe(401);
    await page.goto(config.agent + "/oidc/account");
    await expect(page.getByRole("button", { name: "Continue as Ada", exact: true })).toHaveCount(0);
    // Password recovery remains usable after unlink, with the same stable account ID.
    await page.getByLabel("Your name", { exact: true }).fill("Ada");
    await page.getByLabel("Password", { exact: true }).fill(config.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your sign-in and sessions" })).toBeVisible();
    await page.getByRole("button", { name: "End all shared sign-ins" }).click();
    await expect(page.getByRole("heading", { name: "Signed out of Eugene" })).toBeVisible();
    writeFileSync(
      config.output + "/browser-result.json",
      JSON.stringify(
        {
          passed: true,
          providerSetup: true,
          explicitInvitation: true,
          stableAccountAndChat: true,
          sharedAdministration: true,
          noOwnerEscalation: true,
          restartPreserved: true,
          freshProviderLoginAfterRestart: true,
          unlinkRevokesAdministration: true,
          passwordRecovery: true,
          memberLogout: true,
          mobileNoOverflow: true,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  }
  expect(errors).toEqual([]);
  console.log(
    config.resume
      ? "PASS persisted SSO, revocation and local recovery"
      : "PASS provider setup, invitation, Workbench and shared administration",
  );
} finally {
  await browser.close();
}
