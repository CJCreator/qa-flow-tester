# 0014: Verified Domains and Host Checks for Shared Machines

Status: Accepted 2026-10-07 (owner answers recorded under Decisions for owner).

Builds on [0003](0003-deterministic-safety-filters-for-ai-discovery.md) (Safety Filter, host confinement), [0008](0008-single-local-server.md) and [0012](0012-hosted-runner-github-actions.md) (beta mode, shared online copy). Wording follows [0018](0018-claim-wording.md).

## Context and Decision
A Test Copy is the only kind of App where the tool fills in and sends forms. Today `isTestHost` decides that from the text of the host name alone: `localhost`, private ranges, `*.devtunnels.ms`, or a host the person typed in as a test copy (`QA_STAGING`), plus an `x-test-copy` response header. On the person's own computer that is fine: they own the machine and the risk.

On a shared machine (the online beta copy, started with `RUNNER_BETA=1`) it is a hole. Anyone can type a live site they do not own as "a test copy", or use a name that points at a private address (a DNS name resolving to `127.0.0.1` or `169.254.169.254`, a redirect to one, or a name that changes its answer between two lookups). The tool would then send forms from our machine to a site that never agreed to it, or reach the machine's own network.

We decided:

### Where it applies
- **Local mode is unchanged.** The text-only `isTestHost` stays as it is, with no DNS lookup. A Test Copy there is still a local address, a dev tunnel, or a host the person marked.
- **"Shared machine" means a runner started with `RUNNER_BETA=1`.** It is the only shared mode that exists. Any future hosted mode must set it.

### The rule on a shared machine
An address is a Test Copy only if ALL of these hold:
1. The owner marked it as a test copy (typed it in).
2. Every address its name resolves to is public.
3. A Verified Domain proof for its exact origin passes, re-fetched at the start of every run.

Marked alone is not a Test Copy (the hole above). Verified alone is not a Test Copy either (see Decisions for owner, 3): a live site under a verified domain stays live and read-only unless the owner also marks it.

On a shared machine the text-only shortcuts stop conferring Test Copy: `*.devtunnels.ms`, `localhost`, private ranges, and the `x-test-copy` / `x-staging` response header. Private and loopback targets stay refused outright by the beta rule in 0012.

### Verified Domain proof (owner decisions 1 to 4)
1. **File only.** The proof is the file `https://<host[:port]>/.well-known/qa-verify.txt`. No meta tag, no DNS record. (This narrows the three mechanisms listed in the platform plan, Item 1.7.)
2. **Token per runner session, in memory.** A random token (`randomBytes(24)`, base64url) per session and origin, kept with the session's other secrets in the beta session store. Nothing is written to disk. The token is public once published, but it is only valid in the session that issued it. It is never logged and never appears in events, reports or findings.
3. **Per exact origin.** The proof is served on the exact host (and port) being tested. A proof on a sibling or parent host does not count. This is what makes shared-suffix hosts (`*.vercel.app`, `*.github.io`) work: each preview proves itself, and we do not verify registered domains.
4. **Re-verified at the start of every run.** Nothing is cached between runs.

Proof contract (added by the plan, owner may veto):
- https only; same host; **zero redirects followed** (any 3xx fails); body at most 4 KB.
- The body is one line, `qa-verify=<token>`, trimmed, exact match.
- Not allowed as a proof origin: userinfo in the URL, IP literals, private text hosts.
- The proof route is open to beta sessions only, allows one fetch per origin per 10 seconds per session, and never returns the fetched body, only a reason code (`not-https`, `not-found`, `mismatch`, `redirected`, `private-address`, `dns-failed`, `timeout`, `too-large`).

### Address classes refused
Every resolved address (and every literal IP) is classified. Anything in these classes is not public:

