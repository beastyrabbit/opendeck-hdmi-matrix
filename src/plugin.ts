import { loadConfig } from "./config.js";
import { MatrixController } from "./controller.js";
import { MatrixApi } from "./matrix-api.js";
import { type GlobalSettings, OpenDeckHost } from "./opendeck-host.js";

async function main(): Promise<void> {
	const config = await loadConfig();
	const host = new OpenDeckHost();
	const controller = new MatrixController(host, undefined, config);

	host.onEvent(async (event) => {
		if (event.event === "didReceiveGlobalSettings") {
			controller.setApi(createApi(event.payload?.settings ?? {}, config.requestTimeoutMs));
			await controller.refresh();
			return;
		}
		await controller.handle(event);
	});
	try {
		await host.connect();
		host.getGlobalSettings();
		await host.waitUntilClosed();
	} finally {
		controller.dispose();
	}
}

function createApi(settings: GlobalSettings, requestTimeoutMs: number): MatrixApi | undefined {
	try {
		return settings.matrixUrl ? new MatrixApi(settings.matrixUrl, requestTimeoutMs) : undefined;
	} catch (error) {
		console.error(error);
		return undefined;
	}
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
