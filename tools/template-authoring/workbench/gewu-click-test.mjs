import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/");
await page.getByRole("button", { name: /^Drafts/ }).click();
await page.waitForTimeout(500);
await page.locator("[data-view-artifact-id]").first().click();
await page.waitForTimeout(500);
const view = await page.evaluate(() => [...document.querySelectorAll(".app-view")].find((v) => !v.hidden)?.id);
console.log("VIEW_AFTER_OPEN=" + view);
const inspectorVisible = await page.locator("#artifact-inspector").isVisible();
console.log("INSPECTOR_VISIBLE=" + inspectorVisible);
if (inspectorVisible) {
  await page.locator("#artifact-manifest").click({ position: { x: 30, y: 30 } });
  await page.locator("#artifact-files .artifact-editor").first().click({ position: { x: 30, y: 30 } });
  await page.waitForTimeout(300);
  const view2 = await page.evaluate(() => [...document.querySelectorAll(".app-view")].find((v) => !v.hidden)?.id);
  console.log("VIEW_AFTER_TEXTAREA_CLICK=" + view2);
}
await browser.close();
