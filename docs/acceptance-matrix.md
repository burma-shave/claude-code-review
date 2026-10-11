# Acceptance matrix

Run `npm run check` for type checking and the offline unit/fake-process suite. All fake executables use local temporary directories; the default suite requires neither production credentials nor external writes. Fixture provenance distinguishes maintainer-reference derivation, captured earlier installed-CLI observations, and synthetic output. A fake `--fix`/`--comment` invocation tests mapping only, not real edits or publication.

## Delta-spec requirements

| Requirement | Acceptance evidence | Limits |
| --- | --- | --- |
| Built-in skill invocation | `claude.test.ts`, `runner.test.ts`, `smoke-fixtures.test.ts`; README prerequisites | Version diagnostics never gate; unshadowed built-in is a user prerequisite. Recorded live envelopes are historical, not current adapter certification. |
| Structured review targets | `inputs.test.ts`, `targets.test.ts`, `invocation.test.ts`, README snapshots | Explicit/inferred repository, URLs, paths, ranges, missing context and lookup errors; conservative target grammar. |
| Local effort selection | `inputs.test.ts`, `invocation.test.ts`, `results.test.ts`, `skill.test.ts` | Explicit medium default and source; every local override. |
| Finding limit selection | `inputs.test.ts`, `invocation.test.ts`, `results.test.ts` | Positive integer/all/default, invalid values, inherited marker without guessed cap. |
| Explicit side-effect options | `inputs.test.ts`, `transport.test.ts`, `runner.test.ts`, `skill.test.ts` | All boolean combinations and context requesting publication; actual fix/comment acceptance remains task 6.4. |
| Separate supplementary context | `transport.test.ts`, `runner.test.ts`, recorded observations in design | One message/two blocks, final canonical command, no handshake or appended-system-prompt. Current runner live context/finder acceptance remains task 6.3. |
| Manual-only cloud review | `cloud.test.ts`, `skill.test.ts` | No child launch, no substitution, billing/access/manual guidance. Cloud never exercised. |
| Safe argument handling | `inputs.test.ts`, `invocation.test.ts`, `transport.test.ts`, `targets.test.ts` | Unknown CLI fields, reserved/flag/newline inputs rejected; shell-free argv and serialized context. |
| Default Claude permission bypass | `transport.test.ts`, `runner.test.ts`, `skill.test.ts`, README | Exact default bypass flag; false fix/comment is not read-only enforcement. |
| Working directory and bounded execution | `runner.test.ts`, `lifecycle.test.ts`, `shutdown.test.ts`, `adapter.test.ts` | cwd validation, cancellation/preflight/lookup/review timeout, descendants, unrelated process, cleanup races. Windows tree termination unexercised on Linux; escaped descendants/remote effects outside guarantee. |
| Review results and logs | `decoder.test.ts`, `results.test.ts`, `display.test.ts`, `logs.test.ts`, `runner.test.ts`, `adapter.test.ts` | Final envelope extraction, error statuses/schema, partial failures, fragmented UTF-8, oversized intermediate/final records, duplicate/missing results, private concurrent full logs, display bounds and notices. |
| Wrapper skill and installation guidance | `skill.test.ts`, `package.test.ts`, `readme.test.ts` | Pi skill discovery with no diagnostics, typed request examples and package resources. `pi-integration.test.ts` additionally verifies actual interactive and headless adapter acceptance with an offline model and fake Claude. |

## Execution record

- Task 6.1: `npm run check` passed type checking and all 319 then-existing tests on Linux, Node 24.21.0. The added matrix-coverage test also passed (320 tests total); `npm pack --dry-run` includes the extension, skill, and source modules. Resource validation confirms both manifest paths exist and host packages remain peers rather than bundled dependencies.
- Task 6.2: all four `pi-integration.test.ts` tests passed against installed Pi 1.1.0. The final `npm run check` passed type checking and all 324 tests. Actual JSON headless and pseudo-terminal interactive processes load the package by its manifest, advertise the tool and skill, and invoke the delivered adapter with fake Claude on PATH. Each mode exercises current diff, inferred numeric PR (fake gh), direct URL, range, whitespace-containing path, every local effort (including default medium), all finding-limit forms, authorized fake fix/comment mapping, hostile multiline context, full-log reads, multibyte truncation, result-level failure, timeout, and turn cancellation. Captured argv/stdin/cwd and structured output are asserted; retained logs are cleaned up by tests. The fixture model is deterministic and offline, not an assessment of an LLM's instruction-following. Fake side effects do not certify real publication. The test harness requires Pi, Python 3, and POSIX PTY support; Windows interactive acceptance is unexercised. Keep `read` active for Pi to advertise skills; tool-only loadouts suppress the skill hint.
- Task 6.3: pending separate authorization for a live installed-Claude review through the delivered runner. Do not treat historical observations as this acceptance run.
- Task 6.4: pending separately authorized real fix/comment tests or equivalent captured upstream integration fixtures. No claim of tested publication support.
