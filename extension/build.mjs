import { build, context } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateIcons } from "./gen-icons.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const watch = process.argv.includes("--watch");

const esbuildOptions = {
  entryPoints: [
    path.join(SRC, "service_worker.ts"),
    path.join(SRC, "popup.ts"),
    path.join(SRC, "sidepanel.ts"),
  ],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: DIST,
  logLevel: "info",
  sourcemap: true,
};

async function copyStatic() {
  await fs.copyFile(path.join(ROOT, "manifest.json"), path.join(DIST, "manifest.json"));
  await fs.copyFile(path.join(SRC, "popup.html"), path.join(DIST, "popup.html"));
  await fs.copyFile(path.join(SRC, "sidepanel.html"), path.join(DIST, "sidepanel.html"));
  await generateIcons(path.join(DIST, "icons"));
}

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });

if (watch) {
  const ctx = await context({
    ...esbuildOptions,
    plugins: [
      {
        name: "copy-static",
        setup(b) {
          b.onEnd(async () => {
            await copyStatic();
            console.log("[build] static assets copied");
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log("[build] watching for changes...");
} else {
  await build(esbuildOptions);
  await copyStatic();
  console.log(`[build] complete -> ${path.relative(process.cwd(), DIST)}/`);
}
