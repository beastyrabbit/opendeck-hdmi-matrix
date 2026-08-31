const PLUGIN = "de.beasty.hdmi-matrix.sdPlugin";
const ACTION = "de.beasty.hdmi-matrix.panel";
const SWITCH_PLUGIN = "com.amansprojects.starterpack.sdPlugin";
const SWITCH_ACTION = "com.amansprojects.starterpack.switchprofile";

interface SlotSettings {
	index?: number;
	role: string;
}

export function createProfile(returnProfile = "Default"): object {
	const keys: Array<object | null> = Array.from({ length: 32 }, () => null);
	for (let index = 1; index <= 8; index += 1) {
		keys[index - 1] = slot(index - 1, { index, role: "output" });
		keys[8 + index - 1] = slot(8 + index - 1, { index, role: "preset" });
		keys[24 + index - 1] = slot(24 + index - 1, { index, role: "input" });
	}

	keys[16] = switchProfileSlot(16, returnProfile, "back");
	keys[17] = slot(17, { role: "selection" });
	keys[18] = slot(18, { role: "arc" });
	keys[19] = slot(19, { role: "mute" });
	keys[20] = slot(20, { role: "stream" });
	keys[23] = slot(23, { role: "refresh" });

	return { infobars: [], keys, sliders: [] };
}

export function switchProfileSlot(
	position: number,
	profile: string,
	icon: "back" | "launcher",
): Record<string, unknown> {
	const image = `plugins/${PLUGIN}/icons/${icon}.png`;
	const state = actionState(image);
	return {
		action: {
			controllers: ["Keypad", "Encoder"],
			disable_automatic_states: false,
			encoder: null,
			icon: image,
			name: "Switch Profile",
			plugin: SWITCH_PLUGIN,
			property_inspector: `plugins/${SWITCH_PLUGIN}/propertyInspector/switchProfile.html`,
			states: [state],
			supported_in_multi_actions: true,
			tooltip: "Switch the selected profile",
			uuid: SWITCH_ACTION,
			visible_in_action_list: true,
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
