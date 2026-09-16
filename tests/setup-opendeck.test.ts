import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { it } from "node:test";

import {
	assertManagedMatrixSnapshot,
	containedPath,
	isValidDeviceName,
	readRegularSnapshot,
	replaceDirectoryAtomically,
	verifyStarterPack,
	writeRegularFileAtomically,
} from "../scripts/setup-opendeck.js";

const PLUGIN_UUID = "com.beastyrabbit.hdmi-matrix";
const STARTER_PACK = "com.amansprojects.starterpack.sdPlugin";
const SWITCH_ACTION = "com.amansprojects.starterpack.switchprofile";

it("accepts one safe device directory name and rejects traversal", () => {
	assert.equal(isValidDeviceName("sd-CL35J1A02599"), true);
	for (const device of ["../outside", "nested/device", "nested\\device", ".", "..", "/tmp/device"]) {
		assert.equal(isValidDeviceName(device), false, device);
	}
	assert.throws(() => containedPath("/tmp/profiles", "../outside"), /Unsafe path outside/);
});

it("rejects a symlink instead of reading the linked profile", async (context) => {
	const root = await temporaryDirectory(context);
	const real = resolve(root, "real.json");
	const linked = resolve(root, "linked.json");
	await writeFile(real, "{}\n");
	await symlink(real, linked);
	await assert.rejects(readRegularSnapshot(linked, "linked profile"), /unsafe non-regular linked profile/);
});

it("refuses a non-managed same-name profile collision", async (context) => {
	const root = await temporaryDirectory(context);
	const path = resolve(root, "HDMI Matrix.json");
	await writeFile(path, `${JSON.stringify({ infobars: [], keys: Array(32).fill(null), sliders: [] })}\n`);
	const snapshot = await readRegularSnapshot(path, "Matrix profile");
	assert.ok(snapshot);
	assert.throws(() => assertManagedMatrixSnapshot(snapshot, "HDMI Matrix"), /Refusing to replace non-managed/);
});

it("detects a concurrent file change and preserves the current file", async (context) => {
	const root = await temporaryDirectory(context);
	const path = resolve(root, "Default.json");
	await writeFile(path, "before\n");
	const snapshot = await readRegularSnapshot(path, "Default profile");
	assert.ok(snapshot);
	await writeFile(path, "changed by OpenDeck\n");
	await assert.rejects(
		writeRegularFileAtomically(path, "setup value\n", snapshot, root),
		/changed since setup read it/,
	);
	assert.equal(await readFile(path, "utf8"), "changed by OpenDeck\n");
});

it("atomically replaces a profile, preserves its mode and keeps a recovery backup", async (context) => {
	const root = await temporaryDirectory(context);
	const path = resolve(root, "Default.json");
	await writeFile(path, "before\n");
	await chmod(path, 0o640);
	const snapshot = await readRegularSnapshot(path, "Default profile");
	assert.ok(snapshot);
	const backup = await writeRegularFileAtomically(path, "after\n", snapshot, root);
	assert.ok(backup);
	assert.equal(await readFile(path, "utf8"), "after\n");
	assert.equal(await readFile(backup, "utf8"), "before\n");
	assert.equal((await lstat(path)).mode & 0o777, 0o640);
	assert.equal((await lstat(backup)).mode & 0o777, 0o640);
});

it("replaces the plugin directory without retaining stale files", async (context) => {
	const root = await temporaryDirectory(context);
	const source = resolve(root, "source");
	const target = resolve(root, `${PLUGIN_UUID}.sdPlugin`);
	await createPlugin(source, "new");
	await createPlugin(target, "old");
	await writeFile(resolve(target, "stale.txt"), "remove me\n");

	await replaceDirectoryAtomically(source, target, PLUGIN_UUID);
	assert.equal(await readFile(resolve(target, "version.txt"), "utf8"), "new\n");
	assert.deepEqual((await readdir(target)).sort(), ["manifest.json", "version.txt"]);
});

it("restores the previous plugin if the final atomic rename fails", async (context) => {
	const root = await temporaryDirectory(context);
	const source = resolve(root, "source");
	const target = resolve(root, `${PLUGIN_UUID}.sdPlugin`);
	await createPlugin(source, "new");
	await createPlugin(target, "old");
	let renameCount = 0;
	const failFinalRename = async (oldPath: string, newPath: string): Promise<void> => {
		renameCount += 1;
		if (renameCount === 2) throw new Error("simulated rename failure");
		await rename(oldPath, newPath);
	};

	await assert.rejects(
		replaceDirectoryAtomically(source, target, PLUGIN_UUID, failFinalRename),
		/simulated rename failure/,
	);
	assert.equal(await readFile(resolve(target, "version.txt"), "utf8"), "old\n");
	assert.deepEqual(
		(await readdir(root)).filter((entry) => entry.includes(".install-") || entry.includes(".rollback-")),
		[],
	);
});

it("rejects symlinks in a staged plugin and leaves the installed copy untouched", async (context) => {
	const root = await temporaryDirectory(context);
	const source = resolve(root, "source");
	const target = resolve(root, `${PLUGIN_UUID}.sdPlugin`);
	await createPlugin(source, "new");
	await createPlugin(target, "old");
	await symlink(resolve(source, "version.txt"), resolve(source, "linked.txt"));

	await assert.rejects(replaceDirectoryAtomically(source, target, PLUGIN_UUID), /unsafe entry/);
	assert.equal(await readFile(resolve(target, "version.txt"), "utf8"), "old\n");
});

it("requires the bundled Starter Pack switch-profile action", async (context) => {
	const root = await temporaryDirectory(context);
	const plugin = resolve(root, STARTER_PACK);
	await mkdir(plugin);
	await writeFile(resolve(plugin, "manifest.json"), `${JSON.stringify({ Actions: [] })}\n`);
	await assert.rejects(verifyStarterPack(root), new RegExp(SWITCH_ACTION));

	await writeFile(resolve(plugin, "manifest.json"), `${JSON.stringify({ Actions: [{ UUID: SWITCH_ACTION }] })}\n`);
	await verifyStarterPack(root);
});

async function createPlugin(path: string, version: string): Promise<void> {
	await mkdir(path);
	await writeFile(resolve(path, "manifest.json"), `${JSON.stringify({ UUID: PLUGIN_UUID })}\n`);
	await writeFile(resolve(path, "version.txt"), `${version}\n`);
}

async function temporaryDirectory(context: { after(callback: () => Promise<void>): void }): Promise<string> {
	const path = await mkdtemp(resolve(tmpdir(), "opendeck-hdmi-setup-"));
	context.after(() => rm(path, { force: true, recursive: true }));
	return path;
}
