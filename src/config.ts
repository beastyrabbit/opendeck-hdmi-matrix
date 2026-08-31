import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PluginConfig {
	matrixProfile: string;
	returnProfile: string;
	pollIntervalMs: number;
	requestTimeoutMs: number;
}

export const DEFAULT_CONFIG: PluginConfig = {
	matrixProfile: "HDMI Matrix",
	returnProfile: "Default",
	pollIntervalMs: 4000,
	requestTimeoutMs: 3000,
};

export async function loadConfig(configPath = resolve(process.cwd(), "config.json")): Promise<PluginConfig> {
	try {
		const value = JSON.parse(await readFile(configPath, "utf8")) as Partial<PluginConfig>;
		return {
			matrixProfile: value.matrixProfile ?? DEFAULT_CONFIG.matrixProfile,
			returnProfile: value.returnProfile ?? DEFAULT_CONFIG.returnProfile,
			pollIntervalMs: value.pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs,
			requestTimeoutMs: value.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs,
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}
