import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { build } from "esbuild";

import { DEFAULT_CONFIG } from "../src/config.js";
import { createProfile } from "./profile.js";
import { verifyPackage } from "./verify-package.js";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const sourceManifestPath = resolve(root, "plugin/manifest.json");
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8")) as {
	UUID: string;
	Version: string;
};
const plugin = resolve(dist, `${sourceManifest.UUID}.sdPlugin`);
const archive = resolve(dist, `${sourceManifest.UUID}.streamDeckPlugin`);

if (!/^\d+\.\d+\.\d+$/.test(sourceManifest.Version)) {
	throw new Error(`Source manifest Version must be major.minor.patch, got ${sourceManifest.Version}`);
}

await rm(dist, { force: true, recursive: true });
await mkdir(resolve(plugin, "bin"), { recursive: true });
await mkdir(resolve(plugin, "icons"), { recursive: true });
await mkdir(resolve(plugin, "opendeck"), { recursive: true });
await mkdir(resolve(plugin, "property-inspector"), { recursive: true });

await build({
	bundle: true,
	entryPoints: [resolve(root, "src/plugin.ts")],
	format: "cjs",
	legalComments: "none",
	logLevel: "info",
	minify: false,
	outfile: resolve(plugin, "bin/plugin.cjs"),
	platform: "node",
	target: "node20",
});

const packagedManifest = {
	...JSON.parse(await readFile(sourceManifestPath, "utf8")),
	Version: `${sourceManifest.Version}.0`,
};
await writeFile(resolve(plugin, "manifest.json"), `${JSON.stringify(packagedManifest, null, 2)}\n`);
await cp(resolve(root, "plugin/property-inspector"), resolve(plugin, "property-inspector"), { recursive: true });
await cp(resolve(root, "LICENSE"), resolve(plugin, "LICENSE"));
await cp(resolve(root, "THIRD_PARTY_NOTICES.md"), resolve(plugin, "THIRD_PARTY_NOTICES.md"));
await writeFile(resolve(plugin, "config.json"), `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
await writeFile(resolve(plugin, "opendeck/HDMI Matrix.json"), `${JSON.stringify(createProfile(), null, 2)}\n`);

for (const icon of ["back", "launcher", "panel", "plugin"]) {
	const svg = await readFile(resolve(root, `plugin/icons/${icon}.svg`));
	await renderIcon(svg, 144, resolve(plugin, `icons/${icon}.png`));
	await renderIcon(svg, 288, resolve(plugin, `icons/${icon}@2x.png`));
}

await build({
	bundle: true,
	entryPoints: [resolve(root, "scripts/setup-opendeck.ts")],
	format: "esm",
	legalComments: "none",
	minify: false,
	outfile: resolve(plugin, "setup-opendeck.mjs"),
	platform: "node",
	target: "node20",
});
await cp(resolve(plugin, "setup-opendeck.mjs"), resolve(dist, "setup-opendeck.mjs"));

await createReproducibleArchive(plugin, archive, `${sourceManifest.UUID}.sdPlugin`);
await verifyPackage({ archive, plugin, root });

console.log(`Built HDMI Matrix ${sourceManifest.Version} in ${dist}`);

async function renderIcon(svg: Uint8Array, width: number, output: string): Promise<void> {
	const image = new Resvg(Buffer.from(svg), {
		fitTo: {
			mode: "width",
			value: width,
		},
	});
	await writeFile(output, Buffer.from(image.render().asPng()));
}

async function createReproducibleArchive(pluginDirectory: string, output: string, archiveRoot: string): Promise<void> {
	const zipWriter = new ZipWriter(new Uint8ArrayWriter(), {
		bufferedWrite: true,
		dataDescriptor: false,
		extendedTimestamp: false,
		externalFileAttributes: 0,
		level: 9,
		msDosCompatible: true,
		rawLastModDate: 0x2821_0000,
		useCompressionStream: false,
		useWebWorkers: false,
		versionMadeBy: 20,
	});

	for (const path of await listFiles(pluginDirectory)) {
		const archivePath = `${archiveRoot}/${relative(pluginDirectory, path).split(sep).join("/")}`;
		await zipWriter.add(archivePath, new Uint8ArrayReader(await readFile(path)));
	}

	await writeFile(output, Buffer.from(await zipWriter.close()));
}

async function listFiles(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
		left.name.localeCompare(right.name, "en"),
	)) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(path)));
		} else if (entry.isFile()) {
			files.push(path);
		} else {
			throw new Error(`Refusing to package non-regular path: ${path}`);
		}
	}
	return files;
}
