import { execFileSync, spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

const PLUGIN_UUID = "com.beastyrabbit.hdmi-matrix";
const LEGACY_UUID = "de.beasty.hdmi-matrix";
const EXPECTED_AUTHOR = "BeastyRabbit";
const EXPECTED_URL = "https://github.com/beastyrabbit/opendeck-hdmi-matrix";
const PROFILE = "opendeck/HDMI Matrix.json";
const FIXED_ARCHIVE_DATE = 0x2821_0000;

export interface PackagePaths {
	archive: string;
	plugin: string;
	root: string;
}

export async function verifyPackage(paths: PackagePaths): Promise<void> {
	const sourceManifest = parseJson(
		await readFile(resolve(paths.root, "plugin/manifest.json"), "utf8"),
		"source manifest",
	);
	const packageJson = parseJson(await readFile(resolve(paths.root, "package.json"), "utf8"), "package.json");
	const packagedManifest = parseJson(
		await readFile(resolve(paths.plugin, "manifest.json"), "utf8"),
		"packaged manifest",
	);

	assert(sourceManifest.UUID === PLUGIN_UUID, `Source manifest UUID must be ${PLUGIN_UUID}`);
	assert(sourceManifest.Author === EXPECTED_AUTHOR, `Source manifest Author must be ${EXPECTED_AUTHOR}`);
	assert(sourceManifest.URL === EXPECTED_URL, `Source manifest URL must be ${EXPECTED_URL}`);
	assert(/^\d+\.\d+\.\d+$/.test(stringValue(sourceManifest.Version)), "Source version must be major.minor.patch");
	assert(packageJson.version === sourceManifest.Version, "package.json and source manifest versions differ");
	assert(packagedManifest.UUID === PLUGIN_UUID, "Packaged manifest UUID differs from the source manifest");
	assert(packagedManifest.Author === EXPECTED_AUTHOR, "Packaged manifest Author differs from the source manifest");
	assert(packagedManifest.URL === EXPECTED_URL, "Packaged manifest URL differs from the source manifest");
	assert(
		packagedManifest.Version === `${sourceManifest.Version}.0`,
		"Packaged manifest version must add the Stream Deck build component .0",
	);
	assert(packagedManifest.CodePath === "bin/plugin.cjs", "Unexpected plugin CodePath");
	assert(
		isRecord(packagedManifest.Nodejs) && packagedManifest.Nodejs.Version === "20",
		"Packaged manifest must declare Node.js 20",
	);

	const actions = Array.isArray(packagedManifest.Actions) ? packagedManifest.Actions : [];
	assert(actions.length === 1, "The packaged manifest must contain exactly one action");
	assert(
		isRecord(actions[0]) && actions[0].UUID === `${PLUGIN_UUID}.panel`,
		"Unexpected action UUID in packaged manifest",
	);

	const expectedRelativeFiles = expectedFiles();
	const directoryFiles = await listRelativeFiles(paths.plugin);
	assertSameFiles(directoryFiles, expectedRelativeFiles, "plugin directory");

	assert(basename(paths.archive) === `${PLUGIN_UUID}.streamDeckPlugin`, "Unexpected archive filename");
	const reader = new ZipReader(new Uint8ArrayReader(await readFile(paths.archive)), {
		strictness: "strict",
		useCompressionStream: false,
		useWebWorkers: false,
	});
	const entries = await reader.getEntries({ filenameValidation: "strict", strictness: "strict" });
	try {
		assert(
			entries.every((entry) => !entry.directory),
			"Archive must not contain directory entries",
		);
		const archiveRoot = `${PLUGIN_UUID}.sdPlugin/`;
		const archiveFiles = entries.map((entry) => {
			assert(entry.filename.startsWith(archiveRoot), `Archive entry has an unexpected root: ${entry.filename}`);
			assert(entry.rawLastModDate === FIXED_ARCHIVE_DATE, `Archive timestamp is not fixed: ${entry.filename}`);
			assert(!entry.encrypted, `Archive entry must not be encrypted: ${entry.filename}`);
			return entry.filename.slice(archiveRoot.length);
		});
		assertSameFiles(archiveFiles, expectedRelativeFiles, "archive");

		let unpackedBytes = 0;
		for (const entry of entries) {
			assert(!entry.directory && entry.getData, `Archive entry is not a regular file: ${entry.filename}`);
			const data = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true });
			unpackedBytes += data.byteLength;
			assert(unpackedBytes <= 2_000_000, "Archive expands beyond the 2 MB package limit");
			const relativePath = entry.filename.slice(archiveRoot.length);
			const onDisk = await readFile(resolve(paths.plugin, relativePath));
			assert(Buffer.from(data).equals(onDisk), `Archive content differs from plugin directory: ${relativePath}`);
		}
	} finally {
		await reader.close();
	}

	const sourceLicense = await readFile(resolve(paths.root, "LICENSE"));
	const packagedLicense = await readFile(resolve(paths.plugin, "LICENSE"));
	assert(sourceLicense.equals(packagedLicense), "Packaged LICENSE differs from the project LICENSE");
	const notices = await readFile(resolve(paths.plugin, "THIRD_PARTY_NOTICES.md"), "utf8");
	assert(notices.includes("ws 8.21.3"), "Third-party notices must identify bundled ws 8.21.3");
	assert(notices.includes("Copyright (c) 2011 Einar Otto Stangvik"), "The ws copyright notice is missing");

	const profile = parseJson(await readFile(resolve(paths.plugin, PROFILE), "utf8"), "generated profile");
	assert(Array.isArray(profile.keys) && profile.keys.length > 0, "Generated profile must contain keys");
	const profileText = JSON.stringify(profile);
	assert(profileText.includes(PLUGIN_UUID), "Generated profile does not reference the plugin UUID");
	assert(!profileText.includes(LEGACY_UUID), "Generated profile still references the legacy plugin UUID");

	for (const file of ["bin/plugin.cjs", "setup-opendeck.mjs"]) {
		execFileSync(process.execPath, ["--check", resolve(paths.plugin, file)], { stdio: "pipe" });
	}
	for (const icon of ["back", "launcher", "panel", "plugin"]) {
		await verifyPng(resolve(paths.plugin, `icons/${icon}.png`), 144);
		await verifyPng(resolve(paths.plugin, `icons/${icon}@2x.png`), 288);
	}

	verifyElgatoValidator(paths.plugin);
	console.log(`Verified ${basename(paths.archive)} (${expectedRelativeFiles.length} allowlisted files)`);
}

