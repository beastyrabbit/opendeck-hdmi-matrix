import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const releaseTag = process.argv[2] ?? process.env.RELEASE_TAG;
if (!releaseTag) {
	throw new Error("Pass the release tag as the first argument or RELEASE_TAG");
}

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "plugin/manifest.json"), "utf8")) as {
	UUID: string;
	Version: string;
};
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string };
const packagedManifest = JSON.parse(
	await readFile(resolve(root, `dist/${manifest.UUID}.sdPlugin/manifest.json`), "utf8"),
) as { UUID: string; Version: string };

if (releaseTag !== `v${manifest.Version}`) {
	throw new Error(`Release tag ${releaseTag} does not match manifest version v${manifest.Version}`);
}
if (packageJson.version !== manifest.Version) {
	throw new Error(`package.json ${packageJson.version} does not match manifest ${manifest.Version}`);
}
if (packagedManifest.UUID !== manifest.UUID || packagedManifest.Version !== `${manifest.Version}.0`) {
	throw new Error("Packaged manifest identity/version does not match the source manifest");
}

console.log(`${releaseTag} matches ${manifest.UUID} package version ${packagedManifest.Version}`);
