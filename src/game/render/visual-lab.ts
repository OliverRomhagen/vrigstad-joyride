import type { createDaylightController } from "./daylight";
import type { createStreetLighting } from "./street-lighting";
export function installVisualLab(
	daylight: ReturnType<typeof createDaylightController>,
	streetLighting: ReturnType<typeof createStreetLighting>,
	keys: Record<string, boolean>,
	joy: { x: number; y: number },
) {
	// Optional DOM tooling; no renderer/UI dependencies in the solar calculations.
	if (new URLSearchParams(location.search).get("dev") === "lighting") {
		const panel = document.createElement("details");
		panel.id = "visual-lab";
		panel.open = true;
		panel.style.cssText =
			"position:fixed;right:12px;top:100px;z-index:1000;width:min(290px,85vw);max-height:75vh;overflow:auto;background:#19232ef2;color:white;padding:12px;border:1px solid #8899aa;border-radius:8px;font:14px system-ui";
		panel.innerHTML = `<summary>Visual Lab</summary>
    <label>Time <output id="lab-clock"></output><input id="lab-time" aria-label="Time" type="range" min="0" max="24" step=".01"></label>
    <label>Date <input id="lab-date" aria-label="Solar date" type="date" min="2020-01-01" max="2035-12-31"></label>
    <div id="lab-presets"></div><label><input id="lab-cycle" type="checkbox"> Run day cycle</label>
    <label>Streetlights <select id="lab-street"><option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option></select></label>
    <label>Cloud coverage <input id="lab-cloud" type="range" min="0" max="1" step=".01" value=".5"></label>
    <label>Sun glare <input id="lab-glare" type="range" min="0" max="3" step=".05" value="1"></label>
    <button id="lab-reset" type="button">Reset</button>`;
		const style = document.createElement("style");
		style.textContent =
			"#visual-lab label{display:block;margin:10px 0}#visual-lab input[type=range]{display:block;width:100%}#visual-lab button,#visual-lab select{font:inherit;margin:3px;padding:5px}#visual-lab summary{cursor:pointer;font-weight:bold}";
		document.head.append(style);
		document.body.append(panel);
		// Stop bubbled keyboard events reaching gameplay; keyup still releases keys.
		panel.addEventListener("keydown", (e) => e.stopPropagation());
		panel.addEventListener("pointerdown", () => {
			for (const k in keys) keys[k] = false;
			joy.x = joy.y = 0;
		});
		for (const type of ["pointerdown", "pointermove", "pointerup", "wheel"])
			panel.addEventListener(type, (e) => e.stopPropagation());
		const el = <T extends HTMLElement = HTMLInputElement>(id: string) =>
			panel.querySelector<T>("#lab-" + id)!;
		const clock = () => {
			el("date").value = daylight.getDate();
			const h = daylight.getHour(),
				m = Math.round(h * 60) % 1440;
			el<HTMLOutputElement>("clock").value =
				String(Math.floor(m / 60)).padStart(2, "0") +
				":" +
				String(m % 60).padStart(2, "0");
			el("time").value = String(h);
			el("cycle").checked = daylight.getCycle();
		};
		const apply = () => {
			daylight.update(0);
			streetLighting.update(
				0,
				daylight.getHour(),
				daylight.getSolarElevation(),
			);
			clock();
		};
		el("time").oninput = () => {
			daylight.setHour(+el("time").value);
			apply();
		};
		el("date").value = daylight.getDate();
		el("date").onchange = () => {
			daylight.setDate(el("date").value);
			apply();
		};
		for (const hour of [13, 17, 19, 20.5, 22]) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = hour === 20.5 ? "20:30" : hour + ":00";
			b.onclick = () => {
				daylight.setHour(hour);
				apply();
			};
			el<HTMLDivElement>("presets").append(b);
		}
		el("cycle").onchange = () => daylight.setCycle(el("cycle").checked);
		el("street").onchange = () => {
			streetLighting.setMode(el("street").value);
			apply();
		};
		el("cloud").oninput = () => {
			daylight.setCoverage(+el("cloud").value);
			apply();
		};
		el("glare").oninput = () => {
			daylight.setGlare(+el("glare").value);
			apply();
		};
		el("reset").onclick = () => {
			daylight.reset();
			streetLighting.setMode("auto");
			el("street").value = "auto";
			el("cloud").value = String(daylight.getCoverage());
			el("glare").value = "1";
			apply();
		};
		function daylightStateForLab() {
			return daylight.getCoverage();
		}
		el("cloud").value = String(daylightStateForLab());
		clock();
		setInterval(clock, 250);
	}
}
