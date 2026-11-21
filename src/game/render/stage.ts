// The stage: the renderer's settings, and the scene with its fog, lights, sky and camera.
// Moved from src/game/main.ts (#177); main.ts makes the renderer, since it shows the fail screen when WebGL is missing, and passes it in.
import * as THREE from 'three';
import { parseCloudConfig } from '../../world/clouds';
import { col, LEGACY_LIGHT } from '../../world/three-legacy';
import { Sky } from './sky';

// filmic tone mapping on an sRGB pipeline: colours below are written in sRGB and converted to linear with col()
// three applies fog after the output colour space conversion, so the fog, clear and sky colours stay in sRGB
const HORIZON = 0xd6e4e6,
  FOG_PER_M = 0.0007; // FogExp2 density: about 40% haze at 1 km
export const SUN_DIR = new THREE.Vector3(-0.55, 0.75, 0.37).normalize();
// sky: a gradient dome with the sun's glow and drifting fair-weather clouds (src/game/render/sky.ts); it follows the camera
// and fades into the fog at the horizon. ?clouds=clear|scattered|partly|mostly|off, cloudSeed, wind=from°,m/s (see clouds.ts)
export const SUN_I = 0.95 * LEGACY_LIGHT; // the sun's intensity under a clear sky; a cloud in front of it takes some away

/** Sets up the renderer: pixel ratio, shadows, colour space and tone mapping. */
export function setUpRenderer(renderer: THREE.WebGLRenderer, coarse: boolean) {
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
}

/** The scene with its fog, lights and sky dome, and the camera; `search` is the page's query string, for the clouds. */
export function buildStage(coarse: boolean, search: string) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.FogExp2(HORIZON, FOG_PER_M);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.8, 4200);
  scene.add(new THREE.HemisphereLight(0xffffff, col(0x9aa58a), 0.62 * LEGACY_LIGHT));
  const sun = new THREE.DirectionalLight(col(0xfff4dd), 0.95 * LEGACY_LIGHT); // intensity: SUN_I, times the clouds' sunFactor
  const skyDome = new Sky({
    top: 0x5f97c9,
    horizon: HORIZON,
    sunColour: 0xfff1d0,
    sunDir: SUN_DIR,
    clouds: parseCloudConfig(new URLSearchParams(search), coarse),
  });
  const dome = skyDome.mesh;
  scene.add(dome);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 50, far: 800 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  return { scene, camera, sun, skyDome };
}
