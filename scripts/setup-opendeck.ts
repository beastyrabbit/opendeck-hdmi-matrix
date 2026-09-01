import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";

import {
	createProfile,
	isCurrentLauncher,
	isManagedLauncher,
	isManagedMatrixProfile,
	isSameFile,
	isValidProfileName,
	launcherSlot,
	migrateSelectedProfile,
} from "./profile.js";

const PLUGIN = "de.beasty.hdmi-matrix.sdPlugin";
const SWITCH_ACTION = "com.amansprojects.starterpack.switchprofile";

interface Profile {
	infobars: unknown[];
	keys: Array<Record<string, unknown> | null>;
	sliders: unknown[];
}

const args = process.argv.slice(2);
if (args.includes("--matrix-url")) {
	throw new Error("Set the Matrix URL in OpenDeck. The setup script does not accept or store it.");
}
const configRoot = option("--config") ?? defaultConfigRoot();
const matrixProfile = option("--matrix-profile") ?? "HDMI Matrix";
const returnProfile = option("--return-profile") ?? "Default";
if (!isValidProfileName(matrixProfile)) throw new Error(`Unsupported OpenDeck profile name: ${matrixProfile}`);
if (!isValidProfileName(returnProfile)) throw new Error(`Unsupported OpenDeck profile name: ${returnProfile}`);
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
	if (resolve(pluginSource) !== resolve(pluginPath)) {
		await mkdir(resolve(configRoot, "plugins"), { recursive: true });
		await cp(pluginSource, pluginPath, { force: true, recursive: true });
	}
}

const profilesPath = resolve(configRoot, "profiles", device);
const matrixPath = resolve(profilesPath, `${matrixProfile}.json`);
const returnPath = resolve(profilesPath, `${returnProfile}.json`);
if (!dryRun) await mkdir(profilesPath, { recursive: true });

const returnValue = JSON.parse(await readFile(returnPath, "utf8")) as Profile;
const existing = returnValue.keys.find((key) => isManagedLauncher(key, matrixProfile));
const previousMatrixProfile = existing ? profileTarget(existing) : undefined;
if (!dryRun && previousMatrixProfile && previousMatrixProfile !== matrixProfile) {
	await migrateManagedProfile(previousMatrixProfile, matrixProfile, profilesPath, matrixPath);
}

let createdProfile = false;
try {
	await stat(matrixPath);
} catch {
	createdProfile = true;
}
if (!dryRun && createdProfile) {
	await mkdir(dirname(matrixPath), { recursive: true });
	await writeFile(matrixPath, `${JSON.stringify(createProfile(returnProfile), null, 2)}\n`);
}
if (!createdProfile) {
	const currentMatrix = JSON.parse(await readFile(matrixPath, "utf8")) as Profile;
	if (
		(actionUuid(currentMatrix.keys[16] ?? null) !== SWITCH_ACTION ||
			profileTarget(currentMatrix.keys[16] ?? null) !== returnProfile ||
			actionPropertyInspector(currentMatrix.keys[0] ?? null) !== "") &&
		!dryRun
	) {
		await backup(matrixPath);
		await writeFile(matrixPath, `${JSON.stringify(createProfile(returnProfile), null, 2)}\n`);
	}
}

let launcherPosition = existing ? returnValue.keys.indexOf(existing) : -1;
const launcherIsCurrent = isCurrentLauncher(existing, matrixProfile);

if (!launcherIsCurrent) {
	if (!existing) launcherPosition = returnValue.keys.indexOf(null);
	if (launcherPosition < 0) throw new Error(`${returnProfile} has no free key for the Matrix launcher.`);
	returnValue.keys[launcherPosition] = launcherSlot(launcherPosition, matrixProfile);
	if (!dryRun) {
		await backup(returnPath);
		await writeFile(returnPath, `${JSON.stringify(returnValue, null, 2)}\n`);
	}
}

console.log(`${dryRun ? "Would configure" : "Configured"} device ${device}:`);
console.log(`- plugin: ${installedPlugin ? "updated" : "installed"}`);
console.log(`- profile: ${matrixProfile}${createdProfile ? " (new)" : " (ready)"}`);
console.log(
	`- launcher: ${returnProfile}, key ${launcherPosition + 1}${launcherIsCurrent ? " (already present)" : ""}`,
);
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

async function migrateManagedProfile(
	previousProfile: string,
	nextProfile: string,
	profilesPath: string,
	nextPath: string,
): Promise<void> {
	if (!isValidProfileName(previousProfile)) return;
	const previousPath = resolve(profilesPath, `${previousProfile}.json`);
	let previous: Profile;
	try {
		previous = JSON.parse(await readFile(previousPath, "utf8")) as Profile;
	} catch {
		return;
	}
	if (!isManagedMatrixProfile(previous)) return;

	const previousStat = await stat(previousPath);
	let nextStat: Awaited<ReturnType<typeof stat>> | undefined;
	try {
		nextStat = await stat(nextPath);
	} catch {
		// The new target does not exist yet.
	}
	const sameFile = Boolean(nextStat && isSameFile(previousStat, nextStat));
	if (nextStat && !sameFile) {
		const next = JSON.parse(await readFile(nextPath, "utf8")) as Profile;
		if (!isManagedMatrixProfile(next)) {
			throw new Error(`Refusing to replace non-managed OpenDeck profile: ${nextProfile}`);
		}
	}

	await backup(previousPath);
	if (sameFile) {
		const temporaryPath = resolve(dirname(previousPath), `.hdmi-matrix-migration-${randomUUID()}.json`);
		await rename(previousPath, temporaryPath);
		try {
			await rename(temporaryPath, nextPath);
		} catch (error) {
			await rename(temporaryPath, previousPath);
			throw error;
		}
	} else if (nextStat) {
		await unlink(previousPath);
	} else {
		await mkdir(dirname(nextPath), { recursive: true });
		await rename(previousPath, nextPath);
	}
	await migrateDeviceSelection(profilesPath, previousProfile, nextProfile);
	console.log(`- migrated managed profile: ${previousProfile} -> ${nextProfile}`);
}

async function migrateDeviceSelection(
	profilesPath: string,
	previousProfile: string,
	nextProfile: string,
): Promise<void> {
	const deviceConfigPath = `${profilesPath}.json`;
	let current: unknown;
	try {
		current = JSON.parse(await readFile(deviceConfigPath, "utf8"));
	} catch {
		return;
	}
	const migrated = migrateSelectedProfile(current, previousProfile, nextProfile);
	if (!migrated) return;
	await backup(deviceConfigPath);
	await writeFile(deviceConfigPath, `${JSON.stringify(migrated, null, 2)}\n`);
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

function actionPropertyInspector(slot: Record<string, unknown> | null): string | undefined {
	if (!slot) return undefined;
	const action = slot.action as Record<string, unknown> | undefined;
	return action?.property_inspector as string | undefined;
}

async function backup(path: string): Promise<void> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	await cp(path, `${path}.backup-${timestamp}`);
}
