use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{Options, Tree};

const ICON_SIZE: u16 = 96;
const ICONS: &str = include_str!("agent-icons.tsv");

struct Icon {
    agent: &'static str,
    name: &'static str,
    source: &'static str,
}

fn main() -> Result<(), Box<dyn Error>> {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").ok_or("missing manifest")?);
    let output_dir = PathBuf::from(env::var_os("OUT_DIR").ok_or("missing output directory")?);
    let icons = icons()?;
    let mut embedded =
        String::from("fn icon_bytes(agent: Agent) -> &'static [u8] {\n    match agent {\n");
    println!("cargo:rerun-if-changed=agent-icons.tsv");
    for icon in icons {
        let output = format!("{}.png", icon.name);
        println!("cargo:rerun-if-changed={}", icon.source);
        rasterize(&manifest_dir.join(icon.source), &output_dir.join(output))?;
        embedded.push_str(&format!(
            "        Agent::{} => include_bytes!(concat!(env!(\"OUT_DIR\"), \"/{}.png\")),\n",
            icon.agent, icon.name
        ));
    }
    embedded.push_str("    }\n}\n");
    fs::write(output_dir.join("agent_icon_bytes.rs"), embedded)?;
    Ok(())
}

fn icons() -> Result<Vec<Icon>, Box<dyn Error>> {
    ICONS
        .lines()
        .map(|line| {
            let mut fields = line.split('\t');
            let agent = fields.next().ok_or("invalid icon manifest")?;
            let name = fields.next().ok_or("invalid icon manifest")?;
            let source = fields.next().ok_or("invalid icon manifest")?;
            if fields.next().is_some()
                || agent.is_empty()
                || !agent.bytes().all(|byte| byte.is_ascii_alphabetic())
                || name.is_empty()
                || source.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            {
                return Err("invalid icon manifest entry".into());
            }
            Ok(Icon {
                agent,
                name,
                source,
            })
        })
        .collect()
}

fn rasterize(source: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let tree = Tree::from_data(&fs::read(source)?, &Options::default())?;
    let mut pixmap =
        Pixmap::new(u32::from(ICON_SIZE), u32::from(ICON_SIZE)).ok_or("invalid icon size")?;
    let size = tree.size();
    let transform = Transform::from_scale(
        f32::from(ICON_SIZE) / size.width(),
        f32::from(ICON_SIZE) / size.height(),
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    pixmap.save_png(output)?;
    Ok(())
}
