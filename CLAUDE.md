@AGENTS.md

# Claude-specific notes

Claude Code is a full executor here, on the same terms as Codex: see "Agent
collaboration" in `AGENTS.md`. When a session was started as a consultation
through the `consult-claude` skill, Claude works only on the sealed snapshot it
was given and returns tradeoffs, objections, risks, and a recommendation;
the requesting agent applies the changes.

`/codex:review`, `/codex:adversarial-review`, `/codex:transfer`,
`/codex:status`, `/codex:result`, and `/codex:cancel` remain user-invoked and
cannot be called automatically. Use them only when the user explicitly asks
for that separate Codex-plugin workflow.
