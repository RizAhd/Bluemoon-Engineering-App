/**
 * The matching rule behind every search box: words in any order, case ignored, amounts found with or without their
 * grouping commas, Sinhala and Tamil as plain substrings; and the same rule as SQL LIKE fragments with bound values.
 */
import '@/test-utils/rnMocks'; // must be first: the hook file draws the search box, which loads the native UI modules

import { LIKE, likePattern, likeQuery, matchesQuery, searchWords } from '@/hooks/search';

describe('matchesQuery', () => {
  const row = ['Lanka Cement Depot, Welimada', 'Rs 1,250.00', 'Materials', null, undefined, ''];

  it('an empty or blank query matches everything', () => {
    expect(matchesQuery(row, '')).toBe(true);
    expect(matchesQuery(row, '   ')).toBe(true);
    expect(matchesQuery([], '')).toBe(true);
  });

  it('ignores case', () => {
    expect(matchesQuery(row, 'lanka')).toBe(true);
    expect(matchesQuery(row, 'LANKA CEMENT')).toBe(true);
    expect(matchesQuery(['LANKA CEMENT'], 'Cement lanka')).toBe(true);
  });

  it('every word must be in some field, in any order', () => {
    expect(matchesQuery(row, 'depot lanka')).toBe(true);
    expect(matchesQuery(row, 'lanka materials')).toBe(true); // two words from two fields
    expect(matchesQuery(row, 'welimada cement  lanka')).toBe(true); // three, extra spaces
    expect(matchesQuery(row, 'lanka hardware')).toBe(false); // one word missing
    expect(matchesQuery(row, 'lankacement')).toBe(false); // a word is not split
  });

  it('digits find amounts with their grouping commas ignored', () => {
    expect(matchesQuery(row, '1250')).toBe(true);
    expect(matchesQuery(row, '1,250')).toBe(true);
    expect(matchesQuery(row, '1250.00')).toBe(true);
    expect(matchesQuery(row, '1,250.00')).toBe(true);
    expect(matchesQuery(['Rs 12,500'], '1250')).toBe(true); // the digits run on across the comma
    expect(matchesQuery(['Rs 1,250,000'], '1250000')).toBe(true);
    expect(matchesQuery(row, '1251')).toBe(false);
    expect(matchesQuery([1250, 'x'], '1,250')).toBe(true); // a number field
    expect(matchesQuery(['Rs 1,250'], 'lanka 1250')).toBe(false); // the other word is still required
  });

  it('a comma in a word that is not a number is part of the word', () => {
    expect(matchesQuery(row, 'depot,')).toBe(true);
    expect(matchesQuery(row, 'welimada,')).toBe(false);
  });

  it('Sinhala and Tamil are plain substrings', () => {
    expect(matchesQuery(['වැලිමඩ ප්‍රාථමික පාසල', 'ශ්‍රී ලංකා'], 'පාසල ලංකා')).toBe(true);
    expect(matchesQuery(['වැලිමඩ ප්‍රාථමික පාසල'], 'පාස')).toBe(true);
    expect(matchesQuery(['பதுளை கல்வெட்டு'], 'கல்வெட்டு')).toBe(true);
    expect(matchesQuery(['பதுளை கல்வெட்டு'], 'மதுரை')).toBe(false);
  });

  it('empty, null and undefined fields match nothing', () => {
    expect(matchesQuery([null, undefined, ''], 'a')).toBe(false);
  });

  it('searchWords lower-cases and splits on any run of spaces', () => {
    expect(searchWords('  Lanka   CEMENT ')).toEqual(['lanka', 'cement']);
    expect(searchWords('')).toEqual([]);
  });
});

describe('likeQuery', () => {
  it('on its own it gives one bare LIKE fragment per word with the pattern bound', () => {
    const words = likeQuery('Lanka depot');
    expect(words.map((w) => w.word)).toEqual(['lanka', 'depot']);
    expect(LIKE).toBe("LIKE ? ESCAPE '\\'");
    expect(words.map((w) => w.sql)).toEqual([LIKE, LIKE]);
    expect(words.map((w) => w.args)).toEqual([['%lanka%'], ['%depot%']]);
    expect(words.map((w) => w.cents)).toEqual([null, null]);
  });

  it('with columns it gives the OR group over them, the pattern bound once per column in order', () => {
    const words = likeQuery('Lanka depot', ['e.paid_to', 'e.note']);
    expect(words[0].sql).toBe("(e.paid_to LIKE ? ESCAPE '\\' OR e.note LIKE ? ESCAPE '\\')");
    expect(words[0].args).toEqual(['%lanka%', '%lanka%']);
    expect(words[1].args).toEqual(['%depot%', '%depot%']);
  });

  it('a word that reads as an amount also carries its cents, with or without commas', () => {
    expect(likeQuery('1,250').map((w) => w.cents)).toEqual([125000]);
    expect(likeQuery('1250.50 12').map((w) => w.cents)).toEqual([125050, 1200]);
    expect(likeQuery('12a').map((w) => w.cents)).toEqual([null]);
    expect(likeQuery('1.234').map((w) => w.cents)).toEqual([null]); // more than two decimals is not an amount
  });

  it('makes % and _ (and the escape itself) literal in the pattern', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('c:\\dir')).toBe('%c:\\\\dir%');
    expect(likeQuery('50%_off', ['n'])[0].args).toEqual(['%50\\%\\_off%']);
    expect(likeQuery("x' OR 1=1 --")[0].args).toEqual(["%x'%"]); // a quote is just a character in a bound value
  });

  it('nothing typed means no fragments; no columns means a group that matches nothing', () => {
    expect(likeQuery('   ')).toEqual([]);
    expect(likeQuery('   ', ['a'])).toEqual([]);
    expect(likeQuery('x', [])[0]).toEqual({ word: 'x', sql: '0', args: [], cents: null });
  });
});