export function expectedFiles(): string[] {
	return [
		"LICENSE",
		"THIRD_PARTY_NOTICES.md",
		"bin/plugin.cjs",
		"config.json",
		"icons/back.png",
		"icons/back@2x.png",
		"icons/launcher.png",
		"icons/launcher@2x.png",
		"icons/panel.png",
		"icons/panel@2x.png",
		"icons/plugin.png",
		"icons/plugin@2x.png",
		"manifest.json",
		PROFILE,
		"property-inspector/index.html",
		"property-inspector/property-inspector.js",
		"property-inspector/styles.css",
		"setup-opendeck.mjs",
	].sort();
}

function verifyElgatoValidator(plugin: string): void {
	const pnpmCli = process.env.npm_execpath;
	const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const prefix = pnpmCli ? [pnpmCli] : [];
	const result = spawnSync(command, [...prefix, "exec", "streamdeck", "validate", "--no-update-check", plugin], {
		encoding: "utf8",
	});
	if (result.error) {
		throw result.error;
	}
	const output = stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
	const diagnostics = output.split(/\r?\n/).filter((line) => /^\s*(?:\d+:\d+\s+)?(?:error|warning)\s+/i.test(line));
	const expectedErrors = [
		"OS must not contain more than 2 items",
		"OS[0] must contain property: MinimumVersion",
		"OS[0].Platform must be 'mac', or 'windows'",
	];
	assert(result.status !== 0, "Elgato validator unexpectedly accepted the OpenDeck Linux manifest workaround");
	assert(diagnostics.length === expectedErrors.length, `Unexpected Elgato validator diagnostics:\n${output}`);
	for (const expected of expectedErrors) {
		assert(
			diagnostics.some((line) => line.includes(expected)),
			`Missing expected validator diagnostic: ${expected}`,
		);
	}
}

async function verifyPng(path: string, expectedSize: number): Promise<void> {
	const png = await readFile(path);
	assert(png.length >= 24 && png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), `Invalid PNG: ${path}`);
	assert(png.readUInt32BE(16) === expectedSize, `Unexpected PNG width: ${path}`);
	assert(png.readUInt32BE(20) === expectedSize, `Unexpected PNG height: ${path}`);
}

async function listRelativeFiles(directory: string, current = ""): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(resolve(directory, current), { withFileTypes: true })) {
		const relativePath = current ? `${current}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...(await listRelativeFiles(directory, relativePath)));
		} else if (entry.isFile()) {
			files.push(relativePath);
		} else {
			throw new Error(`Plugin directory contains a non-regular path: ${relativePath}`);
		}
	}
	return files.sort();
}

function assertSameFiles(actual: string[], expected: string[], label: string): void {
	assert(
		JSON.stringify([...actual].sort()) === JSON.stringify(expected),
		`Unexpected files in ${label}:\n${[...actual].sort().join("\n")}`,
	);
}

function parseJson(value: string, label: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	assert(isRecord(parsed), `${label} must be a JSON object`);
	return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function stripAnsi(value: string): string {
	return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

const cliPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === cliPath) {
	const root = resolve(import.meta.dirname, "..");
	const plugin = resolve(root, `dist/${PLUGIN_UUID}.sdPlugin`);
	await verifyPackage({
		archive: resolve(root, `dist/${PLUGIN_UUID}.streamDeckPlugin`),
		plugin,
		root,
	});
}
