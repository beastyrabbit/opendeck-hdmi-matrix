import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

import { DEFAULT_CONFIG } from "../src/config.js";
import { createProfile } from "./profile.js";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const plugin = resolve(dist, "de.beasty.hdmi-matrix.sdPlugin");
const imageMagick = findImageMagick();

await rm(dist, { force: true, recursive: true });
await mkdir(resolve(plugin, "bin"), { recursive: true });
await mkdir(resolve(plugin, "icons"), { recursive: true });
await mkdir(resolve(plugin, "opendeck"), { recursive: true });
await mkdir(resolve(plugin, "property-inspector"), { recursive: true });

await build({
	bundle: true,
	entryPoints: [resolve(root, "src/plugin.ts")],
	format: "cjs",
	logLevel: "info",
	minify: false,
	outfile: resolve(plugin, "bin/plugin.cjs"),
	platform: "node",
	sourcemap: true,
	target: "node20",
});

await cp(resolve(root, "plugin/manifest.json"), resolve(plugin, "manifest.json"));
await cp(resolve(root, "plugin/icons"), resolve(plugin, "icons"), { recursive: true });
await cp(resolve(root, "plugin/property-inspector"), resolve(plugin, "property-inspector"), { recursive: true });
await writeFile(resolve(plugin, "config.json"), `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
await writeFile(resolve(plugin, "opendeck/HDMI Matrix.json"), `${JSON.stringify(createProfile(), null, 2)}\n`);

for (const icon of ["plugin", "launcher", "panel", "back"]) {
	execFileSync(imageMagick, [resolve(plugin, `icons/${icon}.svg`), resolve(plugin, `icons/${icon}.png`)]);
	execFileSync(imageMagick, [
		resolve(plugin, `icons/${icon}.svg`),
		"-resize",
		"288x288",
		resolve(plugin, `icons/${icon}@2x.png`),
	]);
	await rm(resolve(plugin, `icons/${icon}.svg`));
}

await build({
	bundle: true,
	entryPoints: [resolve(root, "scripts/setup-opendeck.ts")],
	format: "esm",
	minify: false,
	outfile: resolve(plugin, "setup-opendeck.mjs"),
	platform: "node",
	target: "node20",
});
await cp(resolve(plugin, "setup-opendeck.mjs"), resolve(dist, "setup-opendeck.mjs"));

execFileSync(
	"pnpm",
	[
		"exec",
		"streamdeck",
		"pack",
		plugin,
		"--force",
		"--no-update-check",
		"--no-file-list",
		"--ignore-validation",
		"--output",
		dist,
	],
	{ cwd: root, stdio: "inherit" },
);

const manifest = JSON.parse(await readFile(resolve(plugin, "manifest.json"), "utf8")) as { Version: string };
console.log(`Built HDMI Matrix ${manifest.Version} in ${dist}`);

function findImageMagick(): "convert" | "magick" {
	for (const command of ["magick", "convert"] as const) {
		try {
			execFileSync(command, ["-version"], { stdio: "ignore" });
			return command;
		} catch {
			// Try the next ImageMagick command name.
		}
	}
	throw new Error("ImageMagick is required. Install either the magick or convert command.");
}
