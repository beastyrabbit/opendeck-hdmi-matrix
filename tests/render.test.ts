import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderControl, renderOutput } from "../src/render.js";
import { snapshot } from "./fixtures.js";

describe("Stream Deck key rendering", () => {
	it("uses large port and device labels", () => {
		const svg = decode(renderOutput(snapshot(), 1, true));
		assert.match(svg, /font-size="27"[^>]*>O1<\/text>/);
		assert.match(svg, /font-size="28"/);
	});

	it("renders ARC, mute, and output states with icons and explicit text", () => {
		for (const control of ["arc", "mute", "stream"] as const) {
			const activeSvg = decode(renderControl(control, true, 1));
			const inactiveSvg = decode(renderControl(control, false, 1));
			const label = control.toUpperCase();
			assert.match(activeSvg, new RegExp(`>${label} ON</text>`));
			assert.match(inactiveSvg, new RegExp(`>${label} OFF</text>`));
			assert.match(activeSvg, /<path|<rect/);
		}
	});
});

function decode(dataUrl: string): string {
	return Buffer.from(dataUrl.split(",")[1] ?? "", "base64").toString("utf8");
}
