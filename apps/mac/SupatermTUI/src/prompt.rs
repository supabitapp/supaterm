use std::path::{Path, PathBuf};

use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Atom {
    Text(String),
    Image(PathBuf),
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct Prompt {
    atoms: Vec<Atom>,
    cursor: usize,
}

impl Prompt {
    pub(crate) fn is_empty(&self) -> bool {
        self.atoms.is_empty()
    }

    pub(crate) fn cursor(&self) -> usize {
        self.cursor
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.atoms.len()
    }

    pub(crate) fn insert_char(&mut self, character: char) {
        let mut encoded = [0; 4];
        self.insert_text(character.encode_utf8(&mut encoded));
    }

    pub(crate) fn insert_text(&mut self, text: &str) {
        let sanitized = sanitized_text(text);
        let atoms = sanitized
            .graphemes(true)
            .filter(|grapheme| !grapheme.is_empty())
            .map(|grapheme| Atom::Text(grapheme.to_owned()));
        self.insert_atoms(atoms);
    }

    pub(crate) fn insert_paste(&mut self, text: &str) {
        let Some(paths) = dropped_files(text) else {
            self.insert_text(text);
            return;
        };

        let mut atoms = Vec::with_capacity(paths.len().saturating_mul(2));
        for (index, path) in paths.into_iter().enumerate() {
            if index > 0 {
                atoms.push(Atom::Text(" ".to_owned()));
            }
            if is_raster_image(&path) {
                atoms.push(Atom::Image(path));
            } else {
                let display = sanitized_text(&path.to_string_lossy());
                atoms.extend(
                    display
                        .graphemes(true)
                        .map(|grapheme| Atom::Text(grapheme.to_owned())),
                );
            }
        }
        self.insert_atoms(atoms);
    }

    pub(crate) fn move_left(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    pub(crate) fn move_right(&mut self) {
        self.cursor = (self.cursor + 1).min(self.atoms.len());
    }

    pub(crate) fn move_to_start(&mut self) {
        self.cursor = 0;
    }

    pub(crate) fn move_to_end(&mut self) {
        self.cursor = self.atoms.len();
    }

    pub(crate) fn delete_left(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.cursor -= 1;
        self.atoms.remove(self.cursor);
    }

    pub(crate) fn delete_right(&mut self) {
        if self.cursor < self.atoms.len() {
            self.atoms.remove(self.cursor);
        }
    }

    pub(crate) fn delete_word_left(&mut self) {
        if matches!(
            self.atoms.get(self.cursor.saturating_sub(1)),
            Some(Atom::Image(_))
        ) {
            self.delete_left();
            return;
        }
        while self.cursor > 0 && self.atom_before_cursor_is_whitespace() {
            self.delete_left();
        }
        while matches!(
            self.atoms.get(self.cursor.saturating_sub(1)),
            Some(Atom::Text(text)) if !text.chars().all(char::is_whitespace)
        ) {
            self.delete_left();
        }
    }

    pub(crate) fn delete_to_start(&mut self) {
        self.atoms.drain(..self.cursor);
        self.cursor = 0;
    }

    pub(crate) fn delete_to_end(&mut self) {
        self.atoms.truncate(self.cursor);
    }

    #[cfg(test)]
    pub(crate) fn display_text(&self) -> String {
        let mut result = String::new();
        let mut image_number = 0;
        for atom in &self.atoms {
            match atom {
                Atom::Text(text) => result.push_str(text),
                Atom::Image(_) => {
                    image_number += 1;
                    result.push_str(&format!("[Image {image_number}]"));
                }
            }
        }
        result
    }

    #[cfg(test)]
    pub(crate) fn image_paths(&self) -> impl Iterator<Item = &Path> {
        self.atoms.iter().filter_map(|atom| match atom {
            Atom::Image(path) => Some(path.as_path()),
            Atom::Text(_) => None,
        })
    }

    pub(crate) fn atoms(&self) -> &[Atom] {
        &self.atoms
    }

    fn atom_before_cursor_is_whitespace(&self) -> bool {
        match self.atoms.get(self.cursor.saturating_sub(1)) {
            Some(Atom::Text(text)) => text.chars().all(char::is_whitespace),
            Some(Atom::Image(_)) | None => false,
        }
    }

    fn insert_atoms(&mut self, atoms: impl IntoIterator<Item = Atom>) {
        let inserted: Vec<_> = atoms.into_iter().collect();
        let count = inserted.len();
        self.atoms.splice(self.cursor..self.cursor, inserted);
        self.cursor += count;
        self.normalize_text_run_at_cursor();
    }

    fn normalize_text_run_at_cursor(&mut self) {
        let mut start = self.cursor;
        while start > 0 && matches!(self.atoms.get(start - 1), Some(Atom::Text(_))) {
            start -= 1;
        }
        let mut end = self.cursor;
        while end < self.atoms.len() && matches!(self.atoms.get(end), Some(Atom::Text(_))) {
            end += 1;
        }
        if start == end {
            return;
        }
        let cursor_bytes = self.atoms[start..self.cursor]
            .iter()
            .map(|atom| match atom {
                Atom::Text(text) => text.len(),
                Atom::Image(_) => 0,
            })
            .sum::<usize>();
        let text = self.atoms[start..end]
            .iter()
            .filter_map(|atom| match atom {
                Atom::Text(text) => Some(text.as_str()),
                Atom::Image(_) => None,
            })
            .collect::<String>();
        let graphemes = text.graphemes(true).map(str::to_owned).collect::<Vec<_>>();
        let mut bytes = 0;
        let mut cursor = 0;
        for grapheme in &graphemes {
            bytes += grapheme.len();
            if bytes <= cursor_bytes {
                cursor += 1;
            }
        }
        self.atoms
            .splice(start..end, graphemes.into_iter().map(Atom::Text));
        self.cursor = start + cursor;
    }
}

fn sanitized_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .map(|character| {
            if character == '\n' || character == '\t' || !character.is_control() {
                character
            } else {
                '\u{fffd}'
            }
        })
        .collect()
}

fn dropped_files(text: &str) -> Option<Vec<PathBuf>> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(path) = existing_file(trimmed) {
        return Some(vec![path]);
    }

    let words = shell_words::split(trimmed).ok()?;
    if words.is_empty() {
        return None;
    }
    words.into_iter().map(|word| existing_file(&word)).collect()
}

