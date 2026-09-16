import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import type { MatrixSnapshot } from "../src/matrix-api.js";
import { renderBlank, renderControl, renderInput, renderOutput, renderPreset, renderSelection } from "../src/render.js";

const keySize = 144;
const gap = 12;
const columns = 8;
const rows = 4;
const width = columns * keySize + (columns - 1) * gap;
const height = rows * keySize + (rows - 1) * gap;
const root = resolve(import.meta.dirname, "..");

const snapshot: MatrixSnapshot = {
	input: {
		comhead: "get input status",
		inactive: [1, 1, 1, 0, 0, 0, 0, 0],
		inname: ["Workstation", "Laptop", "Camera", "Input 4", "Input 5", "Input 6", "Input 7", "Input 8"],
		power: 1,
	},
	output: {
		allarc: [1, 0, 0, 0, 0, 0, 0, 0],
		allaudiomute: [0, 0, 0, 0, 0, 0, 0, 0],
		allconnect: [1, 1, 1, 1, 1, 0, 0, 0],
		allout: [1, 1, 1, 1, 1, 0, 0, 0],
		comhead: "get output status",
		name: ["Main display", "Capture", "Studio screen", "Aux display", "Projector", "Output 6", "Output 7", "Output 8"],
		power: 1,
	},
	video: {
		allinputname: ["Workstation", "Laptop", "Camera", "Input 4", "Input 5", "Input 6", "Input 7", "Input 8"],
		allname: ["Studio", "Presentation", "Preset 3", "Preset 4", "Preset 5", "Preset 6", "Preset 7", "Preset 8"],
		alloutputname: [
			"Main display",
			"Capture",
			"Studio screen",
			"Aux display",
			"Projector",
			"Output 6",
			"Output 7",
			"Output 8",
		],
		allsource: [1, 3, 2, 1, 2, 0, 0, 0],
		comhead: "get video status",
		power: 1,
	},
};

const blank = renderBlank();
const keys = [
	...Array.from({ length: 8 }, (_, index) => (index < 5 ? renderOutput(snapshot, index + 1, index === 0) : blank)),
	renderPreset("Studio", 1),
	renderPreset("Presentation", 2),
	...Array.from({ length: 6 }, () => blank),
	renderControl("back", true, 1),
	renderSelection(snapshot, 1),
	renderControl("arc", true, 1),
	renderControl("mute", false, 1),
	renderControl("stream", true, 1),
	blank,
	blank,
	renderControl("refresh", true, 1),
	...Array.from({ length: 8 }, (_, index) => (index < 3 ? renderInput(snapshot, index + 1, index === 0) : blank)),
];

const cells = keys
	.map((dataUrl, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const svg = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString("utf8");
		const content = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
		return `<svg x="${column * (keySize + gap)}" y="${row * (keySize + gap)}" width="${keySize}" height="${keySize}" viewBox="0 0 144 144">${content}</svg>`;
	})
	.join("");

const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#181B1D"/>${cells}</svg>`;
const png = new Resvg(preview).render().asPng();
const output = resolve(root, "assets", "preview.png");
if (process.argv.includes("--check")) {
	const current = await readFile(output);
	if (!current.equals(Buffer.from(png))) {
		throw new Error("assets/preview.png is stale. Run pnpm preview.");
	}
	console.log(`Verified ${output} (${width}x${height})`);
} else {
	await writeFile(output, Buffer.from(png));
	console.log(`Generated ${output} (${width}x${height})`);
}
