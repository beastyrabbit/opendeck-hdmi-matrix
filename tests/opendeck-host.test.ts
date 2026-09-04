import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { it } from "node:test";
import { type WebSocket, WebSocketServer } from "ws";

import { OpenDeckHost } from "../src/opendeck-host.js";

it("registers with OpenDeck and resolves its lifecycle when the socket closes", async () => {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const port = (server.address() as AddressInfo).port;
	let peer: WebSocket | undefined;
	const registration = new Promise<unknown>((resolve) => {
		server.once("connection", (socket) => {
			peer = socket;
			socket.once("message", (data) => resolve(JSON.parse(data.toString()) as unknown));
		});
	});
	const host = new OpenDeckHost([
		"-port",
		String(port),
		"-pluginUUID",
		"com.beastyrabbit.hdmi-matrix",
		"-registerEvent",
		"registerPlugin",
	]);

	try {
		await host.connect();
		assert.deepEqual(await registration, {
			event: "registerPlugin",
			uuid: "com.beastyrabbit.hdmi-matrix",
		});
		assert.ok(peer);
		peer.close();
		await host.waitUntilClosed();
	} finally {
		peer?.terminate();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}
});
