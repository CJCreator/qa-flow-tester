# 0002: Multi-Provider BYOK AI Adapter

## Context and Decision
While the original specification assumed Claude exclusively, development teams use various LLM providers (Claude, OpenAI, Google Gemini, OpenRouter) with different cost and quota arrangements. We decided to implement a generic `AIProvider` interface with a multi-layer credential resolution system supporting Bring Your Own Key (BYOK).

## Credential Resolution Hierarchy
As built (`packages/core/src/ai/key-resolver.ts`; amended 2026-10-21 by T-63, which found the keychain tier already in code and this record out of date):
1. An explicit key for the run (passed to the resolver, or `QA_AI_API_KEY` in a check-up from CI).
2. For the preferred provider, in order: the OS keychain (when the computer has one), the legacy `.qa-keys.json` file (strictly ignored in git; written only when no keychain exists), then the standard environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`).
3. If the preferred provider has no key, the other providers are tried in the order Anthropic, OpenAI, Gemini, OpenRouter, each with the same three steps.

A beta copy keeps keys in the visitor's session only: never in the keychain, a file or the environment.

## Consequences
- The discovery and planning engine is decoupled from any single proprietary AI model.
- Teams can select optimal models based on pricing, vision capabilities, or enterprise data compliance (e.g. self-hosted OpenRouter or regional endpoints).
- In automated test suites, a `MockAIProvider` can simulate discoveries without live API calls.
