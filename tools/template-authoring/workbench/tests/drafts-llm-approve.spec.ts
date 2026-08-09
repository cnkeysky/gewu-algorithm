import { expect, test } from "playwright/test";

function draft(title: string, status: string, index: number, artifactPath?: string) {
  return {
    id: `draft-${index}`,
    title,
    problem: "Given an array of integers and a target, return the indices of the two numbers that add up to target.",
    provider: "relay",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 0,
    modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    assistance: ["comments", "cloze"],
    status,
    createdAt: new Date(Date.UTC(2026, 7, 8, 8, 30, index)).toISOString(),
    ...(artifactPath ? { artifactPath } : {}),
  };
}

async function openDrafts(page: import("playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Drafts/ }).click();
}

test("LLM approve appears only on gate-eligible states", async ({ page }) => {
  const drafts = [
    draft("Ready validated", "validated", 0, "artifacts/0"),
    draft("Ready needs revision", "needs_revision", 1, "artifacts/1"),
    draft("Ready llm reviewed", "llm_reviewed", 2, "artifacts/2"),
    draft("Already accepted", "accepted", 3, "artifacts/3"),
    draft("Still generated", "generated", 4, "artifacts/4"),
  ];
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  await openDrafts(page);

  await expect(page.locator("[data-llm-approve-id]")).toHaveCount(3);
  const acceptedRow = page.locator(".draft-row", { hasText: "Already accepted" });
  await expect(acceptedRow.locator("[data-llm-approve-id]")).toHaveCount(0);
  const generatedRow = page.locator(".draft-row", { hasText: "Still generated" });
  await expect(generatedRow.locator("[data-llm-approve-id]")).toHaveCount(0);
});

test("LLM approve gate: needs_revision verdict notifies, pass publishes with the label", async ({ page }) => {
  const draftRecord = draft("Gate draft", "validated", 0, "artifacts/0");
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts: [draftRecord] } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  let acceptCalled = false;
  await page.route("**/api/drafts/draft-0/acceptance", async (route) => {
    if (acceptCalled) {
      await route.fulfill({ json: { verdict: "pass", rationale: "gate verified" } });
    } else {
      acceptCalled = true;
      await route.fulfill({ json: { verdict: "needs_revision", rationale: "transfer items change the bound" } });
    }
  });
  await page.route("**/api/drafts/draft-0/accept", async (route) => {
    const body = route.request().postDataJSON() as { acceptanceRole?: string };
    expect(body.acceptanceRole).toBe("llm_acceptance");
    await route.fulfill({ json: { status: "accepted" } });
  });
  await openDrafts(page);

  const button = page.locator("[data-llm-approve-id]");
  await button.click();
  await expect(page.locator("#app-toast")).toContainText("LLM approval needs revision");

  await button.click();
  await expect(page.locator("#app-toast")).toContainText("published as LLM approved");
  await expect(acceptCalled).toBe(true);
});
