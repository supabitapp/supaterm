enum AgentDetectionRules {
  static let generation: UInt64 = 1

  static let ruleSet = AgentDetectionRuleSet(
    agents: [
      AgentDetectionAgentRule(
        id: "claude",
        displayName: "Claude Code",
        processes: [
          AgentDetectionProcessRule(executable: "claude"),
          AgentDetectionProcessRule(
            executable: "node",
            scriptSuffix: "/@anthropic-ai/claude-code/cli.js"
          ),
        ],
        rules: [
          AgentDetectionStateRule(
            id: "osc_title_working",
            result: .running,
            priority: 1100,
            region: .oscTitle,
            gate: AgentDetectionGate(
              regex: [#"^[\x{2800}-\x{28FF}\x{25D0}-\x{25D3}] "#]
            )
          ),
          AgentDetectionStateRule(
            id: "btw_overlay_working",
            result: .running,
            priority: 975,
            region: .bottomNonEmptyLines(5),
            gate: AgentDetectionGate(
              lineRegex: [
                #"^\s*/btw(?:\s|$)"#,
                #"(?i)esc to close\s*$"#,
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "transcript_viewer",
            result: .hold,
            priority: 1000,
            region: .bottomNonEmptyLines(3),
            gate: AgentDetectionGate(
              contains: ["showing detailed transcript"],
              any: [
                AgentDetectionGate(contains: ["ctrl+o", "to toggle"]),
                AgentDetectionGate(contains: ["ctrl+e", "show all"]),
                AgentDetectionGate(contains: ["ctrl+e", "collapse"]),
                AgentDetectionGate(contains: ["↑↓ scroll"]),
                AgentDetectionGate(contains: ["? for shortcuts"]),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "live_blocked_form",
            result: .needsInput,
            priority: 980,
            region: .afterLastHorizontalRule,
            gate: AgentDetectionGate(
              contains: ["esc to cancel"],
              any: [
                AgentDetectionGate(contains: ["enter to confirm"]),
                AgentDetectionGate(
                  contains: ["enter to select"],
                  any: [
                    AgentDetectionGate(contains: ["tab/arrow keys to navigate"]),
                    AgentDetectionGate(contains: ["arrow keys to navigate"]),
                    AgentDetectionGate(contains: ["arrows to navigate"]),
                    AgentDetectionGate(contains: ["↑/↓ to navigate"]),
                    AgentDetectionGate(contains: ["↑↓ to navigate"]),
                  ]
                ),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "dynamic_workflow_prompt",
            result: .needsInput,
            priority: 980,
            region: .wholeRecent,
            gate: AgentDetectionGate(
              contains: ["run a dynamic workflow?", "esc to cancel"]
            )
          ),
          AgentDetectionStateRule(
            id: "live_prompt_box",
            result: .idle,
            priority: 950,
            region: .promptBoxBody,
            visibleIdle: true,
            gate: AgentDetectionGate(
              lineRegex: [#"^\s*❯"#],
              not: [
                AgentDetectionGate(contains: ["enter to select"]),
                AgentDetectionGate(contains: ["esc to cancel"]),
                AgentDetectionGate(contains: ["tab/arrow keys"]),
                AgentDetectionGate(contains: ["arrow keys to navigate"]),
                AgentDetectionGate(contains: ["↑/↓ to navigate"]),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "model_picker_menu",
            result: .hold,
            priority: 900,
            region: .wholeRecent,
            gate: AgentDetectionGate(
              contains: ["select model", "enter to set as default", "esc to cancel"],
              not: [
                AgentDetectionGate(contains: ["do you want to proceed?"]),
                AgentDetectionGate(contains: ["enter to select"]),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "bash_permission_prompt",
            result: .needsInput,
            priority: 850,
            region: .wholeRecent,
            gate: AgentDetectionGate(
              contains: ["do you want to proceed?"],
              all: [
                AgentDetectionGate(
                  any: [
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*❯?\s*yes\b"#]),
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*1\.\s*yes\b"#]),
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*2\.\s*no\b"#]),
                  ]
                )
              ],
              any: [
                AgentDetectionGate(contains: ["bash command"]),
                AgentDetectionGate(contains: ["bash("]),
                AgentDetectionGate(contains: ["contains expansion"]),
                AgentDetectionGate(contains: ["tab to amend"]),
                AgentDetectionGate(contains: ["ctrl+e to explain"]),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "generic_permission_prompt",
            result: .needsInput,
            priority: 840,
            region: .afterLastHorizontalRule,
            gate: AgentDetectionGate(
              contains: ["do you want to proceed?", "esc to cancel"],
              all: [
                AgentDetectionGate(
                  any: [
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*❯?\s*1\.\s*yes\b"#]),
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*2\.\s*yes\b"#]),
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*2\.\s*no\b"#]),
                    AgentDetectionGate(lineRegex: [#"(?i)^\s*3\.\s*no\b"#]),
                  ]
                )
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "legacy_no_prompt_blocker",
            result: .needsInput,
            priority: 300,
            region: .wholeRecent,
            gate: AgentDetectionGate(
              any: [
                AgentDetectionGate(
                  contains: ["do you want to"],
                  any: [
                    AgentDetectionGate(contains: ["yes"]),
                    AgentDetectionGate(contains: ["❯"]),
                  ]
                ),
                AgentDetectionGate(
                  contains: ["would you like to"],
                  any: [
                    AgentDetectionGate(contains: ["yes"]),
                    AgentDetectionGate(contains: ["❯"]),
                  ]
                ),
                AgentDetectionGate(contains: ["waiting for permission"]),
                AgentDetectionGate(contains: ["do you want to allow this connection?"]),
                AgentDetectionGate(contains: ["tab to amend"]),
                AgentDetectionGate(contains: ["ctrl+e to explain"]),
                AgentDetectionGate(contains: ["do you want to proceed?", "esc to cancel"]),
                AgentDetectionGate(contains: ["review your answers"]),
                AgentDetectionGate(contains: ["skip interview and plan immediately"]),
              ],
              not: [
                AgentDetectionGate(regex: [#"(?m)^\s*❯\s*$"#])
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "osc_title_idle",
            result: .idle,
            priority: 250,
            region: .oscTitle,
            visibleIdle: true,
            gate: AgentDetectionGate(regex: [#"^\x{2733} "#])
          ),
          AgentDetectionStateRule(
            id: "osc_progress_idle",
            result: .idle,
            priority: 250,
            region: .oscProgress,
            gate: AgentDetectionGate(regex: [#"^4;0"#])
          ),
        ]
      ),
      AgentDetectionAgentRule(
        id: "codex",
        displayName: "Codex",
        processes: [
          AgentDetectionProcessRule(executable: "codex"),
          AgentDetectionProcessRule(
            executable: "node",
            scriptSuffix: "/@openai/codex/bin/codex.js"
          ),
        ],
        rules: [
          AgentDetectionStateRule(
            id: "osc_title_blocked",
            result: .needsInput,
            priority: 1100,
            region: .oscTitle,
            gate: AgentDetectionGate(contains: ["Action Required"])
          ),
          AgentDetectionStateRule(
            id: "osc_title_working",
            result: .running,
            priority: 1050,
            region: .oscTitle,
            gate: AgentDetectionGate(
              regex: [#"(?:^| )[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?: |$)"#]
            )
          ),
          AgentDetectionStateRule(
            id: "transcript_viewer",
            result: .hold,
            priority: 1000,
            region: .afterLastPromptMarker,
            gate: AgentDetectionGate(
              contains: ["↑/↓ to scroll", "pgup/pgdn to", "home/end to jump", "q to quit"],
              any: [
                AgentDetectionGate(contains: ["esc to edit prev"]),
                AgentDetectionGate(contains: ["esc/← to edit prev"]),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "trust_directory",
            result: .needsInput,
            priority: 950,
            region: .topNonEmptyLines(20),
            gate: AgentDetectionGate(
              all: [
                AgentDetectionGate(regex: [#"\A> You are in [^\r\n]+(?:\r?\n|$)"#]),
                AgentDetectionGate(
                  regex: [#"(?s)Do\s+you\s+trust\s+the\s+contents\s+of\s+this\s+directory\?"#]
                ),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "live_strong_blocker",
            result: .needsInput,
            priority: 900,
            region: .afterLastPromptMarker,
            gate: AgentDetectionGate(
              any: [
                AgentDetectionGate(contains: ["press enter to confirm or esc to cancel"]),
                AgentDetectionGate(contains: ["enter to submit answer"]),
                AgentDetectionGate(contains: ["enter to submit all"]),
                AgentDetectionGate(contains: ["allow command?"]),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "weak_blocker",
            result: .needsInput,
            priority: 600,
            region: .wholeRecent,
            gate: AgentDetectionGate(
              any: [
                AgentDetectionGate(contains: ["[y/n]"]),
                AgentDetectionGate(contains: ["yes (y)"]),
                AgentDetectionGate(
                  contains: ["do you want to"],
                  any: [
                    AgentDetectionGate(contains: ["yes"]),
                    AgentDetectionGate(contains: ["❯"]),
                  ]
                ),
                AgentDetectionGate(
                  contains: ["would you like to"],
                  any: [
                    AgentDetectionGate(contains: ["yes"]),
                    AgentDetectionGate(contains: ["❯"]),
                  ]
                ),
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "screen_working_fallback",
            result: .running,
            priority: 500,
            region: .bottomNonEmptyLines(3),
            gate: AgentDetectionGate(
              lineRegex: [#"^[•◦]\s+Working \([^)]*esc to interrupt\)(?: · .*)?$"#],
              not: [
                AgentDetectionGate(contains: ["■ Conversation interrupted"])
              ]
            )
          ),
          AgentDetectionStateRule(
            id: "osc_title_idle",
            result: .idle,
            priority: 100,
            region: .oscTitle,
            visibleIdle: true,
            gate: AgentDetectionGate(
              regex: [#"\S"#],
              not: [
                AgentDetectionGate(
                  regex: [#"(?:^| )[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?: |$)"#]
                ),
                AgentDetectionGate(contains: ["Action Required"]),
              ]
            )
          ),
        ]
      ),
      AgentDetectionAgentRule(
        id: "pi",
        displayName: "Pi",
        processes: [
          AgentDetectionProcessRule(executable: "pi"),
          AgentDetectionProcessRule(
            executable: "node",
            scriptSuffix: "/@mariozechner/pi-coding-agent/dist/cli.js"
          ),
          AgentDetectionProcessRule(
            executable: "node",
            scriptSuffix: "/@earendil-works/pi-coding-agent/dist/cli.js"
          ),
        ],
        rules: [
          AgentDetectionStateRule(
            id: "working_literal",
            result: .running,
            priority: 100,
            region: .wholeRecent,
            gate: AgentDetectionGate(contains: ["Working..."])
          )
        ]
      ),
    ]
  )
}
