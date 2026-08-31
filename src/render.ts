import type { MatrixSnapshot } from "./matrix-api.js";

const COLORS = {
	amber: "#FFB547",
	cyan: "#38E1E4",
	danger: "#FF6262",
	ink: "#050708",
	paper: "#FFFFFF",
	slate: "#18272F",
	soft: "#9CB0BA",
	violet: "#B78AFF",
} as const;

export function renderLauncher(online: boolean): string {
	return svgData(`
		<rect width="144" height="144" fill="${COLORS.ink}"/>
		<path d="M23 35h98M23 72h98M23 109h98M50 18v108M94 18v108" stroke="${COLORS.slate}" stroke-width="6"/>
		<path d="M50 35h44v37H50z" fill="none" stroke="${COLORS.cyan}" stroke-width="8"/>
		<circle cx="116" cy="24" r="9" fill="${online ? COLORS.cyan : COLORS.soft}"/>
	`);
}

export function renderOutput(snapshot: MatrixSnapshot, index: number, selected: boolean): string {
	const name = snapshot.video.alloutputname[index - 1] ?? `Output ${index}`;
	const input = snapshot.video.allsource[index - 1] ?? 0;
	const stream = snapshot.output.allout[index - 1] === 1;
	return portFrame({
		accent: selected ? COLORS.amber : COLORS.cyan,
		footer: input ? `I${input}` : "–",
		led: stream ? COLORS.cyan : COLORS.soft,
		name,
		port: `O${index}`,
		selected,
	});
}

export function renderInput(snapshot: MatrixSnapshot, index: number, routed: boolean): string {
	const name = snapshot.video.allinputname[index - 1] ?? snapshot.input.inname[index - 1] ?? `Input ${index}`;
	return portFrame({
		accent: COLORS.violet,
		footer: routed ? "LIVE" : "IN",
		led: routed ? COLORS.violet : COLORS.soft,
		name,
		port: `I${index}`,
		selected: routed,
	});
}

export function renderPreset(name: string, index: number): string {
	return portFrame({
		accent: COLORS.amber,
		footer: "GO",
		led: COLORS.amber,
		name,
		port: `P${index}`,
		selected: false,
	});
}

export function renderSelection(snapshot: MatrixSnapshot, index: number): string {
	const name = snapshot.video.alloutputname[index - 1] ?? `Output ${index}`;
	const input = snapshot.video.allsource[index - 1] ?? 0;
	const shortName = wrapName(name, 12)[0] ?? name;
	return svgData(`
		<rect width="144" height="144" fill="${COLORS.ink}"/>
		<rect x="8" y="8" width="128" height="128" rx="16" fill="${COLORS.slate}" stroke="${COLORS.amber}" stroke-width="7"/>
		<text x="72" y="68" text-anchor="middle" fill="${COLORS.paper}" font-family="Arial, sans-serif" font-size="54" font-weight="900">O${index}</text>
		<text x="72" y="94" text-anchor="middle" fill="${COLORS.paper}" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(shortName)}</text>
		<rect x="39" y="105" width="66" height="25" rx="12" fill="${COLORS.amber}"/>
		<text x="72" y="124" text-anchor="middle" fill="${COLORS.ink}" font-family="Arial, sans-serif" font-size="20" font-weight="900">I${input || "–"}</text>
	`);
}

export type Control = "arc" | "back" | "mute" | "refresh" | "stream";

export function renderControl(control: Control, active: boolean, selectedOutput: number): string {
	const accent = controlAccent(control, active);
	return svgData(`
		<rect width="144" height="144" fill="${COLORS.ink}"/>
		<rect x="8" y="8" width="128" height="128" rx="16" fill="${active ? COLORS.slate : COLORS.ink}" stroke="${accent}" stroke-width="${active ? 7 : 3}"/>
		${control === "back" || control === "refresh" ? "" : outputBadge(selectedOutput, accent)}
		${controlIcon(control, active, accent)}
		${active && control !== "refresh" ? `<circle cx="119" cy="119" r="8" fill="${accent}"/>` : ""}
	`);
}

export function renderBlank(): string {
	return svgData(`<rect width="144" height="144" fill="${COLORS.ink}"/>`);
}

export function renderError(label = "OFFLINE"): string {
	return svgData(`
		<rect width="144" height="144" fill="${COLORS.ink}"/>
		<path d="M72 21 129 122H15z" fill="none" stroke="${COLORS.danger}" stroke-width="8"/>
		<text x="72" y="91" text-anchor="middle" fill="${COLORS.danger}" font-family="Arial, sans-serif" font-size="50" font-weight="900">!</text>
		<text x="72" y="137" text-anchor="middle" fill="${COLORS.paper}" font-family="Arial, sans-serif" font-size="17" font-weight="900">${escapeXml(label)}</text>
	`);
}

interface PortFrameOptions {
	accent: string;
	footer: string;
	led: string;
	name: string;
	port: string;
	selected: boolean;
}

