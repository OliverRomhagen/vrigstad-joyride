// The template experiment (?lab=hello): loaded only when its flag is on, it says so and does nothing else.
// Copy this folder to start a real one, and add its entry to LAB_EXPERIMENTS in ../flags.ts.

export function startHello(): void {
  console.info('Lab: hello is on.');
}
