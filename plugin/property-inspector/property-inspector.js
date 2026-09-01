let socket;
let context = "";

function connectElgatoStreamDeckSocket(port, propertyInspectorUuid, registerEvent, info, actionInfo) {
	void info;
	const action = JSON.parse(actionInfo);
	const device = action.device;
	const profile = action.payload?.settings?.profile;
	context = device && profile ? `${device}.${profile}.Keypad.0.0` : action.context || propertyInspectorUuid;

	const form = document.getElementById("settings-form");
	form.addEventListener("submit", saveSettings);

	socket = new WebSocket(`ws://localhost:${port}`);
	socket.addEventListener("open", () => {
		socket.send(JSON.stringify({ event: registerEvent, uuid: context }));
		socket.send(JSON.stringify({ context, event: "getGlobalSettings" }));
	});
	socket.addEventListener("message", receiveMessage);
	socket.addEventListener("error", () => showStatus("Could not connect to OpenDeck.", true));
}

function saveSettings(event) {
	event.preventDefault();
	const input = document.getElementById("matrix-url");
	if (!input.reportValidity()) return;

	try {
		const parsed = new URL(input.value.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Use an HTTP or HTTPS address.");
		}
		const matrixUrl = parsed.origin;
		input.value = matrixUrl;
		socket.send(JSON.stringify({ context, event: "setGlobalSettings", payload: { matrixUrl } }));
		showStatus("Connection saved.");
	} catch (error) {
		showStatus(error instanceof Error ? error.message : "Enter a valid URL.", true);
	}
}

function receiveMessage(event) {
	let message;
	try {
		message = JSON.parse(event.data);
	} catch {
		return;
	}
	if (message.event !== "didReceiveGlobalSettings") return;
	const matrixUrl = message.payload?.settings?.matrixUrl;
	if (typeof matrixUrl === "string") document.getElementById("matrix-url").value = matrixUrl;
}

function showStatus(message, error = false) {
	const status = document.getElementById("status");
	status.textContent = message;
	status.dataset.error = String(error);
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
