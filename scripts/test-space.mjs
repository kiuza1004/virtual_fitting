import { Client, handle_file } from "@gradio/client";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const TOKEN = env.HF_TOKEN;
const SPACE = env.HF_SPACE || "zhengchong/CatVTON";
const BLANK_MASK_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=";

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return await res.blob();
}

function blankMaskBlob() {
  return new Blob([new Uint8Array(Buffer.from(BLANK_MASK_PNG_B64, "base64"))], { type: "image/png" });
}

console.log("Connecting to", SPACE);
const client = await Client.connect(SPACE, TOKEN ? { token: TOKEN } : {});

console.log("Downloading sample inputs...");
const person = await fetchBlob("https://huggingface.co/spaces/yisol/IDM-VTON/resolve/main/example/human/00121_00.jpg");
const garment = await fetchBlob("https://huggingface.co/spaces/yisol/IDM-VTON/resolve/main/example/cloth/04469_00.jpg");

console.log("Calling /submit_function (cloth_type=upper, auto-mask)...");
const t0 = Date.now();
const result = await client.predict("/submit_function", [
  {
    background: handle_file(person),
    layers: [handle_file(blankMaskBlob())],
    composite: null,
  },
  handle_file(garment),
  "upper",
  50,
  2.5,
  42,
  "result only",
]);
console.log("Done in", Date.now() - t0, "ms");
const item = Array.isArray(result.data) ? result.data[0] : result.data;
console.log("Result URL:", item?.url);

if (item?.url) {
  const resultBlob = await fetchBlob(item.url);
  const buf = Buffer.from(await resultBlob.arrayBuffer());
  writeFileSync(resolve(__dirname, "result.png"), buf);
  console.log("Saved to scripts/result.png (", buf.length, "bytes )");
}
