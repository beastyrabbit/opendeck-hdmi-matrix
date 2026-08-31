import type { MatrixSnapshot } from "../src/matrix-api.js";

export function snapshot(): MatrixSnapshot {
	return {
		input: {
			comhead: "get input status",
			inactive: [1, 1, 1, 0, 0, 0, 0, 0],
			inname: ["Linux", "Mac", "Windows", "Input4", "Input5", "Input6", "Input7", "Input8"],
			power: 1,
		},
		output: {
			allarc: [1, 0, 0, 0, 0, 0, 0, 0, 255],
			allaudiomute: [0, 0, 0, 0, 0, 0, 0, 0, 0],
			allconnect: [1, 1, 1, 1, 1, 0, 0, 0],
			allout: [1, 1, 1, 1, 1, 1, 1, 1, 1],
			comhead: "get output status",
			name: ["Main", "Capture", "Extra", "Main 2", "Main 3", "Output6", "Output7", "Output8"],
			power: 1,
		},
		video: {
			allinputname: ["Linux", "Mac", "Windows", "Input4", "Input5", "Input6", "Input7", "Input8"],
			allname: ["Normal OP", "Windows gets Monitor", "Preset3", "Preset4", "Preset5", "Preset6", "Preset7", "Preset8"],
			alloutputname: ["Main", "Capture", "Extra", "Main 2", "Main 3", "Output6", "Output7", "Output8"],
			allsource: [1, 4, 3, 2, 3, 6, 7, 8, 0],
			comhead: "get video status",
			power: 1,
		},
	};
}
