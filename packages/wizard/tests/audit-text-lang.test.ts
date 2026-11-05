import { describe, expect, it } from 'vitest';
import { textLangAttrs } from '../src/screens/audit/results/analysis-text';

// example.com now says the same thing in several languages, one line each.
const MIXED = [
  'This domain is for use in documentation examples without needing permission.',
  'هذا النطاق مُخصص للاستخدام في أمثلة التوثيق دون الحاجة إلى إذن.',
  '该域名仅用于文档示例，无需获得许可。',
  "L'usage de ce domaine est réservé à des exemples de documentation.",
].join('\n');

describe('textLangAttrs', () => {
  it('marks text written in a listed script with its language', () => {
    expect(textLangAttrs('எங்கள் சேவைகள்', 'ta')).toEqual({ lang: 'ta' });
    expect(textLangAttrs('हमारी सेवाएँ', 'mr')).toEqual({ lang: 'mr' });
    expect(textLangAttrs('हमारी सेवाएँ', 'not-identified')).toEqual({ lang: 'hi' });
    expect(textLangAttrs('ہماری خدمات', 'not-identified')).toEqual({ lang: 'ur', dir: 'rtl' });
  });

  it('leaves English and other Latin text to the UI language', () => {
    expect(textLangAttrs('Welcome to our shop', 'en')).toEqual({});
    expect(textLangAttrs('', 'en')).toEqual({});
  });

  it('keeps mixed text left-to-right: one Arabic-script line does not mark the block as Urdu', () => {
    expect(textLangAttrs(MIXED, 'en')).toEqual({});
  });

  it('marks text that is mostly one listed script, even with a Latin brand name in it', () => {
    expect(textLangAttrs('Kavi Web Works: நாங்கள் கணினி பழுது பார்க்கிறோம்', 'ta')).toEqual({ lang: 'ta' });
  });
});