fn existing_file(value: &str) -> Option<PathBuf> {
    let path = decode_path(value)?;
    if !path.metadata().ok()?.is_file() {
        return None;
    }
    std::path::absolute(path).ok()
}

fn decode_path(value: &str) -> Option<PathBuf> {
    let Some(rest) = value.strip_prefix("file://") else {
        return Some(PathBuf::from(value));
    };
    let path = if rest.starts_with('/') {
        rest.to_owned()
    } else if let Some(path) = rest.strip_prefix("localhost/") {
        format!("/{path}")
    } else {
        return None;
    };
    percent_decode(&path).map(PathBuf::from)
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn is_raster_image(path: &Path) -> bool {
    let Ok(reader) = image::ImageReader::open(path) else {
        return false;
    };
    let Ok(reader) = reader.with_guessed_format() else {
        return false;
    };
    reader.into_dimensions().is_ok()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use image::{ColorType, ImageFormat};
    use tempfile::tempdir;

    use super::*;

    fn write_png(path: &Path) {
        image::save_buffer_with_format(
            path,
            &[255, 168, 45, 255],
            1,
            1,
            ColorType::Rgba8,
            ImageFormat::Png,
        )
        .unwrap();
    }

    #[test]
    fn edits_unicode_by_grapheme() {
        let mut prompt = Prompt::default();
        prompt.insert_text("a👨‍👩‍👧‍👦e\u{301}");

        assert_eq!(prompt.len(), 3);
        prompt.move_left();
        prompt.delete_left();

        assert_eq!(prompt.display_text(), "ae\u{301}");
        assert_eq!(prompt.cursor(), 1);
    }

    #[test]
    fn merges_typed_combining_marks_into_one_editable_grapheme() {
        let mut prompt = Prompt::default();
        prompt.insert_char('e');
        prompt.insert_char('\u{301}');

        assert_eq!(prompt.len(), 1);
        prompt.delete_left();
        assert!(prompt.is_empty());
    }

    #[test]
    fn inserts_at_the_cursor() {
        let mut prompt = Prompt::default();
        prompt.insert_text("ac");
        prompt.move_left();
        prompt.insert_char('b');

        assert_eq!(prompt.display_text(), "abc");
    }

    #[test]
    fn keeps_invalid_paste_as_text() {
        let mut prompt = Prompt::default();
        prompt.insert_paste("not a dropped file");

        assert_eq!(prompt.display_text(), "not a dropped file");
        assert_eq!(prompt.image_paths().count(), 0);
    }

    #[test]
    fn sanitizes_terminal_controls_and_preserves_layout_characters() {
        let mut prompt = Prompt::default();
        prompt.insert_text("a\u{1b}[31m\tb\n\u{7f}");

        assert_eq!(prompt.display_text(), "a�[31m\tb\n�");
    }

    #[test]
    fn requires_every_shell_word_to_be_a_file() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("one.txt");
        fs::write(&file, "one").unwrap();
        let paste = format!("{} missing.txt", file.display());
        let mut prompt = Prompt::default();
        prompt.insert_paste(&paste);

        assert_eq!(prompt.display_text(), paste);
    }

    #[test]
    fn decodes_shell_escaped_paths_and_makes_them_absolute() {
        let directory = tempdir().unwrap();
        let first = directory.path().join("first file.txt");
        let second = directory.path().join("second.txt");
        fs::write(&first, "one").unwrap();
        fs::write(&second, "two").unwrap();
        let paste = format!(
            "{} {}",
            shell_words::quote(&first.to_string_lossy()),
            second.display()
        );
        let mut prompt = Prompt::default();
        prompt.insert_paste(&paste);

        assert_eq!(
            prompt.display_text(),
            format!("{} {}", first.display(), second.display())
        );
    }

    #[test]
    fn decodes_local_file_urls() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("a file.txt");
        fs::write(&file, "one").unwrap();
        let url = format!("file://{}", file.display()).replace(' ', "%20");
        let mut prompt = Prompt::default();
        prompt.insert_paste(&url);

        assert_eq!(prompt.display_text(), file.display().to_string());
    }

    #[test]
    fn decodes_localhost_file_urls_without_extra_slashes() {
        let directory = tempdir().unwrap();
        let file = directory.path().join("local file.txt");
        fs::write(&file, "one").unwrap();
        let url = format!("file://localhost{}", file.display()).replace(' ', "%20");
        let mut prompt = Prompt::default();
        prompt.insert_paste(&url);

        assert_eq!(prompt.display_text(), file.display().to_string());
    }

    #[test]
    fn detects_images_by_content_and_not_extension() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("image.txt");
        let text = directory.path().join("notes.png");
        let truncated = directory.path().join("truncated.png");
        write_png(&image);
        fs::write(&text, b"plain text").unwrap();
        fs::write(&truncated, b"\x89PNG\r\n\x1a\n").unwrap();
        let paste = format!(
            "{} {} {}",
            image.display(),
            text.display(),
            truncated.display()
        );
        let mut prompt = Prompt::default();
        prompt.insert_paste(&paste);

        assert_eq!(
            prompt.display_text(),
            format!("[Image 1] {} {}", text.display(), truncated.display())
        );
        assert_eq!(
            prompt.image_paths().collect::<Vec<_>>(),
            vec![image.as_path()]
        );
    }

    #[test]
    fn image_labels_are_atomic_and_renumber_after_deletion() {
        let directory = tempdir().unwrap();
        let first = directory.path().join("first.png");
        let second = directory.path().join("second.png");
        write_png(&first);
        write_png(&second);
        let mut prompt = Prompt::default();
        prompt.insert_paste(&format!("{} {}", first.display(), second.display()));

        assert_eq!(prompt.display_text(), "[Image 1] [Image 2]");
        prompt.move_to_start();
        prompt.delete_right();

        assert_eq!(prompt.display_text(), " [Image 1]");
        assert_eq!(
            prompt.image_paths().collect::<Vec<_>>(),
            vec![second.as_path()]
        );
    }

    #[test]
    fn deletes_words_and_ranges_without_crossing_images() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("image.png");
        write_png(&image);
        let mut prompt = Prompt::default();
        prompt.insert_text("hello ");
        prompt.insert_paste(&image.display().to_string());
        prompt.insert_text(" world");

        prompt.delete_word_left();
        assert_eq!(prompt.display_text(), "hello [Image 1] ");
        prompt.delete_word_left();
        assert_eq!(prompt.display_text(), "hello [Image 1]");
        prompt.delete_word_left();
        assert_eq!(prompt.display_text(), "hello ");
        prompt.delete_to_start();
        assert!(prompt.is_empty());
    }
}
