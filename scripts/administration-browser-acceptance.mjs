// Real APIs through the agent proxy, with production export or Next development UI.
// No route interception or synthetic responses. The Python harness owns servers.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  expect(new URL(config.url).hostname).toBe("127.0.0.1");
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const rootHeaders = { Authorization: "Bearer " + config.owner };
  let archonas;
  for (const name of ["Archonas", ...Array.from({ length: 25 }, (_, i) => `Member ${i + 1}`)]) {
    const made = await ownerContext.request.post(config.control + "/v1/people", {
      headers: rootHeaders,
      data: { name, password: config.password },
    });
    expect(made.status()).toBe(201);
    if (name === "Archonas") archonas = await made.json();
  }
  const ownerLogin = await ownerContext.request.post(config.agent + "/v1/auth/login", {
    data: { passphrase: config.password },
  });
  expect(ownerLogin.status()).toBe(200);
  const ownerToken = (await ownerLogin.json()).sessionToken;
  await ownerContext.addInitScript(
    (token) => sessionStorage.setItem("eugene-session-token", token),
    ownerToken,
  );
  const ownerPage = await ownerContext.newPage();
  const ownerErrors = [];
  ownerPage.on("pageerror", (error) => ownerErrors.push(error.message));
  await ownerPage.goto(config.url + "/people/");
  await expect(
    ownerPage.getByTestId("resource-tree").getByRole("link", { name: "People", exact: true }),
  ).toBeVisible();
  await expect(ownerPage.getByRole("table").getByRole("link")).toHaveCount(10);
  await expect(ownerPage.getByRole("region", { name: "Administration permissions" })).toHaveCount(
    0,
  );
  await ownerPage.screenshot({
    path: config.output + "/people-directory-desktop.png",
    fullPage: true,
  });
  await ownerPage.getByRole("button", { name: "Next", exact: true }).click();
  await expect(ownerPage.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await ownerPage.getByRole("table").getByRole("link").first().click();
  await expect(ownerPage.getByRole("region", { name: "Person details" })).toBeVisible();
  await ownerPage.goBack();
  await expect(ownerPage.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await ownerPage.getByRole("searchbox").fill("Archonas");
  await ownerPage.getByRole("link", { name: "Manage Archonas", exact: true }).click();
  for (const name of [
    "Account details",
    "Groups and app access",
    "Administration permissions",
    "Account actions",
  ]) {
    await expect(ownerPage.getByRole("region", { name })).toBeVisible();
  }
  await expect(ownerPage.getByLabel("Email for Archonas", { exact: true })).toBeVisible();
  await expect(
    ownerPage.getByRole("radio", { name: "Individual access", exact: true }),
  ).toBeVisible();
  await expect(ownerPage.getByRole("checkbox", { name: /Every app/ })).toBeVisible();
  await expect(ownerPage.getByRole("checkbox", { name: /Follow the install/ })).toBeVisible();
  await expect(ownerPage.getByRole("article").locator("details input, details button")).toHaveCount(
    0,
  );
  await expect(ownerPage.getByText(/Grant only what/)).toHaveText(
    "Grant only what Archonas needs. These permissions do not open machine controls or anyone else’s private chats.",
  );
  await ownerPage.getByRole("checkbox", { name: /^Manage accounts/ }).check();
  await ownerPage.getByRole("button", { name: "Save administration access", exact: true }).click();
  await expect(ownerPage.getByText("Administration access saved.")).toBeVisible();
  await ownerPage.reload();
  await expect(ownerPage.getByRole("heading", { name: "Archonas", exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("checkbox", { name: /^Manage accounts/ })).toBeChecked();
  const persisted = await ownerContext.request.get(config.control + "/v1/people", {
    headers: rootHeaders,
  });
  expect(
    (await persisted.json()).people.find((person) => person.id === archonas.id).administration
      .managePeople,
  ).toBe(true);
  await ownerPage.setViewportSize({ width: 1440, height: 1600 });
  await ownerPage.getByRole("heading", { name: "Archonas", exact: true }).scrollIntoViewIfNeeded();
  await ownerPage.screenshot({
    path: config.output + "/people-detail-desktop.png",
    fullPage: true,
  });
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await ownerPage.screenshot({ path: config.output + "/people-detail-mobile.png", fullPage: true });
  const actions = ownerPage.getByRole("region", { name: "Account actions" });
  await actions.getByLabel("New password for Archonas").fill(config.password);
  await actions.getByRole("button", { name: "Set password", exact: true }).click();
  await expect(actions.getByText("Password updated.")).toBeVisible();
  await expect(actions.getByLabel("New password for Archonas")).toHaveValue("");
  await expect(actions.getByRole("button", { name: "Delete Archonas", exact: true })).toBeVisible();
  await ownerPage.screenshot({
    path: config.output + "/people-actions-mobile.png",
    fullPage: true,
  });
  await ownerPage.setViewportSize({ width: 1440, height: 1000 });
  await actions.scrollIntoViewIfNeeded();
  await ownerPage.screenshot({
    path: config.output + "/people-actions-desktop.png",
    fullPage: true,
  });
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.getByRole("button", { name: /Back to people/ }).click();
  await expect(ownerPage.getByRole("table").getByRole("link")).toHaveCount(10);
  await expect
    .poll(() => ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await ownerPage.screenshot({
    path: config.output + "/people-directory-mobile.png",
    fullPage: true,
  });
  expect(ownerErrors).toEqual([]);
  await ownerContext.close();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(config.url + "/administration/");
  await page.getByLabel("Account name").fill("Manager");
  await page.getByLabel("Password", { exact: true }).fill(config.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Signed in as Manager")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add group" })).toHaveCount(0);
  await page.getByText("Add a person", { exact: true }).click();
  await page.getByLabel("Account name").fill("New member");
  await page.getByLabel("First password").fill(config.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText("Account created. Find and select the person below to assign group access."),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("New member");
  await page.getByRole("link", { name: "Manage New member", exact: true }).click();
  const member = page.getByRole("region", { name: "Person details" }).getByRole("article");
  await expect(
    member.getByRole("region", { name: "Account details" }).getByLabel("Display name"),
  ).toBeVisible();
  await expect(
    member
      .getByRole("region", { name: "Account actions" })
      .getByRole("button", { name: "Disable account" }),
  ).toBeVisible();
  await expect(member.getByRole("region", { name: "Administration permissions" })).toHaveCount(0);
  await expect(member.getByLabel("New password for New member")).toHaveCount(0);
  await expect(member.locator("details")).toHaveCount(0);
  await member.getByLabel("Builders", { exact: true }).check();
  await member.getByRole("button", { name: "Save memberships" }).click();
  await expect(member.getByText("Groups: Builders", { exact: true })).toBeVisible();
  await expect(member.getByText("Apps: Workbench", { exact: true })).toBeVisible();
  await page.screenshot({ path: config.output + "/administration-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: config.output + "/administration-mobile.png", fullPage: true });
  await page.reload();
  await expect(page.getByText("Signed in as Manager")).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem("eugene-administration-token"));
  const headers = { Authorization: "Bearer " + token };
  // Real root refuses APIs that the UI never presents.
  const forbidden = await context.request.get(config.agent + "/api/proxy/control/v1/config", {
    headers,
  });
  expect(forbidden.status()).toBe(401);
  const reset = await context.request.put(
    config.agent + `/api/proxy/control/v1/people/${config.person}/password`,
    { headers, data: { password: config.password } },
  );
  expect(reset.status()).toBe(401);
  const removed = await context.request.put(
    config.control + `/v1/people/${config.manager}/administration`,
    { headers: { Authorization: "Bearer " + config.owner }, data: {} },
  );
  expect(removed.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Administrator sign-in" })).toBeVisible();
  expect(errors).toEqual([]);
  writeFileSync(
    config.output + "/browser-result.json",
    JSON.stringify(
      {
        passed: true,
        mobileFits: true,
        pageErrors: [...ownerErrors, ...errors],
        revokedSessionRefused: true,
        pagination: true,
        browserBack: true,
        deepLinkReload: true,
        realPermissionSave: true,
        nameSpacing: true,
        peopleTreeEntry: true,
        visiblePermissionSections: true,
        separateAccountActions: true,
        passwordReset: true,
        delegatedControlsLimited: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS Chrome named sign-in, account creation, scoped assignment, reload, mobile and immediate revocation",
  );
} finally {
  await browser.close();
}
