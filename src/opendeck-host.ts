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
	private readonly images = new Map<string, string>();
	private handler?: EventHandler;

	constructor(argumentsList = process.argv.slice(2)) {
		this.registration = parseRegistrationArguments(argumentsList);
		this.socket = new WebSocket(`ws://127.0.0.1:${this.registration.port}`);
	}

	onEvent(handler: EventHandler): void {
		this.handler = handler;
	}

	async connect(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.socket.once("error", reject);
			this.socket.once("open", () => {
				this.send({ event: this.registration.registerEvent, uuid: this.registration.pluginUuid });
				resolve();
			});
		});
		this.socket.on("message", (message) => {
			try {
				const event = JSON.parse(message.toString()) as OpenDeckEvent;
				Promise.resolve(this.handler?.(event)).catch((error: unknown) => this.log(error));
			} catch (error) {
				this.log(error);
			}
		});
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
