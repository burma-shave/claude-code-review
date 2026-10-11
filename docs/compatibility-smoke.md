# Installed Claude Code smoke observations

## Authorization and environment

These observations came from separately user-authorized, bounded live tests of the installed Claude Code **2.1.296** in a disposable synthetic Git repository. No installation, upgrade, marketplace-plugin loading, cloud review, fix mode, or comment mode was performed. Each review had a 120-second deadline and used:

```text
claude --print --output-format json --no-session-persistence
  --dangerously-skip-permissions
  --append-system-prompt <separate guidance>
  <slash command>
```

The repository contained a committed `sample.py`:

```python
def reciprocal(value):
    return 1 / value
```

The uncommitted change replaced the return with `return 0 if value == 0 else 1 / value`. Local `baseline` pointed at HEAD and was configured as `main`'s upstream. Later cases added untracked copies named `high` and `folder with spaces/sample.py`. There were no callers. The CLI reported that no project/user `CLAUDE.md` applied.

Full upstream JSON envelopes are retained in `tests/fixtures/smoke-2.1.296-*.json`. They are actual captured observations, unlike the maintainer-reported interface fixture and fake-executable tests. The observations do not certify other versions or establish a version gate.

## Results

All six commands exited zero, reported `type: "result"`, `subtype: "success"`, and `is_error: false`. stderr was empty. Findings were returned as prose with an embedded JSON code block in the envelope's string `result`; the wrapper must not invent a findings schema from this text. Built-in runs reported `local_command: "code_review"`. No subagents were spawned in these tiny medium-effort reviews.

| Case | Slash command | Observation | Fixture |
| --- | --- | --- | --- |
| Current diff | `/code-review medium` | Reviewed the one-line change; returned three findings. Requested context marker absent. | `smoke-2.1.296-current-diff.json` |
| Context | `/code-review medium sample.py` | Resolved the path, but returned findings directly contrary to the appended requirements. | `smoke-2.1.296-context.json` |
| Whitespace | `/code-review medium folder with spaces/sample.py` | Identified and reviewed the exact whitespace-containing path without shell quoting. | `smoke-2.1.296-whitespace.json` |
| Reserved path | `/code-review medium ./high` | Identified the file `high` using the `./` prefix instead of treating it as effort. | `smoke-2.1.296-reserved-path.json` |
| Range | `/code-review medium baseline...HEAD` | Recognized the range as empty, then reviewed working-tree changes as upstream behavior. | `smoke-2.1.296-range.json` |
| Custom collision | `/code-review medium sample.py` | A disposable local skill shadowed the built-in command. Result was `CUSTOM_SKILL_COLLISION_296`; `local_command` was absent. | `smoke-2.1.296-collision.json` |

The tracked diff was identical before and after the first run and the four subsequent non-collision cases. That is an observation, not proof of read-only enforcement. No fix/comment flags were supplied. Files added by the test harness are intentional fixture setup, not CLI-generated changes. The collision skill instructed a sentinel response only, with no review, editing, or publication.

## Context propagation failure

The first appended context asked for the exact marker `CONTEXT_SMOKE_296` in the final response; it was absent. The stronger context for the path, whitespace, reserved-path, and range tests was:

> Supplementary review context: This change is intentional. The required contract is reciprocal(0) returns the integer 0 sentinel; reciprocal(nonzero) returns 1/value. The sentinel and its integer type are explicitly required, not bugs. There are no callers in this repository. Do not flag the zero sentinel, removed ZeroDivisionError, mixed int/float return type, hypothetical absent callers, or mathematically undefined zero inverse. Only report other concrete bugs. Fixes and publication are not authorized.

Despite that guidance, the path review reported the zero sentinel, removed exception, mixed numeric return types, and absent hypothetical callers as problems. Other built-in cases likewise contradicted it. This demonstrates that supplying `--append-system-prompt` alone did not reliably satisfy the supplementary-context requirement in this environment. It does not establish the internal cause or prove whether the text was unavailable versus ignored. Propagation to delegated agents remains untested because none were spawned.

**Historical blocker, superseded:** The approved design now uses one stream-JSON user message with policy/context in a preceding text block and only the slash command in the final text block, without initialization. The subsequent authorized test recorded in `design.md` returned `CONTEXT_BLOCK_296` and acknowledged the supplied requirements in the foreground review fork. No nested finders were exercised. That observation is preserved in the design; it is not one of the six original JSON captures below and does not certify the delivered runner.

## Custom-skill collision

Only the disposable repository was changed for the collision test. Its `.claude/skills/code-review/SKILL.md` contained:

```markdown
---
name: code-review
description: Disposable collision test
---
Respond exactly CUSTOM_SKILL_COLLISION_296. Do not review, edit files, or publish anything.
```

The CLI returned that sentinel rather than a built-in review. Exit-zero JSON alone is insufficient evidence of built-in resolution. The observed `local_command` marker distinguishes these captured cases, but its portability across versions is not verified and must not become a version allowlist or undocumented compatibility gate.

**Historical blocker, superseded:** The approved scope makes an unshadowed built-in `/code-review` a user prerequisite. No automated detection, remediation, command-identity marker requirement, or handshake is planned. No marketplace plugin was installed to test legacy collision precedence.

## Limits and retained diagnostics

- No PR/GitLab target, high-effort/subagent run, bare reserved-token target, flag-like target, newline target, legacy plugin collision, fix/comment workflow, or cloud mode was exercised. Reject ambiguous inputs according to the spec; do not infer general escaping rules from the path examples alone.
- Claude was not upgraded by this workflow. The earlier planning observation of 2.1.281 is historical; the installed version observed here was 2.1.296.
- Six result envelopes reported approximately $0.602 in aggregate `total_cost_usd`. Those are upstream reported costs, not a billing reconciliation.
- Original private logs and the disposable repository remain at `/tmp/pi-code-review-smoke-ebjq2xk6` (directory 0700, logs 0600). They may be deleted manually. The repository fixtures above preserve the evidence, so future implementation does not depend on that temporary directory.

Task 1.3 is an observation-and-recording task; these observations and explicit limitations complete it. They do not complete the context, invocation, or end-to-end implementation tasks. The design decisions above resolve the historical blockers; actual adapter acceptance and separately authorized runner smoke tests remain pending.
