# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in the Supaterm Linear workspace.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

None of these exist in the workspace yet — it carries `Bug`, `Feature`, and `Improvement` only.
Create one on first use with `linear label create -n needs-triage -c "#EB5757"`.

Linear's built-in workflow states already cover part of this: the `triage` state overlaps
`needs-triage`, and `canceled` overlaps `wontfix`. Drop those two rows and lean on the states if
the duplication starts to bite.
