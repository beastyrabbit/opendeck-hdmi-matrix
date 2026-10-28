export interface InputStatus {
	comhead: "get input status";
	inactive: number[];
	inname: string[];
	power: number;
}

export interface OutputStatus {
	allarc: number[];
	allaudiomute: number[];
	allconnect: number[];
	allout: number[];
	comhead: "get output status";
	name: string[];
	power: number;
}

export interface VideoStatus {
	allinputname: string[];
	allname: string[];
	alloutputname: string[];
	allsource: number[];
	comhead: "get video status";
	power: number;
}

export interface MatrixSnapshot {
	input: InputStatus;
	output: OutputStatus;
	video: VideoStatus;
}

export type Fetch = typeof fetch;

export const MAX_MATRIX_RESPONSE_BYTES = 64 * 1024;

export class MatrixApi {
	readonly baseUrl: string;
	readonly requestTimeoutMs: number;
	readonly fetch: Fetch;
	private pending: Promise<void> = Promise.resolve();

	constructor(baseUrl: string, requestTimeoutMs = 3000, fetchImpl: Fetch = fetch) {
		this.baseUrl = normalizeMatrixUrl(baseUrl);
		this.requestTimeoutMs = requestTimeoutMs;
		this.fetch = fetchImpl;
	}

	async snapshot(): Promise<MatrixSnapshot> {
		const input = await this.command("get input status", {}, parseInputStatus);
		const output = await this.command("get output status", {}, parseOutputStatus);
		const video = await this.command("get video status", {}, parseVideoStatus);
		return { input, output, video };
	}

	async route(output: number, input: number): Promise<void> {
		await this.command("video switch", { source: [port(output), port(input)] }, parseCommandAcknowledgement);
	}

	async recallPreset(index: number): Promise<void> {
		await this.command("preset set", { index: port(index) }, parseCommandAcknowledgement);
	}

	async setArc(output: number, enabled: boolean): Promise<void> {
		await this.command("set arc", { arc: [port(output), Number(enabled)] }, parseCommandAcknowledgement);
	}

	async setMute(output: number, enabled: boolean): Promise<void> {
		await this.command("set output audio mute", { mute: [port(output), Number(enabled)] }, parseCommandAcknowledgement);
	}

	async setStream(output: number, enabled: boolean): Promise<void> {
		await this.command("tx stream", { out: [port(output), Number(enabled)] }, parseCommandAcknowledgement);
	}

	private command<T>(comhead: string, fields: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
		const result = this.pending.then(() => this.request(comhead, fields, parse));
		this.pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async request<T>(comhead: string, fields: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(`${this.baseUrl}/cgi-bin/instr`, {
				body: JSON.stringify({ comhead, language: 0, ...fields }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(this.requestTimeoutMs),
			});

			if (!response.ok) throw new Error(`Matrix request failed (${response.status})`);
			try {
				const text = await readBoundedResponse(response);
				return parse(JSON.parse(text) as unknown);
			} catch (error) {
				if (error instanceof ResponseTooLargeError) throw error;
				if (attempt === 3) throw new Error(`Matrix returned an invalid response for ${comhead}`, { cause: error });
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
		}
		throw new Error(`Matrix request failed for ${comhead}`);
	}
}

class ResponseTooLargeError extends Error {
	constructor() {
		super(`Matrix response exceeds ${MAX_MATRIX_RESPONSE_BYTES} bytes`);
		this.name = "ResponseTooLargeError";
	}
}

async function readBoundedResponse(response: Response): Promise<string> {
	const contentLength = response.headers.get("content-length");
	if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_MATRIX_RESPONSE_BYTES) {
		await response.body?.cancel().catch(() => undefined);
		throw new ResponseTooLargeError();
	}

	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let byteLength = 0;
	let result = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		byteLength += value.byteLength;
		if (byteLength > MAX_MATRIX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new ResponseTooLargeError();
		}
		result += decoder.decode(value, { stream: true });
	}
	return result + decoder.decode();
}

function parseInputStatus(value: unknown): InputStatus {
	const response = objectValue(value);
	return {
		comhead: literal(response.comhead, "get input status"),
		inactive: numberArray(response.inactive, "inactive"),
		inname: stringArray(response.inname, "inname"),
		power: finiteNumber(response.power, "power"),
	};
}

function parseOutputStatus(value: unknown): OutputStatus {
	const response = objectValue(value);
	return {
		allarc: numberArray(response.allarc, "allarc"),
		allaudiomute: numberArray(response.allaudiomute, "allaudiomute"),
		allconnect: numberArray(response.allconnect, "allconnect"),
		allout: numberArray(response.allout, "allout"),
		comhead: literal(response.comhead, "get output status"),
		name: stringArray(response.name, "name"),
		power: finiteNumber(response.power, "power"),
	};
}

function parseVideoStatus(value: unknown): VideoStatus {
	const response = objectValue(value);
	return {
		allinputname: stringArray(response.allinputname, "allinputname"),
		allname: stringArray(response.allname, "allname"),
		alloutputname: stringArray(response.alloutputname, "alloutputname"),
		allsource: numberArray(response.allsource, "allsource"),
		comhead: literal(response.comhead, "get video status"),
		power: finiteNumber(response.power, "power"),
	};
}

function parseCommandAcknowledgement(value: unknown): void {
	const response = objectValue(value);
	if (response.result !== 1) throw new Error("Matrix did not acknowledge the command");
}

function objectValue(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("expected an object");
	return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${field} must be a finite number`);
	return value;
}

function numberArray(value: unknown, field: string): number[] {
	if (!Array.isArray(value) || value.length < 8) throw new TypeError(`${field} must contain at least eight values`);
	return value.map((entry) => finiteNumber(entry, field));
}

function stringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length < 8 || value.some((entry) => typeof entry !== "string")) {
		throw new TypeError(`${field} must contain at least eight strings`);
	}
	return value as string[];
}

function literal<T extends string>(value: unknown, expected: T): T {
	if (value !== expected) throw new TypeError(`comhead must be ${expected}`);
	return expected;
}

export function normalizeMatrixUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Matrix URL must use HTTP or HTTPS.");
	}
	return url.origin;
}

function port(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > 8) {
		throw new RangeError(`Matrix port must be between 1 and 8, got ${value}`);
	}
	return value;
}

export function isInputActive(snapshot: MatrixSnapshot, index: number): boolean {
	return snapshot.input.inactive[index - 1] === 1;
}

export function isOutputActive(snapshot: MatrixSnapshot, index: number): boolean {
	return snapshot.output.allconnect[index - 1] === 1;
}

export function isDailyPreset(name: string | undefined, index: number): boolean {
	if (!name?.trim()) return false;
	return !new RegExp(`^(preset|setting)\\s*${index}$`, "i").test(name.trim());
}
