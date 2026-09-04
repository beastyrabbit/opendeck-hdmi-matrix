import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	isDailyPreset,
	isInputActive,
	isOutputActive,
	MAX_MATRIX_RESPONSE_BYTES,
	MatrixApi,
	normalizeMatrixUrl,
} from "../src/matrix-api.js";
import { snapshot } from "./fixtures.js";

describe("MatrixApi", () => {
	it("uses the device's video-switch command and one-based ports", async () => {
		const requests: Array<{ body: string; redirect: RequestRedirect | undefined; url: string }> = [];
		const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ body: String(init?.body), redirect: init?.redirect, url: String(input) });
			return new Response(JSON.stringify({ result: 1 }));
		};
		const api = new MatrixApi("http://matrix/", 1000, fetchMock as typeof fetch);

		await api.route(5, 4);

		assert.equal(requests[0]?.url, "http://matrix/cgi-bin/instr");
		assert.equal(requests[0]?.redirect, "error");
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
		const expected = snapshot();
		const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
			active += 1;
			highestConcurrency = Math.max(highestConcurrency, active);
			await new Promise((resolve) => setTimeout(resolve, 2));
			active -= 1;
			const command = JSON.parse(String(init?.body)).comhead as string;
			const responses: Record<string, object> = {
				"get input status": expected.input,
				"get output status": expected.output,
				"get video status": expected.video,
			};
			return new Response(JSON.stringify(responses[command]));
		};
		const api = new MatrixApi("http://matrix", 1000, fetchMock as typeof fetch);

		await api.snapshot();

		assert.equal(highestConcurrency, 1);
	});

	it("rejects an oversized response without retrying or buffering the remainder", async () => {
		let calls = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
			start(controller) {
				controller.enqueue(new Uint8Array(MAX_MATRIX_RESPONSE_BYTES));
				controller.enqueue(new Uint8Array([0]));
			},
		});
		const api = new MatrixApi("http://matrix", 1000, (async () => {
			calls += 1;
			return new Response(body);
		}) as typeof fetch);

		await assert.rejects(() => api.snapshot(), /exceeds 65536 bytes/);
		assert.equal(calls, 1);
		assert.equal(cancelled, true);
	});

	it("rejects valid JSON whose status shape cannot be rendered safely", async () => {
		let calls = 0;
		const api = new MatrixApi("http://matrix", 1000, (async () => {
			calls += 1;
			return new Response(JSON.stringify({ comhead: "get input status", inactive: [] }));
		}) as typeof fetch);

		await assert.rejects(() => api.snapshot(), /invalid response for get input status/);
		assert.equal(calls, 3);
	});

	it("requires an affirmative command acknowledgement", async () => {
		const api = new MatrixApi("http://matrix", 1000, (async () => new Response("null")) as typeof fetch);

		await assert.rejects(() => api.route(1, 1), /invalid response for video switch/);
	});

	it("rejects a negative command acknowledgement", async () => {
		let calls = 0;
		const api = new MatrixApi("http://matrix", 1000, (async () => {
			calls += 1;
			return new Response(JSON.stringify({ result: 0 }));
		}) as typeof fetch);

		await assert.rejects(() => api.route(1, 1), /invalid response for video switch/);
		assert.equal(calls, 3);
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

it("normalizes a Matrix web-interface URL to its HTTP origin", () => {
	assert.equal(normalizeMatrixUrl("http://matrix.local/#/status"), "http://matrix.local");
	assert.throws(() => normalizeMatrixUrl("ftp://matrix.local"), /HTTP or HTTPS/);
});
