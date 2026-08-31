import assert from "node:assert/strict";
import { it } from "node:test";

import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

it("keeps the Matrix URL out of file-based configuration", async () => {
	const config = await loadConfig("/path/that/does/not/exist");
	assert.deepEqual(config, DEFAULT_CONFIG);
	assert.equal("matrixUrl" in config, false);
});
