import { describe, expect, it } from 'vitest';

describe('car-damage', () => {
  it('imports without a DOM: the crack and smoke textures are drawn when a CarDamageFx is made, not at import', async () => {
    expect(typeof document).toBe('undefined');
    const { CarDamageFx } = await import('../../../../src/game/render/car-damage');
    expect(CarDamageFx).toBeTypeOf('function');
  });
});
