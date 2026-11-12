import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('App.tsx lazy screens (LAT-11)', () => {
  const source = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('the Check-up screens are not imported statically', () => {
    expect(source).not.toMatch(/^import \{[^}]*\b(PlanReviewScreen|ScanningScreen|TestingScreen)\b[^}]*\} from/m);
  });

  it('each is loaded with lazy', () => {
    for (const name of ['PlanReviewScreen', 'ScanningScreen', 'TestingScreen']) {
      expect(source).toMatch(new RegExp(`const ${name} = lazy\\(\\(\\) =>\\s*import\\('\\./screens/${name}'\\)`));
    }
  });

  it('the scan progress check comes from lib', () => {
    expect(source).toContain("from './lib/scan-progress'");
  });
});
