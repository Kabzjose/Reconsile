import { describe, expect, it } from 'vitest';
import { normalizeReference, referenceKey } from '../src/shared/schemas';

describe('normalizeReference', () => {
  it('trims, collapses spaces and upper-cases', () => {
    expect(normalizeReference('  ord-1042 ')).toBe('ORD-1042');
    expect(normalizeReference('ord   1042')).toBe('ORD 1042');
  });
});

describe('referenceKey (loose matching key)', () => {
  it('makes the ways real payers type the same reference equal', () => {
    const keys = ['ORD-1042', 'ord 1042', 'Ord1042', 'ORD_1042.'].map(referenceKey);
    expect(new Set(keys)).toEqual(new Set(['ORD1042']));
  });
  it('keeps different references different', () => {
    expect(referenceKey('ORD-1042')).not.toBe(referenceKey('ORD-1043'));
  });
});
