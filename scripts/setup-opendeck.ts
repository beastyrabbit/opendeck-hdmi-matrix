import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

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

const PLUGIN_UUID = "com.beastyrabbit.hdmi-matrix";
const PLUGIN = `${PLUGIN_UUID}.sdPlugin`;
const LEGACY_PLUGIN_UUID = "de.beasty.hdmi-matrix";
const LEGACY_PLUGIN = `${LEGACY_PLUGIN_UUID}.sdPlugin`;
const SWITCH_PLUGIN = "com.amansprojects.starterpack.sdPlugin";
const SWITCH_ACTION = "com.amansprojects.starterpack.switchprofile";

interface Profile {
	infobars?: unknown[];
	keys: Array<Record<string, unknown> | null>;
	sliders?: unknown[];
}

export interface FileSnapshot {
	contents: string;
	dev: bigint | number;
	ino: bigint | number;
	mode: number;
	path: string;
}

interface SetupOptions {
	configRoot: string;
	confirmedClosed: boolean;
	device?: string;
	dryRun: boolean;
	matrixProfile: string;
	pluginSource?: string;
	returnProfile: string;
}

interface MigrationPlan {
	next: FileSnapshot | undefined;
	previous: FileSnapshot;
	previousPath: string;
	previousProfile: string;
	sameFile: boolean;
}

type RenameOperation = (oldPath: string, newPath: string) => Promise<void>;

if (isMainModule()) await main();

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	await assertSafeDirectory(options.configRoot, "OpenDeck config directory");
	const profilesRoot = containedPath(options.configRoot, "profiles");
	const pluginsRoot = containedPath(options.configRoot, "plugins");
	await assertSafeDirectory(profilesRoot, "OpenDeck profiles directory");
	await assertSafeDirectory(pluginsRoot, "OpenDeck plugins directory");

	if (!options.dryRun) {
		if (platform() === "linux") {
			if (await isOpenDeckRunning()) {
				throw new Error("OpenDeck is running. Quit it before setup so it cannot overwrite the profile files.");
			}
		} else if (!options.confirmedClosed) {
			throw new Error(
				"OpenDeck process detection is not available on this platform. Quit OpenDeck, then rerun with --confirm-opendeck-closed.",
			);
		}
	}

	const device = options.device ?? (await discoverDevice(profilesRoot));
	if (!isValidDeviceName(device)) throw new Error(`Unsupported OpenDeck device ID: ${device}`);
	const devicePath = containedPath(profilesRoot, device);
	if (dirname(devicePath) !== profilesRoot) throw new Error(`Unsupported OpenDeck device ID: ${device}`);
	await assertSafeDirectory(devicePath, `OpenDeck device profile directory (${device})`);

	if (options.dryRun) {
		await configure(options, device, devicePath, pluginsRoot);
		return;
	}
	await withSetupLock(options.configRoot, () => configure(options, device, devicePath, pluginsRoot));
}

