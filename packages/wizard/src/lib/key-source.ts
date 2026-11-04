import type { AiKeySource } from '@qa/types';

/** Where the AI key is kept, in plain words. Never the key. Null when the runner didn't say. */
export function keySourceText(source: AiKeySource | undefined): string | null {
  switch (source) {
    case 'keychain':
      return 'In this computer’s system keychain';
    case 'byok_file':
      return 'In an encrypted file on this computer';
    case 'env':
      return 'In an environment variable';
    case 'cli':
      return 'Passed on the command line';
    default:
      return null;
  }
}
