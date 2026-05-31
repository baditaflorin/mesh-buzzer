import { expect, test, type Browser, type Page } from "@playwright/test";
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

/**
 * Open two peers where peer B's *local* `Date.now()` is skewed +50s before any
 * app code runs — a realistic case of two players whose wall clocks disagree.
 * y-webrtc's BroadcastChannel still syncs them; the mesh clock must neutralise
 * the skew so whoever physically buzzes first wins on BOTH screens.
 */
async function openTwoSkewedPeers(
  browser: Browser,
  url: string,
  skewMs: number,
): Promise<{ a: Page; b: Page; cleanup: () => Promise<void> }> {
  const roomId = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const context = await browser.newContext({ baseURL: url || undefined });
  await context.addInitScript(
    ({ prefix, room }) => {
      localStorage.setItem(`${prefix}:room`, room);
      localStorage.setItem(`${prefix}:signalingUrl`, "ws://localhost:1/never-connects");
      localStorage.removeItem(`${prefix}:iceServers`);
    },
    { prefix: storagePrefix, room: roomId },
  );
  const a = await context.newPage();
  const b = await context.newPage();
  // Skew only peer B, before its app bundle loads.
  await b.addInitScript((skew) => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + skew;
  }, skewMs);
  await Promise.all([a.goto(url), b.goto(url)]);
  return { a, b, cleanup: () => context.close() };
}

test("mesh clock arbitrates first-buzzer even when peers' local clocks disagree by 50s — both screens agree on the SAME, CORRECT winner", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoSkewedPeers(browser, baseURL ?? "", 50_000);
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");

    // Let clockSync exchange a few awareness ping rounds (1.5s interval).
    await a.waitForTimeout(4_000);

    // Alice arms the round.
    await a.getByRole("button", { name: /ARM/i }).click();
    await expect(b.getByRole("button", { name: /BUZZ/i })).toBeVisible();

    // Alice physically buzzes FIRST; Bob (the +50s-skewed peer) ~600ms later.
    await a.getByRole("button", { name: /BUZZ/i }).click();
    await a.waitForTimeout(600);
    await b.getByRole("button", { name: /BUZZ/i }).click();

    // Both peers must converge on the full two-row leaderboard.
    await expect(a.locator(".buzz-list li")).toHaveCount(2);
    await expect(b.locator(".buzz-list li")).toHaveCount(2);

    const orderOf = async (p: Page) =>
      (await p.locator(".buzz-list li span:first-child").allInnerTexts()).map((t) =>
        t.replace(/^\d+\.\s*/, "").trim(),
      );
    const aOrder = await orderOf(a);
    const bOrder = await orderOf(b);

    // Load-bearing assertion #1: BOTH screens agree on the ordering.
    expect(aOrder).toEqual(bOrder);

    // Load-bearing assertion #2: the ordering is the CORRECT one — Alice
    // physically buzzed first, so she must be ranked #1 on both screens.
    // Under the old per-peer `meshNow() - armedAt` code the +50s-skewed Bob
    // floored to +0ms and wrongly won; this asserts the mesh clock fixed it.
    expect(aOrder[0]).toBe("alice");
    expect(aOrder[1]).toBe("bob");

    // And the winner banner agrees on both peers.
    await expect(a.locator(".buzz-winner")).toContainText("alice");
    await expect(b.locator(".buzz-winner")).toContainText("alice");

    // Sanity: the recorded reaction times are plausible (not ±50s garbage).
    const aMs = (await a.locator(".buzz-list .buzz-ms").allInnerTexts()).map((t) =>
      Number(t.replace(/[^\d-]/g, "")),
    );
    expect(aMs[0]).toBeLessThan(aMs[1]!); // first row is faster
    expect(aMs[1]).toBeLessThan(10_000); // not corrupted by the 50s skew
  } finally {
    await cleanup();
  }
});
