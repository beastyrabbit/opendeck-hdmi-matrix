const PLUGIN = "de.beasty.hdmi-matrix.sdPlugin";
const ACTION = "de.beasty.hdmi-matrix.panel";
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
	action?: { icon?: string; property_inspector?: string; uuid?: string };
	settings?: { profile?: string };
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

export function isManagedLauncher(value: unknown, matrixProfile: string): boolean {
	const slot = launcher(value);
	return (
		slot?.action?.uuid === LEGACY_LAUNCHER ||
		slot?.action?.icon === LAUNCHER_ICON ||
		slot?.action?.property_inspector === PROPERTY_INSPECTOR ||
		(slot?.action?.uuid === SWITCH_ACTION && slot.settings?.profile === matrixProfile)
	);
}

export function isCurrentLauncher(value: unknown, matrixProfile: string): boolean {
	const slot = launcher(value);
	return (
		slot?.action?.uuid === SWITCH_ACTION &&
		slot.settings?.profile === matrixProfile &&
		slot.action.property_inspector === PROPERTY_INSPECTOR
	);
}

export function isManagedMatrixProfile(value: unknown): boolean {
	const profile = value as { keys?: unknown[] } | null;
	const first = profile?.keys?.[0] as { action?: { uuid?: string } } | null;
	return first?.action?.uuid === ACTION;
}

export function isSameFile(first: FileIdentity, second: FileIdentity): boolean {
	return first.dev === second.dev && first.ino === second.ino;
}

export function migrateSelectedProfile(
	value: unknown,
	previousProfile: string,
	nextProfile: string,
): Record<string, unknown> | undefined {
	const config = value as Record<string, unknown>;
	return config.selected_profile === previousProfile ? { ...config, selected_profile: nextProfile } : undefined;
}

export function isValidProfileName(profile: string): boolean {
	return /^[a-zA-Z0-9_ ]+(\/[a-zA-Z0-9_ ]+)?$/.test(profile);
}

function launcher(value: unknown): ProfileSlot | null {
	return value as ProfileSlot | null;
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
	return {
		action: {
			controllers: ["Keypad"],
			disable_automatic_states: true,
			encoder: null,
			icon: `plugins/${PLUGIN}/icons/panel.png`,
			name: "Matrix control panel",
			plugin: PLUGIN,
			property_inspector: "",
			states: [state],
			supported_in_multi_actions: false,
			tooltip: "Dynamic key in the HDMI Matrix profile",
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