async function configure(
	options: SetupOptions,
	device: string,
	profilesPath: string,
	pluginsRoot: string,
): Promise<void> {
	await verifyStarterPack(pluginsRoot);
	const pluginSource = await locatePluginSource(options.pluginSource);
	await validatePluginDirectory(pluginSource, PLUGIN_UUID, "built plugin");
	const pluginPath = containedPath(pluginsRoot, PLUGIN);
	const installedSnapshot = await inspectInstalledPlugin(pluginPath);

	const matrixPath = profilePath(profilesPath, options.matrixProfile);
	const returnPath = profilePath(profilesPath, options.returnProfile);
	if (matrixPath.toLocaleLowerCase() === returnPath.toLocaleLowerCase()) {
		throw new Error("The Matrix profile and return profile must have different names.");
	}
	await assertSafeParentPath(profilesPath, matrixPath, !options.dryRun, options.dryRun);
	await assertSafeParentPath(profilesPath, returnPath, false);

	const returnSnapshot = await readRegularSnapshot(returnPath, `${options.returnProfile} profile`);
	if (!returnSnapshot) throw new Error(`OpenDeck return profile not found: ${options.returnProfile}`);
	const returnValue = parseProfile(returnSnapshot, options.returnProfile);
	const managedLaunchers = returnValue.keys.filter((key) => isManagedLauncher(key));
	if (managedLaunchers.length > 1) {
		throw new Error(`${options.returnProfile} contains multiple HDMI Matrix launchers; remove the duplicate manually.`);
	}
	const existing = managedLaunchers[0];
	const previousMatrixProfile = existing ? profileTarget(existing) : undefined;
	const migration = await planMigration(
		previousMatrixProfile,
		options.matrixProfile,
		profilesPath,
		matrixPath,
		returnPath,
	);

	let matrixSnapshot =
		migration?.next ?? (await readRegularSnapshot(matrixPath, `${options.matrixProfile} profile`, true));
	if (matrixSnapshot) {
		assertManagedMatrixSnapshot(matrixSnapshot, options.matrixProfile);
	}

	let launcherPosition = existing ? returnValue.keys.indexOf(existing) : -1;
	const launcherIsCurrent = isCurrentLauncher(existing, options.matrixProfile);
	if (!launcherIsCurrent) {
		if (!existing) launcherPosition = returnValue.keys.indexOf(null);
		if (launcherPosition < 0) throw new Error(`${options.returnProfile} has no free key for the Matrix launcher.`);
	}

	if (options.dryRun) {
		console.log(`Would configure device ${device}:`);
		console.log(`- plugin: ${installedSnapshot ? "updated" : "installed"}`);
		console.log(`- profile: ${options.matrixProfile}${matrixSnapshot ? " (updated if needed)" : " (new)"}`);
		console.log(`- launcher: ${options.returnProfile}, key ${launcherPosition + 1}`);
		return;
	}

	if (platform() === "linux" && (await isOpenDeckRunning())) {
		throw new Error("OpenDeck started during setup preflight. Quit it and run setup again.");
	}
	if (!(await pathsReferToSameEntry(pluginSource, pluginPath))) {
		await replaceDirectoryAtomically(pluginSource, pluginPath, PLUGIN_UUID);
	}
	await warnAboutLegacyPlugin(pluginsRoot);

	const expectedMatrix = `${JSON.stringify(createProfile(options.returnProfile), null, 2)}\n`;
	if (!matrixSnapshot || matrixSnapshot.contents !== expectedMatrix) {
		await assertSafeParentPath(profilesPath, matrixPath, true);
		await writeRegularFileAtomically(matrixPath, expectedMatrix, matrixSnapshot, profilesPath);
		matrixSnapshot = await readRegularSnapshot(matrixPath, `${options.matrixProfile} profile`);
	}

	if (!launcherIsCurrent) {
		returnValue.keys[launcherPosition] = launcherSlot(launcherPosition, options.matrixProfile);
		await writeRegularFileAtomically(
			returnPath,
			`${JSON.stringify(returnValue, null, 2)}\n`,
			returnSnapshot,
			profilesPath,
		);
	}

	if (migration) {
		await migrateDeviceSelection(profilesPath, options.device ?? device, migration, options.matrixProfile);
		if (!migration.sameFile) await removeRegularFileWithBackup(migration.previous, profilesPath);
		console.log(`- migrated managed profile: ${previousMatrixProfile} -> ${options.matrixProfile}`);
	}

	console.log(`Configured device ${device}:`);
	console.log(`- plugin: ${installedSnapshot ? "updated" : "installed"}`);
	console.log(`- profile: ${options.matrixProfile}${matrixSnapshot ? " (ready)" : " (new)"}`);
	console.log(
		`- launcher: ${options.returnProfile}, key ${launcherPosition + 1}${launcherIsCurrent ? " (already present)" : ""}`,
	);
	console.log("Restart OpenDeck once so it reloads the plugin and profile files.");
}

function parseArguments(args: string[]): SetupOptions {
	const values = new Map<string, string>();
	let dryRun = false;
	let confirmedClosed = false;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index] as string;
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (argument === "--confirm-opendeck-closed") {
			confirmedClosed = true;
			continue;
		}
		if (argument === "--matrix-url") {
			throw new Error("Set the Matrix URL in OpenDeck. The setup script does not accept or store it.");
		}
		if (!["--config", "--device", "--matrix-profile", "--plugin-source", "--return-profile"].includes(argument)) {
			throw new Error(`Unknown setup option: ${argument}`);
		}
		const value = args[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
		if (values.has(argument)) throw new Error(`Duplicate setup option: ${argument}`);
		values.set(argument, value);
		index += 1;
	}

	const matrixProfile = values.get("--matrix-profile") ?? "HDMI Matrix";
	const returnProfile = values.get("--return-profile") ?? "Default";
	if (!isValidProfileName(matrixProfile)) throw new Error(`Unsupported OpenDeck profile name: ${matrixProfile}`);
	if (!isValidProfileName(returnProfile)) throw new Error(`Unsupported OpenDeck profile name: ${returnProfile}`);
	return {
		configRoot: resolve(values.get("--config") ?? defaultConfigRoot()),
		confirmedClosed,
		device: values.get("--device"),
		dryRun,
		matrixProfile,
		pluginSource: values.get("--plugin-source"),
		returnProfile,
	};
}

