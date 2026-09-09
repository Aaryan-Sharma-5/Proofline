import "./env.js";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const id = process.argv[2];

if (!id) {
  console.error("usage: tsx src/watch-events.ts <correlation-id>");
  process.exit(2);
}

const started = Date.now();
const stamp = () => `+${((Date.now() - started) / 1000).toFixed(3)}s`;

const response = await fetch(`${GATEWAY}/verification/${id}/events`, {
  headers: { accept: "text/event-stream" },
});

console.log(`${stamp()}  connected: HTTP ${response.status}`);
console.log(`${stamp()}  content-type: ${response.headers.get("content-type")}`);
console.log(`${stamp()}  cache-control: ${response.headers.get("cache-control")}`);
console.log(
  `${stamp()}  x-accel-buffering: ${response.headers.get("x-accel-buffering")}`,
);
console.log(
  `${stamp()}  content-length: ${response.headers.get("content-length") ?? "(absent, streaming)"}`,
);
console.log(
  `${stamp()}  content-encoding: ${response.headers.get("content-encoding") ?? "(none)"}`,
);
console.log("");

if (!response.body) {
  console.error("no response body");
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let chunkCount = 0;
const arrivals: number[] = [];

// Read raw chunks so the moment bytes hit the socket is observable, rather than waiting for a parsed event or for the stream to end.
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;

  chunkCount += 1;
  arrivals.push(Date.now() - started);
  buffer += decoder.decode(value, { stream: true });

  // Frames are separated by a blank line.
  let split: number;
  while ((split = buffer.indexOf("\n\n")) !== -1) {
    const frame = buffer.slice(0, split);
    buffer = buffer.slice(split + 2);

    const lines = frame.split("\n");
    let eventName = "message";
    let data = "";
    let comment = "";

    for (const line of lines) {
      if (line.startsWith(":")) comment = line.slice(1).trim();
      else if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
      else if (line.startsWith("retry:")) comment = `retry ${line.slice(6).trim()}ms`;
    }

    if (comment && !data) {
      console.log(`${stamp()}  · ${comment}`);
      continue;
    }
    if (!data) continue;

    let parsed: Record<string, any> = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      /* keep raw */
    }

    const detail = parsed.detail ? JSON.stringify(parsed.detail) : "";
    console.log(
      `${stamp()}  ${eventName.padEnd(16)} ${detail}`.trimEnd(),
    );

    if (eventName === "done") {
      console.log("");
      summarize();
      process.exit(0);
    }
  }
}

console.log("");
summarize();

function summarize(): void {
  const total = (Date.now() - started) / 1000;
  const spread =
    arrivals.length > 1
      ? (arrivals[arrivals.length - 1]! - arrivals[0]!) / 1000
      : 0;

  console.log(`stream closed after ${total.toFixed(3)}s`);
  console.log(`network chunks received: ${chunkCount}`);
  console.log(
    `first chunk at +${(arrivals[0]! / 1000).toFixed(3)}s, ` +
      `last at +${(arrivals[arrivals.length - 1]! / 1000).toFixed(3)}s ` +
      `(spread ${spread.toFixed(3)}s)`,
  );

  // The actual verdict. If every chunk landed at once, the response was buffered somewhere between here and the emitter, which is the Section 11 trap.
  if (chunkCount > 1 && spread > 0.05) {
    console.log("VERDICT: incremental delivery confirmed, not buffered.");
  } else if (chunkCount <= 1) {
    console.log(
      "VERDICT: BUFFERED. Everything arrived in a single chunk, so the stream was held and released at once.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      "VERDICT: SUSPICIOUS. Chunks arrived within 50ms of each other; the run may have been too fast to distinguish buffering.",
    );
  }
}
