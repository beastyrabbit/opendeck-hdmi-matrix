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

export class MatrixApi {
	readonly baseUrl: string;
	readonly requestTimeoutMs: number;
	readonly fetch: Fetch;
	private pending: Promise<void> = Promise.resolve();

	constructor(baseUrl: string, requestTimeoutMs = 3000, fetchImpl: Fetch = fetch) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.requestTimeoutMs = requestTimeoutMs;
		this.fetch = fetchImpl;
	}

	async snapshot(): Promise<MatrixSnapshot> {
		const input = await this.command<InputStatus>("get input status");
		const output = await this.command<OutputStatus>("get output status");
		const video = await this.command<VideoStatus>("get video status");
		return { input, output, video };
	}

	async route(output: number, input: number): Promise<void> {
		await this.command("video switch", { source: [port(output), port(input)] });
	}

	async recallPreset(index: number): Promise<void> {
		await this.command("preset set", { index: port(index) });
	}

	async setArc(output: number, enabled: boolean): Promise<void> {
		await this.command("set arc", { arc: [port(output), Number(enabled)] });
	}

	async setMute(output: number, enabled: boolean): Promise<void> {
		await this.command("set output audio mute", { mute: [port(output), Number(enabled)] });
	}

	async setStream(output: number, enabled: boolean): Promise<void> {
		await this.command("tx stream", { out: [port(output), Number(enabled)] });
	}

	private command<T = unknown>(comhead: string, fields: Record<string, unknown> = {}): Promise<T> {
		const result = this.pending.then(() => this.request<T>(comhead, fields));
		this.pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private async request<T>(comhead: string, fields: Record<string, unknown>): Promise<T> {
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(`${this.baseUrl}/cgi-bin/instr`, {
				body: JSON.stringify({ comhead, language: 0, ...fields }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
				signal: AbortSignal.timeout(this.requestTimeoutMs),
			});

			if (!response.ok) throw new Error(`Matrix request failed (${response.status})`);
			const text = await response.text();
			try {
				return JSON.parse(text) as T;
			} catch {
				if (attempt === 3) throw new Error(`Matrix returned invalid JSON for ${comhead}: ${text.slice(0, 80)}`);
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
		}
		throw new Error(`Matrix request failed for ${comhead}`);
	}
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
