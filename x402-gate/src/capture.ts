import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { chromium, type Page } from "playwright";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const OUT = resolve("../screenshots");
mkdirSync(OUT, { recursive: true });

const started = Date.now();
const stamp = () => `+${((Date.now() - started) / 1000).toFixed(2)}s`;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
  console.log(`${stamp()}  captured ${name}.png`);
}

async function timelineState(page: Page): Promise<string[]> {
  return page.$$eval("ol.timeline li", (items) =>
    items.map((li) => {
      const name = li.querySelector(".stage-name")?.textContent?.trim() ?? "";
      const time = li.querySelector(".stage-time")?.textContent?.trim() ?? "";
      const cls = li.className || "pending";
      return `${cls.padEnd(7)} ${name}${time ? `  ${time}` : ""}`;
    }),
  );
}

async function runCase(
  page: Page,
  label: string,
  trigger: () => Promise<void>,
): Promise<void> {
  console.log(`\n=== ${label} ===`);
  await page.goto(GATEWAY, { waitUntil: "domcontentloaded" });
  await shot(page, `${label}-1-idle`);

  await trigger();

  // Catch the stream mid-flight. ANALYZING is the long stage (real OCR), so this reliably lands while work is genuinely in progress.
  try {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("ol.timeline li")).some(
          (li) =>
            li.className.includes("done") &&
            li.querySelector(".stage-name")?.textContent?.includes("Analyzing"),
        ),
      { timeout: 30000 },
    );
    console.log(`${stamp()}  ANALYZING reached, capturing live timeline`);
    const mid = await timelineState(page);
    console.log("  timeline mid-run:");
    for (const row of mid) console.log(`    ${row}`);
    await shot(page, `${label}-2-live`);
  } catch {
    console.log(`${stamp()}  did not observe ANALYZING mid-flight`);
  }

  // Result panel appearing is the completion signal.
  await page.waitForSelector("#panel-result:not(.hidden)", { timeout: 120000 });
  await page.waitForTimeout(400);

  const final = await timelineState(page);
  console.log("  timeline final:");
  for (const row of final) console.log(`    ${row}`);

  const result = await page.evaluate(() => ({
    decision: document.querySelector("#decision")?.textContent?.trim(),
    note: document.querySelector("#decision-note")?.textContent?.trim(),
    evidence: Array.from(document.querySelectorAll("#evidence li")).map((li) => ({
      code: li.querySelector(".code")?.textContent?.trim() ?? "(none)",
      level: li.querySelector(".level")?.textContent?.trim() ?? "",
      explain: li.querySelector(".explain")?.textContent?.trim() ?? "",
    })),
    agent: document.querySelector("#agent")?.textContent?.trim(),
    proof: document.querySelector("#proof")?.textContent?.trim(),
    hashscan: document.querySelector("a.hashscan")?.getAttribute("href"),
  }));

  console.log("  result:");
  console.log(`    decision : ${result.decision}`);
  console.log(`    note     : ${result.note}`);
  for (const e of result.evidence) {
    console.log(`    evidence : ${e.code} ${e.level}`);
    console.log(`               ${e.explain}`);
  }
  console.log(`    agent    : ${result.agent?.replace(/\s+/g, " ")}`);
  console.log(`    hashscan : ${result.hashscan ?? "(none)"}`);

  const body = (await page.textContent("body")) ?? "";
  const scoreLeak = /policy[_ ]score|confidence|probability|\b\d{1,3}\s*%/i.exec(body);
  console.log(
    `    score/confidence visible: ${scoreLeak ? `YES -> ${scoreLeak[0]}` : "no"}`,
  );

  await shot(page, `${label}-3-result`);
  writeFileSync(
    resolve(OUT, `${label}.json`),
    JSON.stringify({ timeline: final, result }, null, 2),
  );
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });

page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`  [browser error] ${msg.text()}`);
});

await runCase(page, "clear-sample", async () => {
  await page.click("#btn-clear");
});

await runCase(page, "review-sample", async () => {
  await page.click("#btn-review");
});

await runCase(page, "upload-valid", async () => {
  await page.setInputFiles("#file", resolve("../backend/test_docs/02_altered_total.pdf"));
});

await runCase(page, "upload-malformed", async () => {
  await page.setInputFiles("#file", {
    name: "not-a-document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      "This is plain text pretending to be a PDF. There is no %PDF header, no xref table, and nothing for the engine to extract.",
      "utf8",
    ),
  });
});

await browser.close();
console.log(`\nscreenshots written to ${OUT}`);
