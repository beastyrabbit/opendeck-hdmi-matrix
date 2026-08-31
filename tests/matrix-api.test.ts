import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDailyPreset, isInputActive, isOutputActive, MatrixApi } from "../src/matrix-api.js";
import { snapshot } from "./fixtures.js";

describe("MatrixApi", () => {
	it("uses the device's video-switch command and one-based ports", async () => {
		const requests: Array<{ body: string; url: string }> = [];
		const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ body: String(init?.body), url: String(input) });
			return new Response(JSON.stringify({ result: 1 }));
		};
		const api = new MatrixApi("http://matrix/", 1000, fetchMock as typeof fetch);

		await api.route(5, 4);

		assert.equal(requests[0]?.url, "http://matrix/cgi-bin/instr");
		assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
			comhead: "video switch",
			language: 0,
			source: [5, 4],
		});
	});

	it("rejects invalid ports before contacting the matrix", async () => {
		const api = new MatrixApi("http://matrix", 1000, (() => {
			throw new Error("must not fetch");
		}) as typeof fetch);
		await assert.rejects(() => api.setStream(0, false), /between 1 and 8/);
	});

	it("serializes status requests for the single-command device API", async () => {
		let active = 0;
		let highestConcurrency = 0;
		const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
			active += 1;
			highestConcurrency = Math.max(highestConcurrency, active);
			await new Promise((resolve) => setTimeout(resolve, 2));
			active -= 1;
			const command = JSON.parse(String(init?.body)).comhead as string;
			const responses: Record<string, object> = {
				"get input status": { comhead: command, inactive: [], inname: [], power: 1 },
				"get output status": {
					allarc: [],
					allaudiomute: [],
					allconnect: [],
					allout: [],
					comhead: command,
					name: [],
					power: 1,
				},
				"get video status": {
					allinputname: [],
					allname: [],
					alloutputname: [],
					allsource: [],
					comhead: command,
					power: 1,
				},
			};
			return new Response(JSON.stringify(responses[command]));
		};
		const api = new MatrixApi("http://matrix", 1000, fetchMock as typeof fetch);

		await api.snapshot();

		assert.equal(highestConcurrency, 1);
	});
});

describe("status helpers", () => {
	it("recognizes connected outputs and signal-carrying inputs", () => {
		const value = snapshot();
		assert.equal(isOutputActive(value, 5), true);
		assert.equal(isOutputActive(value, 6), false);
		assert.equal(isInputActive(value, 3), true);
		assert.equal(isInputActive(value, 4), false);
	});

	it("hides untouched factory preset names", () => {
		assert.equal(isDailyPreset("Normal OP", 1), true);
		assert.equal(isDailyPreset("Preset3", 3), false);
		assert.equal(isDailyPreset("setting 4", 4), false);
	});
});
