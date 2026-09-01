import assert from "node:assert/strict";
import { it } from "node:test";

import {
	createProfile,
	isCurrentLauncher,
	isManagedLauncher,
	isManagedMatrixProfile,
	isSameFile,
	isValidProfileName,
	launcherSlot,
	migrateSelectedProfile,
} from "../scripts/profile.js";

it("creates the requested four-row Stream Deck XL layout", () => {
	const profile = createProfile() as {
		keys: Array<{
			action?: { property_inspector?: string; uuid?: string };
			settings?: { index?: number; profile?: string; role?: string };
		} | null>;
	};
	assert.equal(profile.keys.length, 32);
	assert.deepEqual(
		profile.keys.slice(0, 8).map((key) => key?.settings?.role),
		Array(8).fill("output"),
	);
	assert.deepEqual(
		profile.keys.slice(8, 16).map((key) => key?.settings?.role),
		Array(8).fill("preset"),
	);
	assert.deepEqual(
		profile.keys.slice(24, 32).map((key) => key?.settings?.role),
		Array(8).fill("input"),
	);
	assert.equal(profile.keys[16]?.action?.uuid, "com.amansprojects.starterpack.switchprofile");
	assert.equal(profile.keys[16]?.settings?.profile, "Default");
	assert.equal(profile.keys[16]?.action?.property_inspector, "");
	assert.equal(profile.keys[18]?.settings?.role, "arc");
	assert.equal(profile.keys[19]?.settings?.role, "mute");
	assert.equal(profile.keys[20]?.settings?.role, "stream");
	assert.equal(profile.keys[0]?.action?.property_inspector, "");
});

it("creates a user-facing launcher with hidden profile routing", () => {
	const launcher = launcherSlot(3, "Studio Matrix") as {
		action: { property_inspector: string; uuid: string };
		settings: { profile: string };
	};
	assert.equal(launcher.action.uuid, "com.amansprojects.starterpack.switchprofile");
	assert.equal(
		launcher.action.property_inspector,
		"plugins/de.beasty.hdmi-matrix.sdPlugin/property-inspector/index.html",
	);
	assert.equal(launcher.settings.profile, "Studio Matrix");
});

it("reuses the managed launcher when the target profile changes", () => {
	const launcher = launcherSlot(3, "HDMI Matrix");
	assert.equal(isManagedLauncher(launcher, "Studio Matrix"), true);
	assert.equal(isCurrentLauncher(launcher, "Studio Matrix"), false);
	assert.equal(isCurrentLauncher(launcherSlot(3, "Studio Matrix"), "Studio Matrix"), true);
});

it("recognizes the published native launcher when its target profile changes", () => {
	const publishedLauncher = {
		action: {
			icon: "plugins/de.beasty.hdmi-matrix.sdPlugin/icons/launcher.png",
			property_inspector: "plugins/com.amansprojects.starterpack.sdPlugin/propertyInspector/switchProfile.html",
			uuid: "com.amansprojects.starterpack.switchprofile",
		},
		settings: { profile: "HDMI Matrix" },
	};
	assert.equal(isManagedLauncher(publishedLauncher, "Studio/Matrix"), true);
	assert.equal(isCurrentLauncher(publishedLauncher, "Studio/Matrix"), false);
});

it("recognizes only plugin-managed Matrix profiles for migration", () => {
	assert.equal(isManagedMatrixProfile(createProfile()), true);
	assert.equal(isManagedMatrixProfile({ keys: [launcherSlot(0)] }), false);
});

it("recognizes the same profile file across case-only path changes", () => {
	assert.equal(isSameFile({ dev: 1, ino: 42 }, { dev: 1, ino: 42 }), true);
	assert.equal(isSameFile({ dev: 1, ino: 42 }, { dev: 1, ino: 43 }), false);
});

it("updates only a selected profile that is being migrated", () => {
	assert.deepEqual(migrateSelectedProfile({ selected_profile: "HDMI Matrix" }, "HDMI Matrix", "Studio/Matrix"), {
		selected_profile: "Studio/Matrix",
	});
	assert.equal(migrateSelectedProfile({ selected_profile: "Default" }, "HDMI Matrix", "Studio/Matrix"), undefined);
});

it("accepts only profile names supported by generated OpenDeck contexts", () => {
	assert.equal(isValidProfileName("Studio Matrix_2"), true);
	assert.equal(isValidProfileName("Studio/Matrix_2"), true);
	assert.equal(isValidProfileName("Studio.Matrix"), false);
	assert.equal(isValidProfileName("Studio/Room/Matrix"), false);
});