| Class | Ranges |
| --- | --- |
| unspecified | 0.0.0.0/8, `::` |
| loopback | 127.0.0.0/8, `::1` |
| private | 10/8, 172.16/12, 192.168/16 |
| link-local | 169.254/16, fe80::/10 |
| metadata | 169.254.169.254, fd00:ec2::254 (inside fc00::/7) |
| unique-local | fc00::/7 |
| carrier NAT | 100.64/10 |
| multicast and reserved | 224/4, 240/4 |
| embedded IPv4 | IPv4-mapped `::ffff:a.b.c.d` and `::ffff:hhhh:hhhh`, IPv4-compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`: the embedded IPv4 is classified again |

Text hosts also refused: `localhost`, `*.localhost`, `host.docker.internal`. The classifier is hand-written, import-free and browser-safe (no `node:net`), so the wizard can share it.

### Redirect and pinning rules
- **Resolve once per hop, connect to the checked address.** The connection goes to the IP that was classified, with the original host in the `Host` header and TLS server name. A second lookup can never swap the address.
- **Every redirect hop is checked again:** new resolution, no cache, same classes, only http(s). Limit 5 hops (the proof uses 0).
- **Fail closed everywhere.** A DNS error, a timeout, an empty answer, or one bad address in a mixed answer means the host is not a Test Copy (live, read-only) and the proof fails.

### Browser guard and its limit
- On a shared machine every browser request passes a per-request guard: the host is resolved afresh and an abort happens if any address is not public (a redirected request is checked the same way). Non-network schemes (`data:`, `blob:`, `about:`) pass. The guard falls through to later routes, so `blockChanges` still aborts POST, PUT, PATCH and DELETE.
- The target host is pinned to the checked address in the browser launch.
- **Residual risk, stated plainly:** Chromium resolves third-party hosts itself. A name with a TTL of 0 that turns private on a host other than the target can slip through the short gap between the guard's check and the browser's connect. Runs on a shared machine only send GET to non-test sites (read-only), so what is exposed is a blind GET, not a form send. We accept this for now.
- Out of scope here: hardening `RobotsPolicy.fetch` redirects (a blind GET whose answer is only parsed). Logged as a follow-up.

### Unchanged
- Read-only is still the default: no owner say-so, or no Test Copy, means the App is only looked at.
- Host confinement (0003) is not loosened: the guard adds a refusal, never an allowance. It does not consult or widen the allowed host list.
- `blockChanges`, the Safety Filter and redaction are untouched.
- Local mode, and the GitHub Actions route (Option A in 0012), where the owner's own CI points at what it tests.
- Wording: the tool says "Verified Domain" and "test copy" in UI text, never "staging", "secure" or "safe" (0018). A verified proof shows control of one address at one moment, not that the site is fine.

## Decisions for owner
Owner answers, 2026-10-07: (1) yes, re-check at plan approve; (2) yes, https required on a shared machine; (3) no, a Verified Domain alone does not make a Test Copy: it needs marked AND verified AND public. The owner first leaned to "verified alone is enough", then reverted after the production-write risk was explained. Read-only default and host confinement are unchanged.

1. **Re-verify when a waiting plan is approved, not only at run start?** Today the decision is made at `POST /api/runner/run` (and preflight when marked); approving a waiting plan does not check again, so a proof removed in between still lets the run send forms.
   - Recommended: **yes, re-check at approve**. It costs one fetch and closes the gap. If you say no, a parked plan keeps the decision it was made with.
2. **Require https for the target site itself, not just the proof?** The proof file is always fetched over https, from the exact origin. An http origin has a different exact origin, so it could not be matched to a proof anyway; this asks whether to say so out loud and refuse it with a clear reason.
   - Recommended: **yes, https required on a shared machine** for a Test Copy (a proof needs https, so an http origin can never be verified). Local mode keeps http for localhost and tunnels.
3. **Does a Verified Domain alone make a Test Copy?**
   - Recommended: **no**. Test Copy needs marked AND verified AND public. A production site on a verified domain stays live and read-only unless the owner marks it, so verifying never turns a live site into a place that receives forms by accident.

## Consequences
- Shared-machine users who want full testing must publish one small file per address, once per session. A new preview address needs its own file. This is deliberate friction.
- A shared machine can no longer treat a dev tunnel name or the `x-test-copy` header as a Test Copy. People wanting that use their own computer or GitHub Actions.
- The proof route is an outbound-request feature on a public beta. It is limited (beta session only, one fetch per origin per 10 s, no redirects, 4 KB, no body returned, private addresses refused). Quotas beyond this belong to platform plan Item 1.7 step 3.
- Cost: one DNS lookup per hop and one proof fetch per run on a shared machine. Local mode pays nothing.
- Parked plans created before this change keep the read-only choice they were stored with; the new rule applies to new runs.
- Security Probes also need a Test Copy, so they inherit this rule. Legal review for Probes is still open and is not settled here.
- Pure address and proof-line logic lives in two import-free core files; the network code (DNS, pinned fetch, browser guard) is Node-only and separate, so the wizard build never pulls in Node modules.
