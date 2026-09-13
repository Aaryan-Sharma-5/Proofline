/**
 * Real keyboard focus check: presses Tab, which triggers :focus-visible the way
 * a keyboard user does. Programmatic .focus() does not, so a probe that uses it
 * can report a false failure.
 */
import { chromium } from "playwright";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const PATH = process.env.PROBE_PATH?.trim() ?? "/history";
const WIDTH = Number(process.env.PROBE_WIDTH?.trim() ?? "375");
const STEPS = Number(process.env.PROBE_STEPS?.trim() ?? "14");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 } });
await page.goto(`${GATEWAY}${PATH}`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

console.log(`tabbing ${STEPS} stops on ${PATH} at ${WIDTH}px:`);
let missing = 0;

for (let i = 0; i < STEPS; i++) {
  await page.keyboard.press("Tab");
  const info = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const outline =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
    const shadow = style.boxShadow !== "none";
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id,
      text: (el.textContent ?? "").trim().slice(0, 34).replace(/\s+/g, " "),
      outline,
      shadow,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });

  if (!info) {
    console.log(`  ${String(i + 1).padStart(2)}. (body)`);
    continue;
  }

  const ok = info.outline || info.shadow;
  if (!ok) missing++;
  console.log(
    `  ${String(i + 1).padStart(2)}. ${ok ? "OK  " : "MISS"} ${info.tag}${info.id ? "#" + info.id : ""} "${info.text}" outline=${info.outlineWidth} ${info.outlineColor}`,
  );
}

console.log(`\nstops without a visible focus indicator: ${missing}`);
await browser.close();
