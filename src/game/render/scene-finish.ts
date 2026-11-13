import * as THREE from "three";

interface FinishOptions {
	enabled: boolean;
	uniforms: Record<string, THREE.IUniform>;
	fragmentShader: string;
	state: Record<string, string | number | boolean>;
}

// #147 intentionally preserves display-space fog and an unconverted custom sky.
// r187 suppresses tone mapping for ordinary render targets. Copy the completed
// canvas instead: its ACES, sRGB transfer, fog, blending and MSAA stay upstream's.
// This GPU copy is part of the effect's cost; it is not a CPU readback.
export function createSceneFinish(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	options: FinishOptions,
) {
	const { enabled, uniforms, fragmentShader } = options;
	let frame: THREE.FramebufferTexture | undefined;
	const state = () => ({
		...options.state,
		enabled,
		targets: 0,
		framebufferTextures: enabled ? 1 : 0,
		fullscreenPasses: enabled ? 1 : 0,
		width: frame?.image.width ?? 0,
		height: frame?.image.height ?? 0,
	});
	if (!enabled)
		return { render: () => renderer.render(scene, camera), resize() {}, state };

	uniforms.uScene = { value: null };
	const screen = new THREE.Scene();
	const view = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const material = new THREE.ShaderMaterial({
		uniforms,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		vertexShader:
			"varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
		// No tone-mapping or color-space chunks: the copied bytes are already sRGB.
		fragmentShader,
	});
	screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
	const size = new THREE.Vector2();
	function resize() {
		renderer.getDrawingBufferSize(size);
		if (frame?.image.width === size.x && frame.image.height === size.y) return;
		frame?.dispose();
		frame = new THREE.FramebufferTexture(
			Math.max(1, size.x),
			Math.max(1, size.y),
		);
		// Raw RGBA8 storage; SRGBColorSpace would introduce hardware sampling decode.
		frame.colorSpace = THREE.NoColorSpace;
		uniforms.uScene.value = frame;
	}
	resize();
	return {
		render() {
			renderer.render(scene, camera);
			renderer.copyFramebufferToTexture(frame!);
			renderer.render(screen, view);
		},
		resize,
		state,
	};
}
