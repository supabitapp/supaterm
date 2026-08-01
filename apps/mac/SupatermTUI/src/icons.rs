use std::env;
use std::ffi::OsStr;

use image::{DynamicImage, ImageFormat};
use ratatui::buffer::Buffer;
use ratatui::layout::{Rect, Size};
use ratatui::style::Color;
use ratatui::widgets::Widget;
use ratatui_image::picker::{Picker, ProtocolType};
use ratatui_image::protocol::Protocol;
use ratatui_image::{FilterType, FontSize, Image, Resize};

use crate::app::Agent;

include!(concat!(env!("OUT_DIR"), "/agent_icon_bytes.rs"));

const SIZE: Size = Size::new(2, 1);

pub(crate) struct AgentIcons {
    protocols: [Protocol; Agent::ALL.len()],
}

impl AgentIcons {
    pub(crate) fn detected(pi_color: Color) -> Option<Self> {
        if !supports_kitty_environment(
            env::var_os("TERM_PROGRAM").as_deref(),
            env::var_os("SUPATERM_SURFACE_ID").as_deref(),
            env::var_os("GHOSTTY_BIN_DIR").as_deref(),
        ) {
            return None;
        }
        let picker = Picker::from_query_stdio().ok()?;
        if picker.protocol_type() != ProtocolType::Kitty {
            return None;
        }
        Self::from_picker(&picker, pi_color)
    }

    pub(crate) fn render(&self, agent: Agent, area: Rect, buffer: &mut Buffer) {
        if area.width < SIZE.width || area.height < SIZE.height {
            return;
        }
        let protocol = &self.protocols[agent.position()];
        Image::new(protocol).render(Rect::new(area.x, area.y, SIZE.width, SIZE.height), buffer);
    }

    fn from_picker(picker: &Picker, pi_color: Color) -> Option<Self> {
        let protocols: [Protocol; Agent::ALL.len()] = Agent::ALL
            .iter()
            .copied()
            .map(|agent| {
                let image = load(icon_bytes(agent))?;
                let image = if agent == Agent::Pi {
                    tint(image, rgb(pi_color)?)
                } else {
                    image
                };
                protocol(picker, image)
            })
            .collect::<Option<Vec<_>>>()?
            .try_into()
            .ok()?;
        Some(Self { protocols })
    }

    #[cfg(test)]
    pub(crate) fn kitty(pi_color: Color) -> Self {
        let mut picker = Picker::halfblocks();
        picker.set_protocol_type(ProtocolType::Kitty);
        Self::from_picker(&picker, pi_color).unwrap()
    }
}

fn supports_kitty_environment(
    term_program: Option<&OsStr>,
    surface_id: Option<&OsStr>,
    ghostty_bin_dir: Option<&OsStr>,
) -> bool {
    term_program == Some(OsStr::new("ghostty"))
        && surface_id.is_some_and(|value| !value.is_empty())
        && ghostty_bin_dir.is_some_and(|value| !value.is_empty())
}

fn load(bytes: &[u8]) -> Option<DynamicImage> {
    image::load_from_memory_with_format(bytes, ImageFormat::Png).ok()
}

fn protocol(picker: &Picker, image: DynamicImage) -> Option<Protocol> {
    let image = fixed_size(&image, picker.font_size());
    picker
        .new_protocol(image, SIZE, Resize::Fit(Some(FilterType::Lanczos3)))
        .ok()
}

fn fixed_size(image: &DynamicImage, font_size: FontSize) -> DynamicImage {
    Resize::Fit(Some(FilterType::Lanczos3)).resize(image, font_size, SIZE, None)
}

const fn rgb(color: Color) -> Option<[u8; 3]> {
    match color {
        Color::Rgb(red, green, blue) => Some([red, green, blue]),
        _ => None,
    }
}

fn tint(image: DynamicImage, color: [u8; 3]) -> DynamicImage {
    let mut image = image.into_rgba8();
    for pixel in image.pixels_mut().filter(|pixel| pixel[3] != 0) {
        pixel[0] = color[0];
        pixel[1] = color[1];
        pixel[2] = color[2];
    }
    DynamicImage::ImageRgba8(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_icons_are_square_rgba_images() {
        for agent in Agent::ALL.iter().copied() {
            let image = load(icon_bytes(agent)).unwrap();

            assert_eq!(image.width(), 96);
            assert_eq!(image.height(), 96);
            assert!(image.color().has_alpha());
        }
    }

    #[test]
    fn pi_tint_preserves_alpha() {
        let image = load(icon_bytes(Agent::Pi)).unwrap().into_rgba8();
        let tinted = tint(DynamicImage::ImageRgba8(image.clone()), [12, 34, 56]).into_rgba8();

        for (source, result) in image.pixels().zip(tinted.pixels()) {
            assert_eq!(source[3], result[3]);
            if result[3] != 0 {
                assert_eq!(&result.0[..3], &[12, 34, 56]);
            }
        }
    }

    #[test]
    fn icon_size_matches_two_terminal_cells() {
        let image = fixed_size(
            &load(icon_bytes(Agent::Codex)).unwrap(),
            FontSize::new(9, 18),
        );

        assert_eq!(image.width(), 18);
        assert_eq!(image.height(), 18);
    }

    #[test]
    fn kitty_route_writes_one_image_placeholder_for_each_agent() {
        let icons = AgentIcons::kitty(Color::Rgb(232, 232, 234));
        let mut buffer = Buffer::empty(Rect::new(0, 0, SIZE.width * Agent::ALL.len() as u16, 1));

        for (index, agent) in Agent::ALL.iter().copied().enumerate() {
            icons.render(
                agent,
                Rect::new(index as u16 * SIZE.width, 0, SIZE.width, SIZE.height),
                &mut buffer,
            );
        }

        assert_eq!(
            Agent::ALL
                .iter()
                .enumerate()
                .filter(|(index, _)| buffer[(*index as u16 * SIZE.width, 0)]
                    .symbol()
                    .contains('\u{10EEEE}'))
                .count(),
            Agent::ALL.len()
        );
    }

    #[test]
    fn queries_images_only_for_supaterm_ghostty_surfaces() {
        let ghostty = OsStr::new("ghostty");
        let surface = OsStr::new("surface");
        let bin_dir = OsStr::new("/Applications/Supaterm.app/Contents/MacOS");

        assert!(supports_kitty_environment(
            Some(ghostty),
            Some(surface),
            Some(bin_dir)
        ));
        assert!(!supports_kitty_environment(
            None,
            Some(surface),
            Some(bin_dir)
        ));
        assert!(!supports_kitty_environment(
            Some(ghostty),
            None,
            Some(bin_dir)
        ));
        assert!(!supports_kitty_environment(
            Some(ghostty),
            Some(surface),
            None
        ));
    }
}
