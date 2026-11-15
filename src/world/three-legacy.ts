import * as THREE from 'three';

// Both pages keep the colour and light maths of three r128, which their looks were tuned with. Importing this module
// turns off colour management, so colours are used as written; it runs before the importing page's own code, so before
// any colour is made.
THREE.ColorManagement.enabled = false;

// r155 dropped the legacy light units: an r128 light of intensity 0.62 equals 0.62 * LEGACY_LIGHT now.
// Multiply every light's intensity by it.
export const LEGACY_LIGHT = Math.PI;
