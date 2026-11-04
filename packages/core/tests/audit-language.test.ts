import { describe, it, expect } from 'vitest';
import { isDocumentLanguage } from '@qa/types';
import { detectPageLanguage, MIN_LETTERS, MIN_OTHER_SHARE, SCRIPT_TABLE } from '../src/audit/analysis/language.js';

const TAMIL = 'தமிழ்நாட்டின் சிறந்த உணவகம் எங்கள் சுவையான உணவுகளை இன்றே முயற்சி செய்யுங்கள்';
const ENGLISH = 'The best restaurant in Chennai, try our delicious dishes today and book a table';

describe('detectPageLanguage', () => {
  it('REQ-013 AC-1: mostly Tamil letters gives primary ta', () => {
    const result = detectPageLanguage(TAMIL, null);
    expect(result.primary).toBe('ta');
    expect(result.others).toEqual([]);
  });

  it('REQ-013 AC-2: mostly Latin letters gives primary en', () => {
    const result = detectPageLanguage(ENGLISH, null);
    expect(result.primary).toBe('en');
    expect(result.others).toEqual([]);
  });

  it('a Tamil page with English parts above the minimum share lists en in others', () => {
    const text = `${TAMIL} ${TAMIL} ${ENGLISH}`;
    const result = detectPageLanguage(text, 'ta');
    expect(result.primary).toBe('ta');
    expect(result.others).toEqual(['en']);
  });

  it('an English part below the minimum share is not listed', () => {
    const text = `${TAMIL.repeat(10)} OK`;
    const result = detectPageLanguage(text, null);
    expect(result.primary).toBe('ta');
    expect(result.others).toEqual([]);
  });

  it('others never contains the primary and has no duplicates', () => {
    const texts = [TAMIL, ENGLISH, `${TAMIL} ${ENGLISH}`, `${ENGLISH} ${TAMIL} ${ENGLISH} ${TAMIL}`];
    for (const text of texts) {
      const { primary, others } = detectPageLanguage(text, null);
      expect(others).not.toContain(primary);
      expect(new Set(others).size).toBe(others.length);
    }
  });

  it('declared is returned as written and does not decide primary', () => {
    expect(detectPageLanguage(TAMIL, 'en').primary).toBe('ta');
    expect(detectPageLanguage(TAMIL, 'en').declared).toBe('en');
    expect(detectPageLanguage(ENGLISH, 'ta-IN').declared).toBe('ta-IN');
    expect(detectPageLanguage(ENGLISH, 'ta-IN').primary).toBe('en');
  });

  it('declared is null when absent', () => {
    expect(detectPageLanguage(ENGLISH, null).declared).toBeNull();
    expect(detectPageLanguage(ENGLISH).declared).toBeNull();
    expect(detectPageLanguage(ENGLISH, undefined).declared).toBeNull();
  });

  it('fewer letters than the minimum gives not-identified', () => {
    expect(detectPageLanguage('', 'en')).toEqual({ primary: 'not-identified', others: [], declared: 'en' });
    expect(detectPageLanguage('Hello 123 !!! 456', null).primary).toBe('not-identified');
    expect(detectPageLanguage('a'.repeat(MIN_LETTERS - 1), null).primary).toBe('not-identified');
    expect(detectPageLanguage('a'.repeat(MIN_LETTERS), null).primary).toBe('en');
  });

  it('digits, punctuation and spaces are not letters', () => {
    const noise = '1234567890 ,.;:!?-–— ()[]{} '.repeat(5);
    expect(detectPageLanguage(noise, null).primary).toBe('not-identified');
    expect(detectPageLanguage(`${noise}${TAMIL}`, null).primary).toBe('ta');
  });

  it('mostly a script with no listed language gives not-identified', () => {
    const japanese = 'これは日本語のページです。私たちのレストランへようこそ。今日予約してください。';
    expect(detectPageLanguage(japanese, 'ja').primary).toBe('not-identified');
    const cyrillic = 'Добро пожаловать в наш ресторан, закажите столик сегодня';
    expect(detectPageLanguage(cyrillic, null).primary).toBe('not-identified');
  });

  it('a listed language present beside an unlisted primary is still listed in others', () => {
    const cyrillic = 'Добро пожаловать в наш ресторан, закажите столик сегодня';
    const result = detectPageLanguage(`${cyrillic} Menu Contact`, null);
    expect(result.primary).toBe('not-identified');
    expect(result.others).toEqual(['en']);
  });

  it('Latin letters with accents count as Latin', () => {
    expect(detectPageLanguage('Café crème brûlée à la française, très délicieux', null).primary).toBe('en');
  });

  it('primary is never an empty value', () => {
    for (const text of ['', ' ', TAMIL, ENGLISH, '日本語'.repeat(20)]) {
      const { primary } = detectPageLanguage(text, null);
      expect(primary === 'not-identified' || isDocumentLanguage(primary)).toBe(true);
    }
  });

  it('a Devanagari (Hindi) page is identified as hi', () => {
    const hindi = 'हमारे रेस्टोरेंट में आपका स्वागत है, आज ही अपनी मेज़ आरक्षित करें';
    const result = detectPageLanguage(hindi, 'hi');
    expect(result.primary).toBe('hi');
    expect(result.others).toEqual([]);
    expect(detectPageLanguage(hindi, 'en').primary).toBe('hi');
    expect(detectPageLanguage(`${hindi} Menu Contact Us Book`, null).others).toEqual(['en']);
  });

  it('is deterministic', () => {
    const text = `${TAMIL} ${ENGLISH}`;
    expect(detectPageLanguage(text, 'ta')).toEqual(detectPageLanguage(text, 'ta'));
  });

  it('the script table maps only to listed languages and the share threshold is a fraction', () => {
    for (const entry of SCRIPT_TABLE) expect(isDocumentLanguage(entry.language)).toBe(true);
    expect(SCRIPT_TABLE.find((s) => s.name === 'Tamil')?.ranges).toEqual([[0x0b80, 0x0bff]]);
    expect(MIN_OTHER_SHARE).toBeGreaterThan(0);
    expect(MIN_OTHER_SHARE).toBeLessThan(1);
  });
});
