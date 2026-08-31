import assert from "node:assert/strict";
import { it } from "node:test";

import { createProfile } from "../scripts/profile.js";

it("creates the requested four-row Stream Deck XL layout", () => {
	const profile = createProfile() as {
		keys: Array<{
			action?: { uuid?: string };
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
	assert.equal(profile.keys[18]?.settings?.role, "arc");
	assert.equal(profile.keys[19]?.settings?.role, "mute");
	assert.equal(profile.keys[20]?.settings?.role, "stream");
});
