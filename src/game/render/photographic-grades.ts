import * as THREE from "three";
import { createSceneFinish } from "./scene-finish";

interface FilmPreset {
	curve: number[];
	shadow: number[];
	highlight: number[];
	mid: number[];
	green: number[];
	blue: number[];
	red: number[];
	yellow: number[];
	cyan: number[];
	shoulder: number;
	greenMix: number;
	foliageReach: number;
	saturation: number;
	neutral: number;
}
const FILM_PRESETS: Record<string, FilmPreset> = {
	negative: {
		curve: [0.045, 1.045, 0.36],
		shadow: [-0.016, 0.002, 0.028],
		highlight: [0.008, 0.001, -0.01],
		mid: [0, 0, 0],
		shoulder: 0.092,
		green: [0.62, 0.66, 0.58],
		greenMix: 1,
		foliageReach: 1,
		blue: [-0.016, -0.007, 0.023],
		red: [0.018, 0.002, -0.007],
		yellow: [0, 0, 0],
		cyan: [0, 0, 0],
		saturation: 1.045,
		neutral: 0,
	},
	chrome: {
		curve: [0.025, 1.055, 0.32],
		shadow: [-0.01, 0.001, 0.019],
		highlight: [0, 0, 0],
		mid: [0, 0, 0],
		shoulder: 0.085,
		green: [0.95, 0.88, 0.92],
		greenMix: 0.85,
		foliageReach: 0,
		blue: [-0.025, -0.008, 0.026],
		red: [-0.023, 0.005, 0.01],
		yellow: [-0.012, -0.01, 0.012],
		cyan: [-0.009, -0.004, 0.012],
		saturation: 0.72,
		neutral: 0.85,
	},
	gold: {
		curve: [0.015, 1.06, 0.2],
		shadow: [0.008, 0.002, -0.009],
		highlight: [0.032, 0.017, -0.033],
		mid: [0.023, 0.009, -0.018],
		shoulder: 0.085,
		green: [1.02, 0.98, 0.88],
		greenMix: 0.65,
		foliageReach: 0,
		blue: [-0.01, 0.002, 0.018],
		red: [0.024, 0.002, -0.008],
		yellow: [0.028, 0.019, -0.021],
		cyan: [-0.008, 0.002, 0.012],
		saturation: 1.085,
		neutral: 0.6,
	},
	portra: {
		curve: [0.015, 1.075, 0.18],
		shadow: [0.003, 0.002, -0.005],
		highlight: [0.012, 0.007, -0.01],
		mid: [0.011, 0.005, -0.008],
		shoulder: 0.105,
		green: [1.03, 1, 0.955],
		greenMix: 0.7,
		foliageReach: 0,
		blue: [0.004, 0.006, -0.006],
		red: [0.01, 0.005, 0.003],
		yellow: [0.004, 0.003, -0.002],
		cyan: [0.004, 0.003, 0],
		saturation: 0.93,
		neutral: 0.92,
	},
};
export function createPhotographicGrades(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	search = location.search,
) {
	const q = new URLSearchParams(search).get("film") ?? "off";
	const enabled = Object.hasOwn(FILM_PRESETS, q),
		preset = FILM_PRESETS[enabled ? q : "negative"];
	const uniforms: Record<string, THREE.IUniform> = {};
	for (const key of [
		"curve",
		"shadow",
		"highlight",
		"mid",
		"green",
		"blue",
		"red",
		"yellow",
		"cyan",
	] as const)
		uniforms["u" + key[0].toUpperCase() + key.slice(1)] = {
			value: new THREE.Vector3(...(preset[key] as [number, number, number])),
		};
	for (const key of ["shoulder", "greenMix", "foliageReach", "saturation", "neutral"] as const)
		uniforms["u" + key[0].toUpperCase() + key.slice(1)] = {
			value: preset[key],
		};
	return createSceneFinish(renderer, scene, camera, {
		enabled,
		uniforms,
		state: { setting: q, preset: q },
		fragmentShader: `uniform sampler2D uScene;varying vec2 vUv;
uniform vec3 uCurve,uShadow,uHighlight,uMid,uGreen,uBlue,uRed,uYellow,uCyan;
uniform float uShoulder,uGreenMix,uFoliageReach,uSaturation,uNeutral;
    vec3 photographicGrade(vec3 c) {
      // Controlled photographic S-curve in display space, keeping black and
      // white points without clipping interiors or the pale house facades.
      // Wider white shoulder than v0.6: retain local differences within pale
      // siding, cloudy sky and sunlit concrete instead of approaching pure white.
      vec3 curve = smoothstep(vec3(uCurve.x), vec3(uCurve.y), c);
      c = mix(c, curve, uCurve.z);
      float y = dot(c, vec3(0.2126, 0.7152, 0.0722));

      // Cool low values, softly warm high values; no heavy orange/teal split.
      float shadows = 1.0 - smoothstep(0.12, 0.57, y);
      float highlights = smoothstep(0.53, 0.89, y);
      // Chroma gate protects greys/white paint from the warmer looks.
      float chroma = max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));
      float tint = mix(1.0, smoothstep(.015,.16,chroma), uNeutral);
      c += uShadow * shadows * tint;
      c += uMid * (4.0*y*(1.0-y)) * tint;
      // Keep chromatic warmth, but stop actively lifting bright luminance.
      c += uHighlight * highlights * tint;
      // A stronger chroma-preserving photographic shoulder: compress bright
      // material responses without flattening the whole day scene or crushing
      // the difference between a white wall and a warmer roof.
      // Unlike subtracting a constant RGB value, scaling all three channels
      // together maintains the colour ratio of sunlit yellows and brick.
      float shoulderY = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float shoulder = smoothstep(0.59, 0.95, shoulderY);
      c *= 1.0 - uShoulder * shoulder;

      // Foliage should be olive/forest green, not a bright lime-coloured mass.
      float green = smoothstep(0.022, 0.20, c.g - max(c.r, c.b));
      // Negative only: pick up pale yellow-green grass as well as dark foliage.
      // Green dominance and a blue gap protect beige, grey and painted walls.
      float olive = smoothstep(-0.012, 0.042, c.g - c.r)
                  * smoothstep(0.05, 0.17, c.g - c.b);
      green = mix(green, max(green, olive), uFoliageReach);
      c = mix(c, c * uGreen, green * uGreenMix);

      // Strong but restrained sky/blue-car separation.
      float blue = smoothstep(0.035, 0.24, c.b - c.r)
                 * smoothstep(-0.03, 0.15, c.b - c.g);
      c += uBlue * blue;

      // Pigmented red timber and ochre should retain their character.
      float red = smoothstep(0.035, 0.23, c.r - c.g)
                * smoothstep(0.015, 0.20, c.r - c.b);
      c += uRed * red;

      float yellow = smoothstep(.03,.20,min(c.r,c.g)-c.b)
                   * (1.0-smoothstep(.08,.30,abs(c.r-c.g)));
      float cyan = smoothstep(.025,.18,min(c.g,c.b)-c.r);
      c += uYellow * yellow + uCyan * cyan;
      float neutral = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(neutral), c, uSaturation);
      return clamp(c, 0.0, 1.0);
    }

vec3 finishColor(vec3 c){return photographicGrade(c);}
void main(){gl_FragColor=vec4(finishColor(texture2D(uScene,vUv).rgb),1.);}`,
	});
}
