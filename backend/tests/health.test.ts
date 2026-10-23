import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';

describe('Backend Foundation Health Endpoint', () => {
  it('should initialize Express application instance', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe('function');
  });
});
