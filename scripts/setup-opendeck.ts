import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";

import { createProfile, switchProfileSlot } from "./profile.js";

const PLUGIN = "de.beasty.hdmi-matrix.sdPlugin";
const LAUNCHER = "de.beasty.hdmi-matrix.open";
const SWITCH_ACTION = "com.amansprojects.starterpack.switchprofile";

interface Profile {
	infobars: unknown[];
	keys: Array<Record<string, unknown> | null>;
	sliders: unknown[];
}

const args = process.argv.slice(2);
const configRoot = option("--config") ?? defaultConfigRoot();
const matrixProfile = option("--matrix-profile") ?? "HDMI Matrix";
const returnProfile = option("--return-profile") ?? "Default";
const matrixUrl = option("--matrix-url")?.replace(/\/$/, "");
const device = option("--device") ?? (await discoverDevice(configRoot));
const dryRun = args.includes("--dry-run");

if (!dryRun && !args.includes("--allow-running") && (await isOpenDeckRunning())) {
	throw new Error("OpenDeck is running. Quit it before setup so it cannot overwrite the profile files.");
}

const pluginPath = resolve(configRoot, "plugins", PLUGIN);
const pluginManifest = resolve(pluginPath, "manifest.json");
let installedPlugin = true;
try {
	await stat(pluginManifest);
} catch {
	installedPlugin = false;
}
const pluginSource = await locatePluginSource();
if (!dryRun) {
	let existingConfig: Record<string, unknown> | undefined;
	if (installedPlugin) {
		try {
			existingConfig = JSON.parse(await readFile(resolve(pluginPath, "config.json"), "utf8")) as Record<
				string,
				unknown
			>;
		} catch {
			// An older installation may not have a config file yet.
		}
	}
	if (resolve(pluginSource) !== resolve(pluginPath)) {
		await mkdir(resolve(configRoot, "plugins"), { recursive: true });
		await cp(pluginSource, pluginPath, { force: true, recursive: true });
	}
	if (existingConfig || matrixUrl) {
		const config = existingConfig ?? {};
		if (matrixUrl) config.matrixUrl = matrixUrl;
		await writeFile(resolve(pluginPath, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
	}
}

const profilesPath = resolve(configRoot, "profiles", device);
const matrixPath = resolve(profilesPath, `${matrixProfile}.json`);
const returnPath = resolve(profilesPath, `${returnProfile}.json`);
if (!dryRun) await mkdir(profilesPath, { recursive: true });

let createdProfile = false;
try {
	await stat(matrixPath);
} catch {
	createdProfile = true;
}
if (!dryRun && createdProfile)
	await writeFile(matrixPath, `${JSON.stringify(createProfile(returnProfile), null, 2)}\n`);
if (!createdProfile) {
	const currentMatrix = JSON.parse(await readFile(matrixPath, "utf8")) as Profile;
	if (
		(actionUuid(currentMatrix.keys[16] ?? null) !== SWITCH_ACTION ||
			profileTarget(currentMatrix.keys[16] ?? null) !== returnProfile) &&
		!dryRun
	) {
		await backup(matrixPath);
		await writeFile(matrixPath, `${JSON.stringify(createProfile(returnProfile), null, 2)}\n`);
	}
}

const returnValue = JSON.parse(await readFile(returnPath, "utf8")) as Profile;
const existing = returnValue.keys.find(
	(key) => actionUuid(key) === LAUNCHER || (actionUuid(key) === SWITCH_ACTION && profileTarget(key) === matrixProfile),
);
let launcherPosition = existing ? returnValue.keys.indexOf(existing) : -1;
const launcherIsNative = existing && actionUuid(existing) === SWITCH_ACTION;

if (!launcherIsNative) {
	if (!existing) launcherPosition = returnValue.keys.indexOf(null);
	if (launcherPosition < 0) throw new Error(`${returnProfile} has no free key for the Matrix launcher.`);
	returnValue.keys[launcherPosition] = switchProfileSlot(launcherPosition, matrixProfile, "launcher");
	if (!dryRun) {
		await backup(returnPath);
		await writeFile(returnPath, `${JSON.stringify(returnValue, null, 2)}\n`);
	}
}

console.log(`${dryRun ? "Would configure" : "Configured"} device ${device}:`);
console.log(`- plugin: ${installedPlugin ? "updated" : "installed"}`);
console.log(`- profile: ${matrixProfile}${createdProfile ? " (new)" : " (ready)"}`);
console.log(`- launcher: ${returnProfile}, key ${launcherPosition + 1}${launcherIsNative ? " (already present)" : ""}`);
if (matrixUrl) console.log(`- matrix: ${matrixUrl}`);
console.log("Restart OpenDeck once so it reloads the plugin and profile files.");

function option(name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

async function discoverDevice(root: string): Promise<string> {
	const profiles = resolve(root, "profiles");
	const candidates: string[] = [];
	for (const entry of await readdir(profiles, { withFileTypes: true })) {
		if (entry.isDirectory()) candidates.push(entry.name);
	}
	if (candidates.length !== 1) {
		throw new Error(`Expected one OpenDeck device, found ${candidates.length}. Pass --device <id>.`);
	}
	return candidates[0] as string;
}

async function locatePluginSource(): Promise<string> {
	const candidates = [
		option("--plugin-source"),
		resolve(import.meta.dirname),
		resolve(import.meta.dirname, ".."),
		resolve(import.meta.dirname, PLUGIN),
		resolve(import.meta.dirname, "..", "dist", PLUGIN),
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		try {
			await stat(resolve(candidate, "manifest.json"));
			return candidate;
		} catch {
			// Try the next build location.
		}
	}
	throw new Error(`Built plugin not found. Run pnpm build first or pass --plugin-source <path>.`);
}

function defaultConfigRoot(): string {
	if (platform() === "win32") {
		return resolve(process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming"), "opendeck");
	}
	if (platform() === "darwin") return resolve(homedir(), "Library", "Application Support", "opendeck");
	return resolve(homedir(), ".config", "opendeck");
}

async function isOpenDeckRunning(): Promise<boolean> {
	if (platform() !== "linux") return false;
	for (const entry of await readdir("/proc", { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
		try {
			if ((await readFile(resolve("/proc", entry.name, "comm"), "utf8")).trim() === "opendeck") return true;
		} catch {
			// The process may have ended between listing /proc and reading its name.
		}
	}
	return false;
}

function actionUuid(slot: Record<string, unknown> | null): string | undefined {
	if (!slot) return undefined;
	const action = slot.action as Record<string, unknown> | undefined;
	return action?.uuid as string | undefined;
}

function profileTarget(slot: Record<string, unknown> | null): string | undefined {
	return (slot?.settings as Record<string, unknown> | undefined)?.profile as string | undefined;
}

async function backup(path: string): Promise<void> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	await cp(path, `${path}.backup-${timestamp}`);
}
