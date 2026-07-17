import { createRequire } from "node:module";
import http from "node:http";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>probe</body></html>");
});
await new Promise((r) => server.listen(4999, "127.0.0.1", r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("http://localhost:4999/");
const out = await page.evaluate(async () => {
  const r = {
    isSecureContext,
    VideoDecoder: typeof VideoDecoder !== "undefined",
    VideoEncoder: typeof VideoEncoder !== "undefined",
    OffscreenCanvas: typeof OffscreenCanvas !== "undefined",
    opfs: typeof navigator.storage?.getDirectory === "function",
  };
  if (r.VideoDecoder) {
    for (const [k, cfg] of [
      ["h264", { codec: "avc1.42001E", codedWidth: 320, codedHeight: 240 }],
      ["vp8", { codec: "vp8", codedWidth: 320, codedHeight: 240 }],
      ["vp9", { codec: "vp09.00.10.08", codedWidth: 320, codedHeight: 240 }],
    ]) {
      try { r[k] = (await VideoDecoder.isConfigSupported(cfg)).supported; }
      catch (e) { r[k] = "throw:" + e.message; }
    }
  }
  if (r.VideoEncoder) {
    try {
      r.h264enc = (await VideoEncoder.isConfigSupported({ codec: "avc1.42001E", width: 320, height: 240, avc: { format: "avc" } })).supported;
    } catch (e) { r.h264enc = "throw:" + e.message; }
  }
  r.mp4rec = MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01E");
  r.webmrec = MediaRecorder.isTypeSupported("video/webm;codecs=vp8");
  return r;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