export function isValidDeviceName(device: string): boolean {
	return device.length <= 128 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(device) && device !== "." && device !== "..";
}

export function containedPath(root: string, ...segments: string[]): string {
	const normalizedRoot = resolve(root);
	const target = resolve(normalizedRoot, ...segments);
	const relation = relative(normalizedRoot, target);
	if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new Error(`Unsafe path outside ${normalizedRoot}: ${target}`);
	}
	return target;
}

function profilePath(profilesPath: string, profile: string): string {
	if (!isValidProfileName(profile)) throw new Error(`Unsupported OpenDeck profile name: ${profile}`);
	return containedPath(profilesPath, `${profile}.json`);
}

async function discoverDevice(profilesRoot: string): Promise<string> {
	const candidates: string[] = [];
	for (const entry of await readdir(profilesRoot, { withFileTypes: true })) {
		if (entry.isDirectory() && isValidDeviceName(entry.name)) candidates.push(entry.name);
	}
	if (candidates.length !== 1) {
		throw new Error(`Expected one OpenDeck device, found ${candidates.length}. Pass --device <id>.`);
	}
	return candidates[0] as string;
}

async function locatePluginSource(explicitSource?: string): Promise<string> {
	const candidates = [
		explicitSource,
		resolve(import.meta.dirname),
		resolve(import.meta.dirname, ".."),
		resolve(import.meta.dirname, PLUGIN),
		resolve(import.meta.dirname, "..", "dist", PLUGIN),
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		try {
			await validatePluginDirectory(resolve(candidate), PLUGIN_UUID, "built plugin");
			return resolve(candidate);
		} catch {
			if (explicitSource) throw new Error(`Valid built plugin not found at --plugin-source: ${resolve(candidate)}`);
		}
	}
	throw new Error("Built plugin not found. Run pnpm build first or pass --plugin-source <path>.");
}

async function inspectInstalledPlugin(pluginPath: string): Promise<FileSnapshot | undefined> {
	const entry = await safeLstat(pluginPath);
	if (!entry) return undefined;
	if (entry.isSymbolicLink() || !entry.isDirectory()) {
		throw new Error(`Refusing unsafe installed plugin path: ${pluginPath}`);
	}
	await validatePluginDirectory(pluginPath, PLUGIN_UUID, "installed plugin");
	return readRegularSnapshot(containedPath(pluginPath, "manifest.json"), "installed plugin manifest");
}

async function validatePluginDirectory(path: string, expectedUuid: string, label: string): Promise<void> {
	await assertSafeDirectory(path, label);
	await assertSafeTree(path);
	const manifestPath = containedPath(path, "manifest.json");
	const snapshot = await readRegularSnapshot(manifestPath, `${label} manifest`);
	if (!snapshot) throw new Error(`${label} has no manifest.json: ${path}`);
	const manifest = parseJson(snapshot.contents, `${label} manifest`) as { UUID?: unknown };
	if (manifest.UUID !== expectedUuid) {
		throw new Error(`${label} manifest UUID must be ${expectedUuid}: ${path}`);
	}
}

export async function verifyStarterPack(pluginsRoot: string): Promise<void> {
	const pluginPath = containedPath(pluginsRoot, SWITCH_PLUGIN);
	const pluginEntry = await safeLstat(pluginPath);
	if (!pluginEntry) {
		throw new Error(`OpenDeck Starter Pack is required to create launcher and Back actions, but it is not installed.`);
	}
	if (pluginEntry.isSymbolicLink() || !pluginEntry.isDirectory()) {
		throw new Error(`Refusing unsafe OpenDeck Starter Pack plugin path: ${pluginPath}`);
	}
	const manifestPath = containedPath(pluginPath, "manifest.json");
	const snapshot = await readRegularSnapshot(manifestPath, "OpenDeck Starter Pack manifest");
	if (!snapshot) {
		throw new Error("OpenDeck Starter Pack is required to create the Matrix launcher, but its manifest is missing.");
	}
	const manifest = parseJson(snapshot.contents, "OpenDeck Starter Pack manifest") as { Actions?: unknown };
	const actions = Array.isArray(manifest.Actions) ? manifest.Actions : [];
	if (!actions.some((action) => isRecord(action) && action.UUID === SWITCH_ACTION)) {
		throw new Error(`OpenDeck Starter Pack does not provide the required ${SWITCH_ACTION} action.`);
	}
}

