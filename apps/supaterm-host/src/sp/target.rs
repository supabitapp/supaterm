use crate::host::cli::{CliTarget, CliTargetKind};
use anyhow::{Result, bail};
use uuid::Uuid;

pub fn parse_target(value: Option<&str>, kind: CliTargetKind) -> Result<CliTarget> {
    let Some(value) = value else {
        return Ok(CliTarget::Ambient);
    };
    if let Ok(id) = Uuid::parse_str(value) {
        return Ok(CliTarget::Id { id });
    }
    if let Some((prefix, suffix)) = value.split_once(':') {
        let target_kind = match prefix {
            "w" => CliTargetKind::Window,
            "s" => CliTargetKind::Space,
            "g" => CliTargetKind::Group,
            "t" => CliTargetKind::Tab,
            "p" => CliTargetKind::Pane,
            _ => bail!("invalid target {value}"),
        };
        return Ok(CliTarget::Short {
            kind: target_kind,
            prefix: suffix.to_owned(),
        });
    }
    if value
        .split('/')
        .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        let indexes = value
            .split('/')
            .map(str::parse)
            .collect::<Result<Vec<usize>, _>>()?;
        return Ok(CliTarget::Path { indexes });
    }
    if kind == CliTargetKind::Group {
        return Ok(CliTarget::Name {
            value: value.to_owned(),
        });
    }
    bail!("invalid target {value}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ambient_ids_paths_short_refs_and_group_names() {
        assert_eq!(
            parse_target(None, CliTargetKind::Pane).unwrap(),
            CliTarget::Ambient
        );
        assert!(matches!(
            parse_target(
                Some("11111111-1111-4111-8111-111111111111"),
                CliTargetKind::Pane
            )
            .unwrap(),
            CliTarget::Id { .. }
        ));
        assert_eq!(
            parse_target(Some("1/2/3"), CliTargetKind::Pane).unwrap(),
            CliTarget::Path {
                indexes: vec![1, 2, 3]
            }
        );
        assert_eq!(
            parse_target(Some("p:12345678"), CliTargetKind::Pane).unwrap(),
            CliTarget::Short {
                kind: CliTargetKind::Pane,
                prefix: "12345678".into()
            }
        );
        assert_eq!(
            parse_target(Some("Build"), CliTargetKind::Group).unwrap(),
            CliTarget::Name {
                value: "Build".into()
            }
        );
        assert!(parse_target(Some("Build"), CliTargetKind::Tab).is_err());
    }
}
