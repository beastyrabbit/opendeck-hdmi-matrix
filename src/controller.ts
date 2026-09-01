import type { PluginConfig } from "./config.js";
import { isDailyPreset, isInputActive, isOutputActive, type MatrixApi, type MatrixSnapshot } from "./matrix-api.js";
import type { ActionSettings, OpenDeckEvent, OpenDeckHost } from "./opendeck-host.js";
import {
	renderBlank,
	renderControl,
	renderError,
	renderInput,
	renderOutput,
	renderPreset,
	renderSelection,
} from "./render.js";

export const ACTION_PANEL = "de.beasty.hdmi-matrix.panel";

interface VisibleAction {
	action: string;
	context: string;
	device: string;
	settings: ActionSettings;
}

export class MatrixController {
	private readonly visible = new Map<string, VisibleAction>();
	private readonly selectedOutput = new Map<string, number | undefined>();
	private snapshot?: MatrixSnapshot;
	private pollTimer?: NodeJS.Timeout;
	private loading?: Promise<void>;

	constructor(
		private readonly host: OpenDeckHost,
		private api: MatrixApi | undefined,
		private readonly config: PluginConfig,
	) {}

	setApi(api: MatrixApi | undefined): void {
		this.api = api;
		this.snapshot = undefined;
	}

	async handle(event: OpenDeckEvent): Promise<void> {
		switch (event.event) {
			case "willAppear":
				this.appear(event);
				await this.refresh();
				this.startPolling();
				break;
			case "willDisappear":
				if (event.context) this.visible.delete(event.context);
				if (this.visible.size === 0) this.stopPolling();
				break;
			case "keyUp":
				await this.press(event);
				break;
		}
	}

	async refresh(): Promise<void> {
		if (this.loading) return this.loading;
		this.loading = this.loadAndRender();
		try {
			await this.loading;
		} finally {
			this.loading = undefined;
		}
	}

	private appear(event: OpenDeckEvent): void {
		if (!event.action || !event.context || !event.device) return;
		this.visible.set(event.context, {
			action: event.action,
			context: event.context,
			device: event.device,
			settings: event.payload?.settings ?? {},
		});
	}

	private async press(event: OpenDeckEvent): Promise<void> {
		if (!event.context || !event.device || !event.action) return;
		if (event.action !== ACTION_PANEL || !this.snapshot || !this.api) return;
		const settings = event.payload?.settings ?? this.visible.get(event.context)?.settings ?? {};
		const index = settings.index;
		const role = settings.role;
		try {
			let completed = true;
			switch (role) {
				case "output":
					if (index && isOutputActive(this.snapshot, index)) this.selectedOutput.set(event.device, index);
					else completed = false;
					break;
				case "input":
					completed = await this.routeInput(event.device, index);
					break;
				case "preset":
					if (index && isDailyPreset(this.snapshot.video.allname[index - 1], index)) {
						await this.api.recallPreset(index);
					} else completed = false;
					break;
				case "arc":
					completed = await this.toggle(event.device, "arc");
					break;
				case "mute":
					completed = await this.toggle(event.device, "mute");
					break;
				case "stream":
					completed = await this.toggle(event.device, "stream");
					break;
				case "refresh":
					break;
				default:
					completed = false;
			}
			await this.refresh();
			if (completed) this.host.showOk(event.context);
		} catch (error) {
			this.host.log(error);
			this.host.showAlert(event.context);
			await this.renderAll();
		}
	}

	private async routeInput(device: string, index: number | undefined): Promise<boolean> {
		if (!index || !this.snapshot || !this.api || !isInputActive(this.snapshot, index)) return false;
		const output = this.getSelectedOutput(device);
		if (!output) return false;
		await this.api.route(output, index);
		if (this.snapshot.output.allout[output - 1] !== 1) await this.api.setStream(output, true);
		return true;
	}

	private async toggle(device: string, control: "arc" | "mute" | "stream"): Promise<boolean> {
		if (!this.snapshot || !this.api) return false;
		const output = this.getSelectedOutput(device);
		if (!output) return false;
		if (control === "arc") await this.api.setArc(output, this.snapshot.output.allarc[output - 1] !== 1);
		if (control === "mute") await this.api.setMute(output, this.snapshot.output.allaudiomute[output - 1] !== 1);
		if (control === "stream") await this.api.setStream(output, this.snapshot.output.allout[output - 1] !== 1);
		return true;
	}

	private async loadAndRender(): Promise<void> {
		if (!this.api) {
			this.snapshot = undefined;
			for (const action of this.visible.values()) {
				this.host.setImage(action.context, renderError());
			}
			return;
		}
		try {
			this.snapshot = await this.api.snapshot();
			for (const action of this.visible.values()) {
				if (!this.selectedOutput.has(action.device)) {
					const first = Array.from({ length: 8 }, (_, position) => position + 1).find((index) =>
						isOutputActive(this.snapshot as MatrixSnapshot, index),
					);
					this.selectedOutput.set(action.device, first);
					continue;
				}
				const selected = this.selectedOutput.get(action.device);
				if (selected && !isOutputActive(this.snapshot, selected)) {
					this.selectedOutput.set(action.device, undefined);
				}
			}
			await this.renderAll();
		} catch (error) {
			this.host.log(error);
			for (const action of this.visible.values()) {
				this.host.setImage(action.context, renderError());
			}
		}
	}

	private async renderAll(): Promise<void> {
		if (!this.snapshot) return;
		for (const action of this.visible.values()) {
			this.host.setImage(action.context, this.renderAction(action));
		}
	}

	private renderAction(action: VisibleAction): string {
		if (!this.snapshot) return renderError();
		const index = action.settings.index ?? 0;
		const role = action.settings.role;
		const selected = this.getSelectedOutput(action.device);

		switch (role) {
			case "output":
				return index && isOutputActive(this.snapshot, index)
					? renderOutput(this.snapshot, index, selected === index)
					: renderBlank();
			case "input":
				return index && isInputActive(this.snapshot, index)
					? renderInput(
							this.snapshot,
							index,
							Boolean(selected && this.snapshot.video.allsource[selected - 1] === index),
						)
					: renderBlank();
			case "preset": {
				const name = this.snapshot.video.allname[index - 1];
				return isDailyPreset(name, index) ? renderPreset(name ?? `Preset ${index}`, index) : renderBlank();
			}
			case "selection":
				return selected ? renderSelection(this.snapshot, selected) : renderBlank();
			case "arc":
				return selected
					? renderControl("arc", this.snapshot.output.allarc[selected - 1] === 1, selected)
					: renderBlank();
			case "mute":
				return selected
					? renderControl("mute", this.snapshot.output.allaudiomute[selected - 1] === 1, selected)
					: renderBlank();
			case "stream":
				return selected
					? renderControl("stream", this.snapshot.output.allout[selected - 1] === 1, selected)
					: renderBlank();
			case "refresh":
				return renderControl("refresh", true, selected ?? 1);
			default:
				return renderBlank();
		}
	}

	private getSelectedOutput(device: string): number | undefined {
		const selected = this.selectedOutput.get(device);
		return selected && this.snapshot && isOutputActive(this.snapshot, selected) ? selected : undefined;
	}

	private startPolling(): void {
		if (this.pollTimer) return;
		this.pollTimer = setInterval(() => void this.refresh(), this.config.pollIntervalMs);
		this.pollTimer.unref();
	}

	private stopPolling(): void {
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = undefined;
	}
}