async function planMigration(
	previousProfile: string | undefined,
	nextProfile: string,
	profilesPath: string,
	nextPath: string,
	returnPath: string,
): Promise<MigrationPlan | undefined> {
	if (!previousProfile || previousProfile === nextProfile) return undefined;
	if (!isValidProfileName(previousProfile)) {
		throw new Error(`Managed launcher contains an unsupported profile target: ${previousProfile}`);
	}
	const previousPath = profilePath(profilesPath, previousProfile);
	if (previousPath.toLocaleLowerCase() === returnPath.toLocaleLowerCase()) {
		throw new Error("Refusing to migrate the configured return profile.");
	}
	await assertSafeParentPath(profilesPath, previousPath, false);
	const previous = await readRegularSnapshot(previousPath, `${previousProfile} profile`, true);
	if (!previous) return undefined;
	if (!isManagedMatrixProfile(parseProfile(previous, previousProfile))) {
		throw new Error(`Refusing to migrate non-managed OpenDeck profile: ${previousProfile}`);
	}
	const next = await readRegularSnapshot(nextPath, `${nextProfile} profile`, true);
	if (next && !isManagedMatrixProfile(parseProfile(next, nextProfile))) {
		throw new Error(`Refusing to replace non-managed OpenDeck profile: ${nextProfile}`);
	}
	return {
		next,
		previous,
		previousPath,
		previousProfile,
		sameFile: Boolean(next && isSameFile(previous, next)),
	};
}

function parseProfile(snapshot: FileSnapshot, name: string): Profile {
	const value = parseJson(snapshot.contents, `${name} profile`);
	if (!isRecord(value) || !Array.isArray(value.keys)) throw new Error(`Invalid OpenDeck profile: ${name}`);
	return value as unknown as Profile;
}

export function assertManagedMatrixSnapshot(snapshot: FileSnapshot, name: string): void {
	if (!isManagedMatrixProfile(parseProfile(snapshot, name))) {
		throw new Error(`Refusing to replace non-managed OpenDeck profile: ${name}`);
	}
}

async function migrateDeviceSelection(
	profilesPath: string,
	device: string,
	migration: MigrationPlan,
	nextProfile: string,
): Promise<void> {
	const deviceConfigPath = containedPath(dirname(profilesPath), `${device}.json`);
	const snapshot = await readRegularSnapshot(deviceConfigPath, "OpenDeck device selection", true);
	if (!snapshot) return;
	const current = parseJson(snapshot.contents, "OpenDeck device selection");
	const migrated = migrateSelectedProfile(current, migration.previousProfile, nextProfile);
	if (!migrated) return;
	await writeRegularFileAtomically(
		deviceConfigPath,
		`${JSON.stringify(migrated, null, 2)}\n`,
		snapshot,
		dirname(profilesPath),
	);
}

