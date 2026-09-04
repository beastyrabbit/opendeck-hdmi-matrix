import WebSocket from "ws";

export interface Coordinates {
	column: number;
	row: number;
}

export interface ActionSettings {
	index?: number;
	role?: string;
}

export interface GlobalSettings {
	matrixUrl?: string;
}

export interface OpenDeckEvent {
	action?: string;
	context?: string;
	device?: string;
	event: string;
	payload?: {
		coordinates?: Coordinates;
		settings?: ActionSettings & GlobalSettings;
	};
}

export type EventHandler = (event: OpenDeckEvent) => Promise<void> | void;

interface RegistrationArguments {
	pluginUuid: string;
	port: string;
	registerEvent: string;
}

export class OpenDeckHost {
	private readonly registration: RegistrationArguments;
	private readonly socket: WebSocket;
	private readonly closed: Promise<void>;
	private readonly images = new Map<string, string>();
	private handler?: EventHandler;
	private connectPromise?: Promise<void>;
	private connected = false;

	constructor(argumentsList = process.argv.slice(2)) {
		this.registration = parseRegistrationArguments(argumentsList);
		this.socket = new WebSocket(`ws://127.0.0.1:${this.registration.port}`);
		this.closed = new Promise((resolve) => {
			this.socket.once("close", () => {
				this.connected = false;
				resolve();
			});
		});
		this.socket.on("error", (error) => {
			if (this.connected) {
				console.error(`OpenDeck WebSocket error: ${error.message}`);
				this.socket.terminate();
			}
		});
	}

	onEvent(handler: EventHandler): void {
		this.handler = handler;
	}

	async connect(): Promise<void> {
		this.connectPromise ??= this.openAndRegister();
		await this.connectPromise;
	}

	waitUntilClosed(): Promise<void> {
		return this.closed;
	}

	setImage(context: string, image: string): void {
		if (this.images.get(context) === image) return;
		this.images.set(context, image);
		this.send({ context, event: "setImage", payload: { image, target: 0 } });
	}

	showAlert(context: string): void {
		this.send({ context, event: "showAlert" });
	}

	showOk(context: string): void {
		this.send({ context, event: "showOk" });
	}

	getGlobalSettings(): void {
		this.send({ context: this.registration.pluginUuid, event: "getGlobalSettings" });
	}

	log(error: unknown): void {
		const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
		this.send({ event: "logMessage", payload: { message } });
	}

	private send(value: object): void {
		if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
	}

	private async openAndRegister(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				this.socket.off("open", onOpen);
				this.socket.off("error", onError);
				this.socket.off("close", onClose);
			};
			const onOpen = () => {
				cleanup();
				this.connected = true;
				resolve();
			};
			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};
			const onClose = () => {
				cleanup();
				reject(new Error("OpenDeck WebSocket closed before registration"));
			};
			this.socket.once("open", onOpen);
			this.socket.once("error", onError);
			this.socket.once("close", onClose);
		});

		this.socket.on("message", (message) => {
			try {
				const event = JSON.parse(message.toString()) as OpenDeckEvent;
				Promise.resolve(this.handler?.(event)).catch((error: unknown) => this.log(error));
			} catch (error) {
				this.log(error);
			}
		});
		this.socket.send(JSON.stringify({ event: this.registration.registerEvent, uuid: this.registration.pluginUuid }));
	}
}

function parseRegistrationArguments(argumentsList: string[]): RegistrationArguments {
	const value = (name: string): string => {
		const index = argumentsList.indexOf(name);
		const result = index >= 0 ? argumentsList[index + 1] : undefined;
		if (!result) throw new Error(`Missing OpenDeck argument ${name}`);
		return result;
	};
	return {
		pluginUuid: value("-pluginUUID"),
		port: value("-port"),
		registerEvent: value("-registerEvent"),
	};
}
