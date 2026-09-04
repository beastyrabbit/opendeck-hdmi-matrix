import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const archive = resolve(root, "dist/com.beastyrabbit.hdmi-matrix.streamDeckPlugin");
const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const prefix = pnpmCli ? [pnpmCli] : [];

const first = await buildAndHash();
const second = await buildAndHash();
if (first !== second) {
	throw new Error(`Build is not reproducible: ${first} != ${second}`);
}
console.log(`Reproducible archive SHA-256: ${first}`);

async function buildAndHash(): Promise<string> {
	execFileSync(command, [...prefix, "build"], { cwd: root, stdio: "inherit" });
	return createHash("sha256")
		.update(await readFile(archive))
		.digest("hex");
}
