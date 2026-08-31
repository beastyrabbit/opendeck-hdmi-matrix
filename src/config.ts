import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PluginConfig {
	matrixUrl: string;
	matrixProfile: string;
	returnProfile: string;
	pollIntervalMs: number;
	requestTimeoutMs: number;
}

export const DEFAULT_CONFIG: PluginConfig = {
	matrixUrl: "http://192.168.1.100",
	matrixProfile: "HDMI Matrix",
	returnProfile: "Default",
	pollIntervalMs: 4000,
	requestTimeoutMs: 3000,
};

export async function loadConfig(configPath = resolve(process.cwd(), "config.json")): Promise<PluginConfig> {
	try {
		const value = JSON.parse(await readFile(configPath, "utf8")) as Partial<PluginConfig>;
		return {
			...DEFAULT_CONFIG,
			...value,
			matrixUrl: (value.matrixUrl ?? DEFAULT_CONFIG.matrixUrl).replace(/\/$/, ""),
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}
