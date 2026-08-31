import { loadConfig } from "./config.js";
import { MatrixController } from "./controller.js";
import { MatrixApi } from "./matrix-api.js";
import { OpenDeckHost } from "./opendeck-host.js";

async function main(): Promise<void> {
	const config = await loadConfig();
	const host = new OpenDeckHost();
	const controller = new MatrixController(host, new MatrixApi(config.matrixUrl, config.requestTimeoutMs), config);

	host.onEvent((event) => controller.handle(event));
	await host.connect();
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
