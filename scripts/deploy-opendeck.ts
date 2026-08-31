import { execFileSync, spawn } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { platform } from "node:os";
import { resolve } from "node:path";

interface OpenDeckProcess {
	args: string[];
	executable: string;
	pid: number;
}

const root = resolve(import.meta.dirname, "..");
const setup = resolve(root, "dist", "setup-opendeck.mjs");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const setupArgs = args.filter((argument) => argument !== "--dry-run" && argument !== "--");

if (platform() !== "linux") {
	throw new Error(
		"Automatic OpenDeck restart is currently supported on Linux only. Use pnpm build and run setup manually.",
	);
}

console.log("Building plugin...");
execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });

const running = await findOpenDeckProcesses();
if (running.length > 1) {
	throw new Error(`Found ${running.length} OpenDeck processes. Stop them manually before deploying.`);
}
const current = running[0];

if (dryRun) {
	console.log(current ? `Would stop OpenDeck process ${current.pid}.` : "OpenDeck is not running.");
	execFileSync(process.execPath, [setup, "--dry-run", ...setupArgs], { cwd: root, stdio: "inherit" });
	console.log(current ? "Would restart OpenDeck after setup." : "Would leave OpenDeck stopped after setup.");
	process.exit(0);
}

let stopped = false;
try {
	if (current) {
		console.log(`Stopping OpenDeck process ${current.pid}...`);
		process.kill(current.pid, "SIGTERM");
		await waitUntilStopped(current.pid);
		stopped = true;
	}

	console.log("Installing plugin and updating profiles...");
	execFileSync(process.execPath, [setup, ...setupArgs], { cwd: root, stdio: "inherit" });
} finally {
	if (current && stopped) {
		console.log("Restarting OpenDeck...");
		const child = spawn(current.executable, current.args, { detached: true, stdio: "ignore" });
		child.unref();
		await waitUntilStarted();
	}
}

console.log("OpenDeck deployment complete.");

async function findOpenDeckProcesses(): Promise<OpenDeckProcess[]> {
	const processes: OpenDeckProcess[] = [];
	for (const entry of await readdir("/proc", { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
		try {
			const processRoot = resolve("/proc", entry.name);
			if ((await readFile(resolve(processRoot, "comm"), "utf8")).trim() !== "opendeck") continue;
			const commandLine = (await readFile(resolve(processRoot, "cmdline"), "utf8")).split("\0").filter(Boolean);
			processes.push({
				args: commandLine.slice(1),
				executable: await readlink(resolve(processRoot, "exe")),
				pid: Number(entry.name),
			});
		} catch {
			// The process may end while /proc is being read.
		}
	}
	return processes;
}

async function waitUntilStopped(pid: number): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await delay(100);
	}
	throw new Error(`OpenDeck process ${pid} did not stop within 5 seconds.`);
}

async function waitUntilStarted(): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if ((await findOpenDeckProcesses()).length === 1) return;
		await delay(100);
	}
	throw new Error("OpenDeck did not restart within 5 seconds.");
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
