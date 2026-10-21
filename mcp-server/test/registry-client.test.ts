import { describe, it, expect, vi } from 'vitest';
import {
  normalizeDepsDevSystem,
  lookupPackageEcosystem
} from '../src/registry-client.js';

describe('Registry Client', () => {
  it('normalizes package systems accurately', () => {
    expect(normalizeDepsDevSystem('npm')).toBe('npm');
    expect(normalizeDepsDevSystem('pypi')).toBe('pypi');
    expect(normalizeDepsDevSystem('cargo')).toBe('cargo');
    expect(normalizeDepsDevSystem('maven')).toBe('maven');
    expect(normalizeDepsDevSystem('go')).toBe('go');
    expect(normalizeDepsDevSystem('unknown')).toBe('npm');
  });

  it('handles unknown package lookups gracefully without throwing', async () => {
    const result = await lookupPackageEcosystem('this-package-should-definitely-not-exist-xyz-987654321', 'npm');
    expect(result.name).toBe('this-package-should-definitely-not-exist-xyz-987654321');
    expect(result.system).toBe('npm');
    expect(result.fetchedFrom).toBe('error');
    expect(result.openAdvisoriesCount).toBe(0);
    expect(result.error).toBeDefined();
  });

  it('fetches real metadata for a well-known package or falls back gracefully', async () => {
    // We test with 'zod' on npm
    const result = await lookupPackageEcosystem('zod', 'npm');
    expect(result.name).toBe('zod');
    // If online, it will have fetched from deps.dev or registry; if offline, it handles gracefully
    if (result.fetchedFrom !== 'error') {
      expect(result.latestVersion).toBeDefined();
      expect(result.license).toBeDefined();
    }
  });
});
