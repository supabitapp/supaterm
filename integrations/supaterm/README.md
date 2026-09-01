# Supaterm Skill

```bash
sp agent setup
sp skills install
sp skills get core
sp skills get core --full
sp skills path core
sp skills get coding-agents
```

`sp agent setup` installs the skill before it sets up Claude and Codex hooks. `sp skills install`
refreshes only the skill. The running app copies a stable discovery skill to
`~/.agents/skills/supaterm` and links `~/.claude/skills/supaterm` to that shared copy. The detailed
guides stay in the app bundle so their commands always match the running version. Every command
needs a reachable app.
