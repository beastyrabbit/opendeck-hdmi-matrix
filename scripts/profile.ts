const PLUGIN = "com.beastyrabbit.hdmi-matrix.sdPlugin";
const ACTION = "com.beastyrabbit.hdmi-matrix.panel";
const LEGACY_PLUGIN = "de.beasty.hdmi-matrix.sdPlugin";
const LEGACY_ACTION = "de.beasty.hdmi-matrix.panel";
const LEGACY_LAUNCHER = "de.beasty.hdmi-matrix.open";
const SWITCH_PLUGIN = "com.amansprojects.starterpack.sdPlugin";
const SWITCH_ACTION = "com.amansprojects.starterpack.switchprofile";
const LAUNCHER_ICON = `plugins/${PLUGIN}/icons/launcher.png`;
const PROPERTY_INSPECTOR = `plugins/${PLUGIN}/property-inspector/index.html`;

interface SlotSettings {
	index?: number;
	role: string;
}

interface ProfileSlot {
	action?: { icon?: string; plugin?: string; property_inspector?: string; uuid?: string };
	context?: string;
	settings?: { index?: number; profile?: string; role?: string };
}

interface FileIdentity {
	dev: bigint | number;
	ino: bigint | number;
}

export function createProfile(returnProfile = "Default"): object {
	const keys: Array<object | null> = Array.from({ length: 32 }, () => null);
	for (let index = 1; index <= 8; index += 1) {
		keys[index - 1] = slot(index - 1, { index, role: "output" });
		keys[8 + index - 1] = slot(8 + index - 1, { index, role: "preset" });
		keys[24 + index - 1] = slot(24 + index - 1, { index, role: "input" });
	}

	keys[16] = profileSwitchSlot(16, returnProfile, "back", false);
	keys[17] = slot(17, { role: "selection" });
	keys[18] = slot(18, { role: "arc" });
	keys[19] = slot(19, { role: "mute" });
	keys[20] = slot(20, { role: "stream" });
	keys[23] = slot(23, { role: "refresh" });

	return { infobars: [], keys, sliders: [] };
}

export function launcherSlot(position: number, profile = "HDMI Matrix"): Record<string, unknown> {
	return profileSwitchSlot(position, profile, "launcher", true);
}

/** Recognize only launcher signatures emitted by this project. */
export function isManagedLauncher(value: unknown, _matrixProfile?: string): boolean {
	const slot = launcher(value);
	const action = slot?.action;
	if (!action) return false;
	if (action.uuid === LEGACY_LAUNCHER) {
		return (
			action.plugin === LEGACY_PLUGIN &&
			action.icon === `plugins/${LEGACY_PLUGIN}/icons/launcher.png` &&
			action.property_inspector === `plugins/${LEGACY_PLUGIN}/property-inspector/index.html`
		);
	}
	if (action.uuid !== SWITCH_ACTION || action.plugin !== SWITCH_PLUGIN) return false;

	const ownedIcons = [LAUNCHER_ICON, `plugins/${LEGACY_PLUGIN}/icons/launcher.png`];
	const knownInspectors = [
		PROPERTY_INSPECTOR,
		`plugins/${LEGACY_PLUGIN}/property-inspector/index.html`,
		`plugins/${SWITCH_PLUGIN}/propertyInspector/switchProfile.html`,
	];
	return ownedIcons.includes(action.icon ?? "") && knownInspectors.includes(action.property_inspector ?? "");
}

export function isCurrentLauncher(value: unknown, matrixProfile: string): boolean {
	const slot = launcher(value);
	return (
		isManagedLauncher(slot) &&
		slot?.action?.uuid === SWITCH_ACTION &&
		slot.action.plugin === SWITCH_PLUGIN &&
		slot.action.icon === LAUNCHER_ICON &&
		slot.action.property_inspector === PROPERTY_INSPECTOR &&
		slot.settings?.profile === matrixProfile
	);
}

/** Check the complete generated layout before setup may replace a same-named file. */
export function isManagedMatrixProfile(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.infobars) || !Array.isArray(value.sliders) || !Array.isArray(value.keys)) return false;
	if (value.keys.length !== 32) return false;

	for (let index = 0; index < 8; index += 1) {
		if (!isMatrixSlot(value.keys[index], index, { index: index + 1, role: "output" })) return false;
		if (!isMatrixSlot(value.keys[index + 8], index + 8, { index: index + 1, role: "preset" })) return false;
		if (!isMatrixSlot(value.keys[index + 24], index + 24, { index: index + 1, role: "input" })) return false;
	}

	if (!isBackSlot(value.keys[16], 16)) return false;
	if (!isMatrixSlot(value.keys[17], 17, { role: "selection" })) return false;
	if (!isMatrixSlot(value.keys[18], 18, { role: "arc" })) return false;
	if (!isMatrixSlot(value.keys[19], 19, { role: "mute" })) return false;
	if (!isMatrixSlot(value.keys[20], 20, { role: "stream" })) return false;
	if (value.keys[21] !== null || value.keys[22] !== null) return false;
	if (!isMatrixSlot(value.keys[23], 23, { role: "refresh" })) return false;
	return true;
}

export function isSameFile(first: FileIdentity, second: FileIdentity): boolean {
	return first.dev === second.dev && first.ino === second.ino;
}

export function migrateSelectedProfile(
	value: unknown,
	previousProfile: string,
	nextProfile: string,
): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	return value.selected_profile === previousProfile ? { ...value, selected_profile: nextProfile } : undefined;
}

