import * as THREE from "three";
import { createSceneFinish } from "./scene-finish";

export function createPhotographicGrain(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	search = location.search,
) {
	const q = new URLSearchParams(search).get("grain");
	const parsed = Number(q),
		strength =
			q === "off"
				? 0
				: q === "strong"
					? 1.5
					: q === "subtle" || q === null
						? 0.62
						: Number.isFinite(parsed)
							? Math.max(0, Math.min(2, parsed))
							: 0.62;
	const uniforms = { uStrength: { value: strength } };
	return createSceneFinish(renderer, scene, camera, {
		enabled: strength > 0,
		uniforms,
		state: { setting: q ?? "subtle", strength },
		fragmentShader: `uniform sampler2D uScene;varying vec2 vUv;
uniform float uStrength;
float hash(vec2 pixel){vec3 p=fract(vec3(pixel.xyx)*vec3(.1031,.1030,.0973));p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
vec3 finishColor(vec3 c){
 float y=dot(c,vec3(.2126,.7152,.0722));
 float mid=smoothstep(.03,.30,y)*(1.-.62*smoothstep(.61,.97,y));
 float noise=.85*hash(floor(gl_FragCoord.xy))+.15*hash(floor(gl_FragCoord.xy*.57)+vec2(91.,17.))-.5;
 return clamp(c+vec3(noise*.023*uStrength*(.25+.75*mid)),0.,1.);
}
void main(){gl_FragColor=vec4(finishColor(texture2D(uScene,vUv).rgb),1.);}`,
	});
}
