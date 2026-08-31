import assert from "node:assert/strict";
import { it } from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import { ACTION_LAUNCHER, ACTION_PANEL, MatrixController } from "../src/controller.js";
import type { MatrixApi } from "../src/matrix-api.js";
import type { OpenDeckHost } from "../src/opendeck-host.js";
import { snapshot } from "./fixtures.js";

it("selects an output and routes the pressed active input", async () => {
	const routes: number[][] = [];
	const images: string[] = [];
	const api = {
		recallPreset: async () => {},
		route: async (output: number, input: number) => routes.push([output, input]),
		setArc: async () => {},
		setMute: async () => {},
		setStream: async () => {},
		snapshot: async () => snapshot(),
	};
	const host = {
		log: () => {},
		setImage: (_context: string, image: string) => images.push(image),
		showAlert: () => {},
		showOk: () => {},
		switchProfile: () => {},
	};
	const controller = new MatrixController(host as unknown as OpenDeckHost, api as unknown as MatrixApi, DEFAULT_CONFIG);

	await controller.handle(event("willAppear", "output-2", { index: 2, role: "output" }));
	await controller.handle(event("willAppear", "input-3", { index: 3, role: "input" }));
	await controller.handle(event("keyUp", "output-2", { index: 2, role: "output" }));
	await controller.handle(event("keyUp", "input-3", { index: 3, role: "input" }));
	await controller.handle(event("willDisappear", "output-2", {}));
	await controller.handle(event("willDisappear", "input-3", {}));

	assert.deepEqual(routes, [[2, 3]]);
	assert.ok(images.length >= 2);
});

function event(type: string, context: string, settings: { index?: number; role?: string }) {
	return {
		action: ACTION_PANEL,
		context,
		device: "deck-xl",
		event: type,
		payload: { settings },
	};
}

it("opens the Matrix profile and uses Stream off as disconnect", async () => {
	const profiles: string[] = [];
	const streams: Array<[number, boolean]> = [];
	const api = {
		recallPreset: async () => {},
		route: async () => {},
		setArc: async () => {},
		setMute: async () => {},
		setStream: async (output: number, enabled: boolean) => streams.push([output, enabled]),
		snapshot: async () => snapshot(),
	};
	const host = {
		log: () => {},
		setImage: () => {},
		showAlert: () => {},
		showOk: () => {},
		switchProfile: (_device: string, profile: string) => profiles.push(profile),
	};
	const controller = new MatrixController(host as unknown as OpenDeckHost, api as unknown as MatrixApi, DEFAULT_CONFIG);

	await controller.handle({ action: ACTION_LAUNCHER, context: "open", device: "deck-xl", event: "keyUp" });
	await controller.handle(event("willAppear", "stream", { role: "stream" }));
	await controller.handle(event("keyUp", "stream", { role: "stream" }));
	await controller.handle(event("willDisappear", "stream", {}));

	assert.deepEqual(profiles, ["HDMI Matrix"]);
	assert.deepEqual(streams, [[1, false]]);
});

it("does not mutate a route or control when no output is connected", async () => {
	const calls: string[] = [];
	const okCalls: string[] = [];
	const disconnected = snapshot();
	disconnected.output.allconnect.fill(0);
	const api = {
		recallPreset: async () => {},
		route: async () => calls.push("route"),
		setArc: async () => calls.push("arc"),
		setMute: async () => calls.push("mute"),
		setStream: async () => calls.push("stream"),
		snapshot: async () => disconnected,
	};
	const controller = new MatrixController(
		hostStub(okCalls) as unknown as OpenDeckHost,
		api as unknown as MatrixApi,
		DEFAULT_CONFIG,
	);

	await controller.handle(event("willAppear", "input", { index: 1, role: "input" }));
	for (const role of ["input", "arc", "mute", "stream"]) {
		await controller.handle(event("keyUp", role, { index: role === "input" ? 1 : undefined, role }));
	}
	await controller.handle(event("willDisappear", "input", {}));

	assert.deepEqual(calls, []);
	assert.deepEqual(okCalls, []);
});

it("clears a selection when its output disconnects", async () => {
	const calls: string[] = [];
	const okCalls: string[] = [];
	let current = snapshot();
	const api = {
		recallPreset: async () => {},
		route: async () => calls.push("route"),
		setArc: async () => calls.push("arc"),
		setMute: async () => calls.push("mute"),
		setStream: async () => calls.push("stream"),
		snapshot: async () => current,
	};
	const controller = new MatrixController(
		hostStub(okCalls) as unknown as OpenDeckHost,
		api as unknown as MatrixApi,
		DEFAULT_CONFIG,
	);

	await controller.handle(event("willAppear", "output-2", { index: 2, role: "output" }));
	await controller.handle(event("keyUp", "output-2", { index: 2, role: "output" }));
	current = snapshot();
	current.output.allconnect[1] = 0;
	await controller.refresh();
	for (const role of ["input", "arc", "mute", "stream"]) {
		await controller.handle(event("keyUp", role, { index: role === "input" ? 1 : undefined, role }));
	}
	await controller.handle(event("willDisappear", "output-2", {}));

	assert.deepEqual(calls, []);
	assert.deepEqual(okCalls, ["ok"]);
});

function hostStub(okCalls: string[] = []) {
	return {
		log: () => {},
		setImage: () => {},
		showAlert: () => {},
		showOk: () => okCalls.push("ok"),
		switchProfile: () => {},
	};
}
