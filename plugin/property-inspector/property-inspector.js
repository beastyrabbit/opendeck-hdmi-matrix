let socket;
let context = "";
let pendingMatrixUrl;
let confirmationTimer;

const CONFIRMATION_TIMEOUT_MS = 3000;

function connectElgatoStreamDeckSocket(port, propertyInspectorUuid, registerEvent, info, actionInfo) {
	void info;
	const action = JSON.parse(actionInfo);
	const device = action.device;
	const profile = action.payload?.settings?.profile;
	context = device && profile ? `${device}.${profile}.Keypad.0.0` : action.context || propertyInspectorUuid;

	const form = document.getElementById("settings-form");
	form.addEventListener("submit", saveSettings);
	setConnected(false);
	showStatus("Connecting to OpenDeck…");

	socket = new WebSocket(`ws://localhost:${port}`);
	socket.addEventListener("open", () => {
		try {
			socket.send(JSON.stringify({ event: registerEvent, uuid: context }));
			socket.send(JSON.stringify({ context, event: "getGlobalSettings" }));
			setConnected(true);
			showStatus("Connected to OpenDeck.");
		} catch {
			handleDisconnect("Could not connect to OpenDeck.");
		}
	});
	socket.addEventListener("message", receiveMessage);
	socket.addEventListener("error", () => handleDisconnect("Could not connect to OpenDeck."));
	socket.addEventListener("close", () => handleDisconnect("Disconnected from OpenDeck."));
}

function saveSettings(event) {
	event.preventDefault();
	const input = document.getElementById("matrix-url");
	if (!input.reportValidity()) return;
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		handleDisconnect("Not connected to OpenDeck.");
		return;
	}

	let matrixUrl;
	try {
		const parsed = new URL(input.value.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Use an HTTP or HTTPS address.");
		}
		matrixUrl = parsed.origin;
	} catch (error) {
		showStatus(error instanceof Error ? error.message : "Enter a valid URL.", true);
		return;
	}

	input.value = matrixUrl;
	pendingMatrixUrl = matrixUrl;
	setSaving(true);
	try {
		socket.send(JSON.stringify({ context, event: "setGlobalSettings", payload: { matrixUrl } }));
		socket.send(JSON.stringify({ context, event: "getGlobalSettings" }));
		startConfirmationTimer();
		showStatus("Saving connection…");
	} catch {
		clearPendingSave();
		if (!socket || socket.readyState !== WebSocket.OPEN) setConnected(false);
		showStatus("Could not send settings to OpenDeck.", true);
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
	if (typeof matrixUrl !== "string") return;
	if (pendingMatrixUrl !== undefined) {
		if (matrixUrl !== pendingMatrixUrl) return;
		document.getElementById("matrix-url").value = matrixUrl;
		clearPendingSave();
		showStatus("Connection saved.");
		return;
	}
	document.getElementById("matrix-url").value = matrixUrl;
}

function showStatus(message, error = false) {
	const status = document.getElementById("status");
	if (status.textContent === message && status.dataset.error === String(error)) return;
	status.textContent = message;
	status.dataset.error = String(error);
}

function setConnected(connected) {
	document.getElementById("matrix-url").disabled = !connected;
	document.querySelector('#settings-form button[type="submit"]').disabled = !connected;
}

function setSaving(saving) {
	document.getElementById("matrix-url").disabled = saving;
	document.querySelector('#settings-form button[type="submit"]').disabled = saving;
	document.getElementById("settings-form").setAttribute("aria-busy", String(saving));
}

function startConfirmationTimer() {
	clearTimeout(confirmationTimer);
	confirmationTimer = setTimeout(() => {
		if (pendingMatrixUrl === undefined) return;
		clearPendingSave();
		showStatus("OpenDeck did not confirm the saved connection.", true);
	}, CONFIRMATION_TIMEOUT_MS);
}

function clearPendingSave() {
	pendingMatrixUrl = undefined;
	clearTimeout(confirmationTimer);
	confirmationTimer = undefined;
	setSaving(false);
}

function handleDisconnect(message) {
	clearPendingSave();
	setConnected(false);
	showStatus(message, true);
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
