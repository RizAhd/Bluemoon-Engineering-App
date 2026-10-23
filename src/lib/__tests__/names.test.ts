import { withoutTitle } from '@/lib/names';

describe('withoutTitle', () => {
  it('drops a leading title so initials come from the name', () => {
    expect(withoutTitle('Mr. K. Silva')).toBe('K. Silva');
    expect(withoutTitle('mrs Nimali Perera')).toBe('Nimali Perera');
    expect(withoutTitle('Dr. A. Bandara')).toBe('A. Bandara');
    expect(withoutTitle('Eng. R. Kumar')).toBe('R. Kumar');
  });

  it('keeps names that only look like a title, and a title on its own', () => {
    expect(withoutTitle('Mrinal Das')).toBe('Mrinal Das');
    expect(withoutTitle('Dr.')).toBe('Dr.');
    expect(withoutTitle('සුනිල්')).toBe('සුනිල්');
  });
});
