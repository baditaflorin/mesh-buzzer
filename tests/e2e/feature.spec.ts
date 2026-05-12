import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("arming on A shows the buzz button on B; B's buzz appears on A's leaderboard", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");

    // Alice arms the round
    await a.getByRole("button", { name: /ARM/i }).click();

    // Bob's screen now shows BUZZ; click it
    await expect(b.getByRole("button", { name: /BUZZ/i })).toBeVisible();
    await b.getByRole("button", { name: /BUZZ/i }).click();

    // Alice sees bob on her leaderboard
    await expect(a.locator(".buzz-list").getByText("bob")).toBeVisible();
  } finally {
    await cleanup();
  }
});
