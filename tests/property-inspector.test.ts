import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import vm from "node:vm";

const inspectorSource = await readFile(
	new URL("../plugin/property-inspector/property-inspector.js", import.meta.url),
	"utf8",
);

describe("Property Inspector", () => {
	it("enables settings only while its OpenDeck socket is open", () => {
		const inspector = createInspector();
		inspector.connect();
		assert.equal(inspector.input.disabled, true);
		assert.equal(inspector.button.disabled, true);

		inspector.socket.open();
		assert.equal(inspector.input.disabled, false);
		assert.equal(inspector.button.disabled, false);

		inspector.socket.close();
		assert.equal(inspector.input.disabled, true);
		assert.equal(inspector.button.disabled, true);
		assert.equal(inspector.form.dataset.ariaBusy, "false");
		assert.equal(inspector.status.textContent, "Disconnected from OpenDeck.");
		assert.equal(inspector.status.dataset.error, "true");
	});

	it("disables settings when the OpenDeck socket errors", () => {
		const inspector = createInspector();
		inspector.connect();
		inspector.socket.open();
		inspector.socket.error();

		assert.equal(inspector.input.disabled, true);
		assert.equal(inspector.button.disabled, true);
		assert.equal(inspector.form.dataset.ariaBusy, "false");
		assert.equal(inspector.status.textContent, "Could not connect to OpenDeck.");
		assert.equal(inspector.status.dataset.error, "true");
	});

	it("reports a save only after OpenDeck returns the same global setting", () => {
		const inspector = createInspector();
		inspector.connect();
		inspector.socket.open();
		inspector.input.value = "http://matrix.local/path";
		inspector.form.dispatch("submit", { preventDefault() {} });

		assert.equal(inspector.status.textContent, "Saving connection…");
		assert.equal(inspector.input.disabled, true);
		assert.equal(inspector.button.disabled, true);
		assert.deepEqual(inspector.socket.sent.slice(-2).map(parseMessage), [
			{
				context: "action-context",
				event: "setGlobalSettings",
				payload: { matrixUrl: "http://matrix.local" },
			},
			{ context: "action-context", event: "getGlobalSettings" },
		]);

		inspector.socket.message({
			event: "didReceiveGlobalSettings",
			payload: { settings: { matrixUrl: "http://previous-matrix.local" } },
		});
		assert.equal(inspector.status.textContent, "Saving connection…");
		assert.equal(inspector.input.value, "http://matrix.local");

		inspector.socket.message({
			event: "didReceiveGlobalSettings",
			payload: { settings: { matrixUrl: "http://matrix.local" } },
		});
		assert.equal(inspector.status.textContent, "Connection saved.");
		assert.equal(inspector.input.disabled, false);
		assert.equal(inspector.button.disabled, false);
	});

	it("reports a missing save confirmation without claiming success", () => {
		const inspector = createInspector();
		inspector.connect();
		inspector.socket.open();
		inspector.input.value = "http://matrix.local";
		inspector.form.dispatch("submit", { preventDefault() {} });
		inspector.runTimers();

		assert.equal(inspector.status.textContent, "OpenDeck did not confirm the saved connection.");
		assert.equal(inspector.status.dataset.error, "true");
		assert.equal(inspector.input.disabled, false);
		assert.equal(inspector.button.disabled, false);
		assert.equal(inspector.form.dataset.ariaBusy, "false");
	});

	it("does not claim success when sending settings fails", () => {
		const inspector = createInspector();
		inspector.connect();
		inspector.socket.open();
		inspector.socket.failNextSend = true;
		inspector.input.value = "https://matrix.local";
		inspector.form.dispatch("submit", { preventDefault() {} });

		assert.equal(inspector.status.textContent, "Could not send settings to OpenDeck.");
		assert.equal(inspector.status.dataset.error, "true");
		assert.equal(inspector.input.disabled, false);
		assert.equal(inspector.button.disabled, false);
	});
});

interface FakeEvent {
	data?: string;
}

class FakeElement {
	dataset: Record<string, string> = {};
	disabled = false;
	textContent = "";
	value = "";
	private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	reportValidity(): boolean {
		return true;
	}

	setAttribute(name: string, value: string): void {
		if (name === "aria-busy") this.dataset.ariaBusy = value;
	}
}

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	failNextSend = false;
	readyState = FakeWebSocket.CONNECTING;
	readonly sent: string[] = [];
	private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

	constructor(readonly url: string) {}

	addEventListener(type: string, listener: (event: FakeEvent) => void): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.dispatch("open", {});
	}

	close(): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.dispatch("close", {});
	}

	error(): void {
		this.dispatch("error", {});
	}

	message(value: object): void {
		this.dispatch("message", { data: JSON.stringify(value) });
	}

	send(value: string): void {
		if (this.failNextSend) {
			this.failNextSend = false;
			throw new Error("send failed");
		}
		this.sent.push(value);
	}

	private dispatch(type: string, event: FakeEvent): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

function createInspector() {
	const form = new FakeElement();
	const input = new FakeElement();
	const button = new FakeElement();
	const status = new FakeElement();
	const elements: Record<string, FakeElement> = {
		"matrix-url": input,
		"settings-form": form,
		status,
	};
	let socket: FakeWebSocket | undefined;
	class InspectorWebSocket extends FakeWebSocket {
		static readonly OPEN = FakeWebSocket.OPEN;
		constructor(url: string) {
			super(url);
			socket = this;
		}
	}
	const window: Record<string, unknown> = {};
	let nextTimeoutId = 0;
	const timers = new Map<number, () => void>();
	const sandbox = {
		Error,
		JSON,
		URL,
		WebSocket: InspectorWebSocket,
		clearTimeout: (id: number | undefined) => timers.delete(id ?? -1),
		document: {
			getElementById: (id: string) => elements[id],
			querySelector: () => button,
		},
		setTimeout: (callback: () => void, delay: number) => {
			void delay;
			nextTimeoutId += 1;
			const id = nextTimeoutId;
			timers.set(id, callback);
			return id;
		},
		window,
	};
	vm.runInNewContext(inspectorSource, sandbox);

	return {
		button,
		connect() {
			const connect = window.connectElgatoStreamDeckSocket as (...args: string[]) => void;
			connect("24680", "property-inspector", "registerPropertyInspector", "{}", '{"context":"action-context"}');
			assert.ok(socket);
		},
		form,
		input,
		runTimers() {
			for (const callback of timers.values()) callback();
			timers.clear();
		},
		get socket(): FakeWebSocket {
			assert.ok(socket);
			return socket;
		},
		status,
	};
}

function parseMessage(value: string): unknown {
	return JSON.parse(value) as unknown;
}
