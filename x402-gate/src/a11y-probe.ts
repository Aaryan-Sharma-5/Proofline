/**
 * Accessibility checks that a screenshot cannot make: heading order, visible
 * focus on every tab stop, reduced-motion behaviour, and labelled controls.
 */
import { chromium, type Page } from "playwright";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";

async function headings(page: Page) {
  return page.$$eval("h1,h2,h3", (nodes) =>
    nodes.map((n) => `${n.tagName} ${n.textContent?.trim().slice(0, 48)}`),
  );
}

/**
 * Coarse sweep over every focusable element.
 *
 * Caveat: this uses programmatic .focus(), which does NOT match :focus-visible,
 * so elements styled only via :focus-visible can be reported as missing a ring
 * when a keyboard user would in fact see one. Treat a MISS here as a lead to
 * confirm with focus-probe.ts, which presses real Tab keys, not as a defect.
 */
async function focusRing(page: Page): Promise<{ total: number; missing: string[] }> {
  return page.evaluate(() => {
    const stops = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      ),
    );
    const missing: string[] = [];
    for (const el of stops) {
      el.focus();
      const style = getComputedStyle(el);
      const hasOutline =
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
      const hasShadow = style.boxShadow !== "none";
      if (!hasOutline && !hasShadow) {
        missing.push(
          `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent ?? "").trim().slice(0, 28)}"`,
        );
      }
    }
    return { total: stops.length, missing: missing.slice(0, 10) };
  });
}

async function unlabelledControls(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("input, select, textarea"),
    )) {
      const id = el.id;
      const labelled =
        (id && document.querySelector(`label[for="${id}"]`)) ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.closest("label");
      if (!labelled) out.push(`${el.tagName.toLowerCase()}#${id || "(no id)"}`);
    }
    return out;
  });
}

const browser = await chromium.launch();

for (const path of ["/app", "/history", "/"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${GATEWAY}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const hs = await headings(page);
  const h1Count = hs.filter((h) => h.startsWith("H1")).length;
  const focus = await focusRing(page);
  const unlabelled = await unlabelledControls(page);

  console.log(`\n=== ${path} ===`);
  console.log(`  h1 count        : ${h1Count}`);
  console.log(`  heading order   : ${hs.slice(0, 8).join(" | ")}`);
  console.log(`  tab stops       : ${focus.total}`);
  console.log(
    `  focus (coarse)  : ${focus.missing.length === 0 ? "all stops ringed" : `${focus.missing.length} to confirm with focus-probe.ts (:focus-visible)`}`,
  );
  console.log(
    `  unlabelled ctrl : ${unlabelled.length === 0 ? "none" : unlabelled.join(", ")}`,
  );
  await page.close();
}

// Reduced motion: content must be fully visible without depending on animation.
const reduced = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
await reduced.goto(`${GATEWAY}/`, { waitUntil: "networkidle" });
await reduced.waitForTimeout(200);
const opacity = await reduced.$eval("figure", (el) => getComputedStyle(el).opacity);
console.log(`\nreduced-motion hero opacity: ${opacity}`);
await reduced.close();

await browser.close();
