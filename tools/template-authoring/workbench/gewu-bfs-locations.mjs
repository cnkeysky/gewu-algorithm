import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/");
await page.waitForTimeout(800);
const home = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("strong, option, span, p, b")) {
    if ((el.textContent ?? "").includes("bfs")) out.push(`TEXT ${el.tagName}: ${el.textContent.trim().slice(0, 60)}`);
    for (const attr of ["value", "data-unit-id", "class", "id"]) {
      const v = el.getAttribute(attr);
      if (v && v.includes("bfs")) out.push(`ATTR ${el.tagName}[${attr}]: ${v.slice(0, 50)}`);
    }
  }
  return out.slice(0, 12);
});
console.log("HOME_BFS=" + JSON.stringify(home, null, 1));
await page.getByRole("button", { name: "Practice", exact: true }).click();
await page.waitForTimeout(600);
await page.locator("#practice-unit").selectOption("graph.bfs");
await page.locator("#practice-mode").selectOption("code_recall");
await page.waitForTimeout(400);
const practice = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("option, span, p, b, small")) {
    if ((el.textContent ?? "").includes("bfs")) out.push(`TEXT ${el.tagName}: ${el.textContent.trim().slice(0, 70)}`);
  }
  for (const el of document.querySelectorAll("option")) {
    const v = el.getAttribute("value");
    if (v && v.includes("bfs")) out.push(`VALUE option: ${v}`);
  }
  return out.slice(0, 15);
});
console.log("PRACTICE_BFS=" + JSON.stringify(practice, null, 1));
await browser.close();