export async function readRegularSnapshot(
	path: string,
	label: string,
	optional = false,
): Promise<FileSnapshot | undefined> {
	const before = await safeLstat(path);
	if (!before) {
		if (optional) return undefined;
		throw new Error(`${label} not found: ${path}`);
	}
	if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Refusing unsafe non-regular ${label}: ${path}`);

	const handle = await open(path, constants.O_RDONLY | noFollowFlag());
	try {
		const opened = await handle.stat();
		if (!isSameFile(before, opened) || !opened.isFile())
			throw new Error(`${label} changed while it was opened: ${path}`);
		const contents = await handle.readFile("utf8");
		const after = await handle.stat();
		if (!isSameFile(opened, after) || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
			throw new Error(`${label} changed while it was read: ${path}`);
		}
		return { contents, dev: opened.dev, ino: opened.ino, mode: opened.mode, path };
	} finally {
		await handle.close();
	}
}

export async function writeRegularFileAtomically(
	path: string,
	contents: string,
	expected: FileSnapshot | undefined,
	containmentRoot: string,
): Promise<string | undefined> {
	assertContained(containmentRoot, path);
	await assertSafeParentPath(containmentRoot, path, true);
	const temporaryPath = containedPath(dirname(path), `.${fileName(path)}.tmp-${randomUUID()}`);
	const mode = expected ? expected.mode & 0o777 : 0o600;
	const handle = await open(
		temporaryPath,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
		mode,
	);
	let backupPath: string | undefined;
	try {
		await handle.writeFile(contents, "utf8");
		await handle.chmod(mode);
		await handle.sync();
		await handle.close();
		if (expected) {
			await assertSnapshotUnchanged(expected);
			backupPath = await writeBackup(expected, containmentRoot);
			await assertSnapshotUnchanged(expected);
		} else {
			await assertPathMissing(path);
		}
		await rename(temporaryPath, path);
		return backupPath;
	} catch (error) {
		await handle.close().catch(() => undefined);
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

async function removeRegularFileWithBackup(snapshot: FileSnapshot, containmentRoot: string): Promise<void> {
	assertContained(containmentRoot, snapshot.path);
	await assertSnapshotUnchanged(snapshot);
	await writeBackup(snapshot, containmentRoot);
	await assertSnapshotUnchanged(snapshot);
	await unlink(snapshot.path);
}

async function writeBackup(snapshot: FileSnapshot, containmentRoot: string): Promise<string> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = `${snapshot.path}.backup-${stamp}-${randomUUID().slice(0, 8)}`;
	assertContained(containmentRoot, backupPath);
	const handle = await open(
		backupPath,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(),
		snapshot.mode & 0o777,
	);
	try {
		await handle.writeFile(snapshot.contents, "utf8");
		await handle.chmod(snapshot.mode & 0o777);
		await handle.sync();
	} finally {
		await handle.close();
	}
	return backupPath;
}

async function assertSnapshotUnchanged(snapshot: FileSnapshot): Promise<void> {
	const current = await readRegularSnapshot(snapshot.path, "OpenDeck file being updated");
	if (
		!current ||
		!isSameFile(snapshot, current) ||
		current.mode !== snapshot.mode ||
		current.contents !== snapshot.contents
	) {
		throw new Error(`OpenDeck file changed since setup read it; refusing to overwrite: ${snapshot.path}`);
	}
}

export async function replaceDirectoryAtomically(
	source: string,
	target: string,
	expectedUuid: string,
	renameOperation: RenameOperation = rename,
): Promise<void> {
	await validatePluginDirectory(source, expectedUuid, "plugin source");
	const parent = dirname(target);
	await assertSafeDirectory(parent, "OpenDeck plugins directory");
	assertContained(parent, target);

	const existing = await safeLstat(target);
	if (existing) {
		if (existing.isSymbolicLink() || !existing.isDirectory())
			throw new Error(`Refusing unsafe plugin target: ${target}`);
		await validatePluginDirectory(target, expectedUuid, "installed plugin");
	}
	const stagingPath = containedPath(parent, `.${fileName(target)}.install-${randomUUID()}`);
	const rollbackPath = containedPath(parent, `.${fileName(target)}.rollback-${randomUUID()}`);
	let movedExisting = false;
	try {
		await cp(source, stagingPath, { errorOnExist: true, force: false, preserveTimestamps: true, recursive: true });
		await validatePluginDirectory(stagingPath, expectedUuid, "staged plugin");
		if (existing) {
			const current = await lstat(target);
			if (!isSameFile(existing, current) || current.isSymbolicLink() || !current.isDirectory()) {
				throw new Error(`Installed plugin changed during setup: ${target}`);
			}
			await renameOperation(target, rollbackPath);
			movedExisting = true;
		} else {
			await assertPathMissing(target);
		}
		try {
			await renameOperation(stagingPath, target);
		} catch (error) {
			if (movedExisting) {
				try {
					await renameOperation(rollbackPath, target);
					movedExisting = false;
				} catch (restoreError) {
					throw new AggregateError(
						[error, restoreError],
						`Plugin installation failed and rollback could not be restored: ${target}`,
					);
				}
			}
			throw error;
		}
		if (movedExisting) {
			await rm(rollbackPath, { force: true, recursive: true });
			movedExisting = false;
		}
	} finally {
		await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
		if (!movedExisting) await rm(rollbackPath, { force: true, recursive: true }).catch(() => undefined);
	}
}

async function pathsReferToSameEntry(first: string, second: string): Promise<boolean> {
	try {
		const [firstStat, secondStat] = await Promise.all([stat(first), stat(second)]);
		return isSameFile(firstStat, secondStat);
	} catch {
		return false;
	}
}

async function warnAboutLegacyPlugin(pluginsRoot: string): Promise<void> {
	const legacyPath = containedPath(pluginsRoot, LEGACY_PLUGIN);
	const entry = await safeLstat(legacyPath);
	if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) return;
	const manifest = await readRegularSnapshot(
		containedPath(legacyPath, "manifest.json"),
		"legacy plugin manifest",
		true,
	);
	if (!manifest) return;
	try {
		const value = parseJson(manifest.contents, "legacy plugin manifest") as { UUID?: unknown };
		if (value.UUID === LEGACY_PLUGIN_UUID) {
			console.warn(`Legacy ${LEGACY_PLUGIN} is still installed. Remove it manually after verifying this setup.`);
		}
	} catch {
		// Never infer ownership from a malformed legacy directory.
	}
}

async function withSetupLock<T>(configRoot: string, operation: () => Promise<T>): Promise<T> {
	const lockPath = containedPath(configRoot, ".com.beastyrabbit.hdmi-matrix.setup.lock");
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag(), 0o600);
	} catch (error) {
		if (errorCode(error) === "EEXIST") {
			throw new Error(`Another setup may be running. If it is not, remove the stale lock after checking: ${lockPath}`);
		}
		throw error;
	}
	const opened = await handle.stat();
	try {
		await handle.writeFile(`${process.pid}\n`, "utf8");
		await handle.sync();
		return await operation();
	} finally {
		await handle.close();
		const current = await safeLstat(lockPath);
		if (current && isSameFile(opened, current) && current.isFile() && !current.isSymbolicLink()) await unlink(lockPath);
	}
}

async function assertSafeDirectory(path: string, label: string): Promise<void> {
	const entry = await safeLstat(path);
	if (!entry) throw new Error(`${label} not found: ${path}`);
	if (entry.isSymbolicLink() || !entry.isDirectory())
		throw new Error(`Refusing unsafe non-directory ${label}: ${path}`);
}

async function assertSafeParentPath(
	root: string,
	target: string,
	createMissing: boolean,
	allowMissing = false,
): Promise<void> {
	assertContained(root, target);
	const relation = relative(resolve(root), dirname(resolve(target)));
	let current = resolve(root);
	if (!relation) return;
	for (const segment of relation.split(sep)) {
		current = containedPath(root, relative(resolve(root), current), segment);
		let entry = await safeLstat(current);
		if (!entry && createMissing) {
			await mkdir(current);
			entry = await lstat(current);
		}
		if (!entry && allowMissing) continue;
		if (!entry) throw new Error(`Profile directory not found: ${current}`);
		if (entry.isSymbolicLink() || !entry.isDirectory())
			throw new Error(`Refusing unsafe profile directory: ${current}`);
	}
}

async function assertSafeTree(root: string): Promise<void> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = containedPath(root, entry.name);
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
			throw new Error(`Refusing unsafe entry in plugin directory: ${path}`);
		}
		if (metadata.isDirectory()) await assertSafeTree(path);
	}
}

function assertContained(root: string, target: string): void {
	const normalizedRoot = resolve(root);
	const normalizedTarget = resolve(target);
	const relation = relative(normalizedRoot, normalizedTarget);
	if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
		throw new Error(`Unsafe path outside ${normalizedRoot}: ${normalizedTarget}`);
	}
}

async function assertPathMissing(path: string): Promise<void> {
	if (await safeLstat(path)) throw new Error(`Path appeared during setup; refusing to overwrite it: ${path}`);
}

async function safeLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}

function parseJson(contents: string, label: string): unknown {
	try {
		return JSON.parse(contents);
	} catch {
		throw new Error(`Invalid JSON in ${label}.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function profileTarget(slot: Record<string, unknown> | null): string | undefined {
	return (slot?.settings as Record<string, unknown> | undefined)?.profile as string | undefined;
}

function fileName(path: string): string {
	return path.slice(path.lastIndexOf(sep) + 1);
}

function noFollowFlag(): number {
	return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function errorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}

function defaultConfigRoot(): string {
	if (platform() === "win32") {
		return resolve(process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming"), "opendeck");
	}
	if (platform() === "darwin") return resolve(homedir(), "Library", "Application Support", "opendeck");
	return resolve(homedir(), ".config", "opendeck");
}

async function isOpenDeckRunning(): Promise<boolean> {
	for (const entry of await readdir("/proc", { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
		try {
			if ((await readFile(resolve("/proc", entry.name, "comm"), "utf8")).trim().toLowerCase() === "opendeck") {
				return true;
			}
		} catch {
			// The process may have ended between listing /proc and reading its name.
		}
	}
	return false;
}

function isMainModule(): boolean {
	const entry = process.argv[1];
	return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}