export function isValidProfileName(profile: string): boolean {
	return /^[a-zA-Z0-9_ ]+(\/[a-zA-Z0-9_ ]+)?$/.test(profile);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function launcher(value: unknown): ProfileSlot | null {
	return isRecord(value) ? (value as ProfileSlot) : null;
}

function isMatrixSlot(value: unknown, position: number, settings: SlotSettings): boolean {
	const candidate = launcher(value);
	if (!candidate?.action || candidate.context !== `Keypad.${position}.0`) return false;
	const action = candidate.action;
	const identity = matrixIdentity(action.uuid, action.plugin, action.icon);
	if (!identity) return false;
	if (!["", `plugins/${identity}/property-inspector/index.html`].includes(action.property_inspector ?? ""))
		return false;
	if (candidate.settings?.role !== settings.role || candidate.settings.index !== settings.index) return false;
	const expectedKeys = settings.index === undefined ? ["role"] : ["index", "role"];
	return Object.keys(candidate.settings).sort().join(",") === expectedKeys.sort().join(",");
}

function matrixIdentity(
	uuid: string | undefined,
	plugin: string | undefined,
	icon: string | undefined,
): string | undefined {
	for (const identity of [PLUGIN, LEGACY_PLUGIN]) {
		const expectedAction = identity === PLUGIN ? ACTION : LEGACY_ACTION;
		if (uuid === expectedAction && plugin === identity && icon === `plugins/${identity}/icons/panel.png`)
			return identity;
	}
	return undefined;
}

function isBackSlot(value: unknown, position: number): boolean {
	const candidate = launcher(value);
	if (!candidate?.action || candidate.context !== `Keypad.${position}.0`) return false;
	if (candidate.action.uuid !== SWITCH_ACTION || candidate.action.plugin !== SWITCH_PLUGIN) return false;
	if (candidate.action.property_inspector !== "" || !isValidProfileName(candidate.settings?.profile ?? ""))
		return false;
	return [PLUGIN, LEGACY_PLUGIN].some((identity) => candidate.action?.icon === `plugins/${identity}/icons/back.png`);
}

function profileSwitchSlot(
	position: number,
	profile: string,
	iconName: "back" | "launcher",
	showSettings: boolean,
): Record<string, unknown> {
	const icon = `plugins/${PLUGIN}/icons/${iconName}.png`;
	const state = actionState(icon);
	return {
		action: {
			controllers: ["Keypad", "Encoder"],
			disable_automatic_states: false,
			encoder: null,
			icon,
			name: iconName === "launcher" ? "HDMI Matrix" : "Back",
			plugin: SWITCH_PLUGIN,
			property_inspector: showSettings ? PROPERTY_INSPECTOR : "",
			states: [state],
			supported_in_multi_actions: true,
			tooltip: iconName === "launcher" ? "Open the HDMI Matrix controls" : "Return to the main profile",
			uuid: SWITCH_ACTION,
			visible_in_action_list: false,
		},
		children: null,
		context: `Keypad.${position}.0`,
		current_state: 0,
		settings: { profile },
		states: [state],
	};
}

function slot(position: number, settings: SlotSettings): object {
	const state = actionState(`plugins/${PLUGIN}/icons/panel.png`);
	const metadata = actionMetadata(settings);
	return {
		action: {
			controllers: ["Keypad"],
			disable_automatic_states: true,
			encoder: null,
			icon: `plugins/${PLUGIN}/icons/panel.png`,
			name: metadata.name,
			plugin: PLUGIN,
			property_inspector: "",
			states: [state],
			supported_in_multi_actions: false,
			tooltip: metadata.tooltip,
			uuid: ACTION,
			visible_in_action_list: false,
		},
		children: null,
		context: `Keypad.${position}.0`,
		current_state: 0,
		settings,
		states: [state],
	};
}

function actionMetadata(settings: SlotSettings): { name: string; tooltip: string } {
	switch (settings.role) {
		case "output":
			return { name: `HDMI output ${settings.index}`, tooltip: `Select HDMI output ${settings.index}` };
		case "preset":
			return { name: `HDMI preset ${settings.index}`, tooltip: `Recall HDMI routing preset ${settings.index}` };
		case "input":
			return {
				name: `HDMI input ${settings.index}`,
				tooltip: `Route HDMI input ${settings.index} to the selected output`,
			};
		case "selection":
			return { name: "Selected HDMI output", tooltip: "Shows the output selected for routing and controls" };
		case "arc":
			return { name: "HDMI ARC", tooltip: "Toggle Audio Return Channel for the selected output" };
		case "mute":
			return { name: "HDMI audio mute", tooltip: "Toggle audio mute for the selected output" };
		case "stream":
			return { name: "HDMI output stream", tooltip: "Toggle the selected HDMI output stream" };
		case "refresh":
			return { name: "Refresh HDMI Matrix", tooltip: "Refresh HDMI Matrix status" };
		default:
			return { name: "HDMI Matrix control", tooltip: "Control the HDMI Matrix" };
	}
}

function actionState(image: string): object {
	return {
		alignment: "middle",
		background_colour: "#000000",
		colour: "#FFFFFF",
		family: "Liberation Sans",
		image,
		image_scale: 100,
		name: "",
		show: false,
		size: 16,
		stroke_colour: "#000000",
		stroke_size: 3,
		style: "Regular",
		text: "",
		underline: false,
	};
}
