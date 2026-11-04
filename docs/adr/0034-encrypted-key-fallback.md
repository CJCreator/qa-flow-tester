# 0034: The Key Fallback File Is Encrypted; Named Service Keys Use the Same Resolver

Status: Accepted, 2026-10-31. Amends the key storage part of [0002](0002-multi-provider-byok-ai-adapter.md).
Records DEC-004 (REQ-040, REQ-011).

## Context
ADR 0002 keeps saved AI keys in the OS keychain. Where none exists (headless Linux, a Docker container, Cloud Run),
`key-resolver.ts` wrote them to `.qa-keys.json` in plain text, mode 600. REQ-040 needs keys encrypted at rest: a
copied data folder or file must not reveal them, and they must still work after a restart. The Website audit also
needs a key that is not an AI key (the Google PageSpeed Insights key), kept just as carefully.

## Decision
- **Keychain path unchanged.** Keys still go to the OS keychain first, and are read from it first.
- **Encrypted fallback file.** With no keychain, `.qa-keys.json` holds one AES-256-GCM envelope:
  `format` (`qa-keys/encrypted`), `version` (1), `cipher`, `keySource`, `salt` (only for `env`), `iv`, `tag`, `data`.
  A new random 96-bit IV is drawn on every write; the tag is 128 bits and is required to be 128 bits on read. The
  header fields are bound as additional authenticated data, so a changed header or cipher text is refused. Keys
  only ever exist in the cipher text. Writes go to a temporary file (mode 600) that is renamed over the old one, and
  saves in one process are queued so none is lost.
- **Where the encryption key lives (never beside the file):**
  - `local` (default): a random 256-bit key, made once, in the user's config folder:
    `$XDG_CONFIG_HOME/qa-flow-tester/key-file.key`, else `%APPDATA%\qa-flow-tester\` on Windows, else
    `~/.config/qa-flow-tester/` (folder 700, file 600). The data folder never holds it.
  - `env`: when `QA_KEYS_ENCRYPTION_KEY` is set (at least 16 characters; a random value of 32 or more is
    recommended), the key is derived from it with scrypt and a random 128-bit salt kept in the file. No key file is
    made. Use this when the data folder outlives the machine's config folder, such as a Docker volume.
  - A file is read with the source it records, and the next write uses the current source, so setting the variable
    later moves the file over on the next save.
- **Legacy plaintext file.** A `.qa-keys.json` without the envelope is read once, its keys are used, and it is
  rewritten encrypted at once. If that rewrite fails, the keys still work for this run and a warning is printed.
- **Never plain text.** If the file cannot be encrypted (unwritable config folder, a too-short secret), saving fails
  with an error. Nothing falls back to plain text.
- **Unreadable file.** A file that cannot be decrypted (other machine, missing or changed secret, tampering) gives no
  keys and a warning naming the file, never a key. The next save replaces it.
- **Named service keys.** `saveServiceKey(name, key)` and `resolveServiceKey(name)` use the same order as AI keys:
  keychain (account `service:<name>`), then the encrypted file, then an environment variable. The first name is
  `pagespeed` (`PAGESPEED_API_KEY`). Names are a fixed list; an unknown name or an empty key is refused. Service keys
  are never returned as AI keys.
- Sign-in passwords (`saveSecret`) stay keychain-only, as before.

## Why this, not refusing to save without a keychain
Refusing would make every headless or container user pass the key on each run. Encrypting keeps "save once" working
while a copied data folder, backup or stray `.qa-keys.json` shows nothing.

## Consequences
- A copy of the whole disk or home folder includes both the file and the `local` key. That is the limit of this
  design without a keychain; `QA_KEYS_ENCRYPTION_KEY` held outside the disk (a secret manager) closes it.
- Docker with a mounted data folder: the `local` key lives in the container, so recreating the container loses access
  and keys must be saved again. Set `QA_KEYS_ENCRYPTION_KEY` to keep them across containers. Restarting the same
  container keeps them.
- Copying `.qa-keys.json` to another machine no longer carries the keys. `scripts/tunnel.mjs` and the runner's move of
  legacy data copy it on the same machine, so they keep working.
- The hosted beta keeps keys in the visitor's session only (ADR 0002). Its session resolver must also keep service keys
  in the session before any beta route saves one.
- `SECURITY.md` and `docs/CONFIGURATION.md` must describe the encrypted file, the key location and the two variables
  by name.
