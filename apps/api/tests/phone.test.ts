import { describe, expect, it } from 'vitest';
import { normalizeKenyanPhone } from '../src/shared/phone';

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0112345678', '254112345678'],
    ['+254712345678', '254712345678'],
    ['254712345678', '254712345678'],
    ['712345678', '254712345678'],
    ['0712 345 678', '254712345678'],
    ['+254 (712) 345-678', '254712345678'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '071234567', '07123456789', '0212345678', '254812345678', '+1 415 555 0100', '0712-ABC-678'])(
    'rejects %j',
    (input) => {
      expect(normalizeKenyanPhone(input)).toBeNull();
    },
  );
});