function portFrame({ accent, footer, led, name, port, selected }: PortFrameOptions): string {
	const lines = wrapName(name, 10);
	const longestLine = Math.max(...lines.map((line) => line.length));
	const fontSize = lines.length === 1 ? fitFontSize(longestLine, 28) : fitFontSize(longestLine, 25);
	const firstBaseline = lines.length === 1 ? 83 : 70;
	return svgData(`
		<rect width="144" height="144" fill="${COLORS.ink}"/>
		<rect x="8" y="8" width="128" height="128" rx="16" fill="${selected ? COLORS.slate : COLORS.ink}" stroke="${accent}" stroke-width="${selected ? 7 : 3}"/>
		<rect x="16" y="15" width="50" height="34" rx="9" fill="${accent}"/>
		<text x="41" y="41" text-anchor="middle" fill="${COLORS.ink}" font-family="Arial, sans-serif" font-size="27" font-weight="900">${escapeXml(port)}</text>
		<circle cx="119" cy="30" r="9" fill="${led}"/>
		<text x="72" y="${firstBaseline}" text-anchor="middle" fill="${COLORS.paper}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="800">
			${lines.map((line, i) => `<tspan x="72" dy="${i === 0 ? 0 : 25}">${escapeXml(line)}</tspan>`).join("")}
		</text>
		<rect x="43" y="106" width="58" height="27" rx="13" fill="${selected ? accent : COLORS.slate}"/>
		<text x="72" y="127" text-anchor="middle" fill="${selected ? COLORS.ink : accent}" font-family="Arial, sans-serif" font-size="20" font-weight="900">${escapeXml(footer)}</text>
	`);
}

function outputBadge(output: number, accent: string): string {
	return `
		<rect x="15" y="15" width="43" height="29" rx="8" fill="${accent}"/>
		<text x="36.5" y="37" text-anchor="middle" fill="${COLORS.ink}" font-family="Arial, sans-serif" font-size="21" font-weight="900">O${output}</text>
	`;
}

function controlAccent(control: Control, active: boolean): string {
	if (control === "arc") return active ? COLORS.violet : COLORS.soft;
	if (control === "mute") return active ? COLORS.danger : COLORS.soft;
	if (control === "stream") return active ? COLORS.cyan : COLORS.soft;
	if (control === "refresh") return COLORS.cyan;
	return COLORS.soft;
}

function controlIcon(control: Control, active: boolean, accent: string): string {
	const common = `fill="none" stroke="${accent}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`;
	if (control === "arc") {
		return `<path d="M105 52H58c-15 0-26 12-26 27s11 27 26 27h35" ${common}/><path d="m78 89 17 17-17 17" ${common}/>`;
	}
	if (control === "mute") {
		return `
			<path d="M31 68h20l25-21v50L51 77H31z" fill="${active ? accent : "none"}" stroke="${accent}" stroke-width="7" stroke-linejoin="round"/>
			${active ? `<path d="m91 61 25 25m0-25L91 86" ${common}/>` : `<path d="M91 60c9 7 9 18 0 25m12-38c18 14 18 37 0 51" ${common}/>`}
		`;
	}
	if (control === "stream") {
		return `
			<rect x="30" y="45" width="84" height="61" rx="9" fill="${active ? accent : "none"}" stroke="${accent}" stroke-width="8"/>
			<path d="m62 60 31 16-31 16z" fill="${active ? COLORS.ink : accent}"/>
			<path d="M52 120h40" ${common}/>
		`;
	}
	if (control === "refresh") {
		return `<path d="M110 54a45 45 0 1 0 2 39M110 54V28m0 26H84" ${common}/>`;
	}
	return `<path d="M112 72H35m0 0 31-31M35 72l31 31" ${common}/>`;
}

function wrapName(value: string, maxLength: number): string[] {
	const clean = abbreviateName(value).replace(/\s+/g, " ").trim();
	if (clean.length <= maxLength) return [clean];
	const words = clean.split(" ");
	if (words.length === 1) return [truncate(clean, maxLength)];

	let split = 1;
	let shortestLongestLine = Number.POSITIVE_INFINITY;
	for (let index = 1; index < words.length; index += 1) {
		const firstLength = words.slice(0, index).join(" ").length;
		const secondLength = words.slice(index).join(" ").length;
		const longestLine = Math.max(firstLength, secondLength);
		if (longestLine < shortestLongestLine) {
			split = index;
			shortestLongestLine = longestLine;
		}
	}
	return [truncate(words.slice(0, split).join(" "), 12), truncate(words.slice(split).join(" "), 12)];
}

function abbreviateName(value: string): string {
	let result = value
		.replace(/\bSecond\b/gi, "2nd")
		.replace(/\bThird\b/gi, "3rd")
		.replace(/\bInput\b/gi, "In")
		.replace(/\bOutput\b/gi, "Out")
		.replace(/\bgets\b/gi, "→");
	if (result.length > 18) result = result.replace(/\bMonitor\b/gi, "Mon");
	return result;
}

function fitFontSize(length: number, maximum: number): number {
	if (length <= 7) return maximum;
	if (length <= 9) return Math.min(maximum, 24);
	if (length <= 11) return Math.min(maximum, 21);
	return 19;
}

function truncate(value: string, length: number): string {
	return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const replacements: Record<string, string> = {
			'"': "&quot;",
			"&": "&amp;",
			"'": "&apos;",
			"<": "&lt;",
			">": "&gt;",
		};
		return replacements[character] ?? character;
	});
}

function svgData(content: string): string {
	const document = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${content}</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(document).toString("base64")}`;
}
