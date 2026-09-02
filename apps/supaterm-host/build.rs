use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    link_terminal_library(&manifest);
    fingerprint_integrations(&manifest);
}

fn link_terminal_library(manifest: &Path) {
    let ghostty = manifest.join("../mac/ThirdParty/ghostty");
    println!("cargo:rerun-if-env-changed=SUPATERM_GHOSTTY_VT_LIB_DIR");
    println!("cargo:rerun-if-env-changed=ZIG");
    println!(
        "cargo:rerun-if-changed={}",
        ghostty.join("build.zig").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        ghostty.join("src/lib_vt.zig").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        ghostty.join("include/ghostty/vt").display()
    );
    let library_directory = if let Some(path) = std::env::var_os("SUPATERM_GHOSTTY_VT_LIB_DIR") {
        PathBuf::from(path)
    } else {
        let prefix = PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("ghostty-vt");
        let status = Command::new(std::env::var_os("ZIG").unwrap_or_else(|| "zig".into()))
            .current_dir(&ghostty)
            .args([
                "build",
                "-Demit-lib-vt=true",
                "-Demit-macos-app=false",
                "-Demit-xcframework=false",
                "-Doptimize=ReleaseFast",
                "--prefix",
            ])
            .arg(&prefix)
            .status()
            .unwrap();
        assert!(status.success(), "libghostty-vt build failed");
        prefix.join("lib")
    };
    println!(
        "cargo:rustc-link-search=native={}",
        library_directory.display()
    );
    println!("cargo:rustc-link-lib=static=ghostty-vt");
}

fn fingerprint_integrations(manifest: &Path) {
    let root = manifest.join("../../integrations/supaterm");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = Vec::new();
    collect(&root, &mut files);
    files.sort();
    let mut hash = 0xcbf29ce484222325_u64;
    for path in files {
        for byte in path.as_os_str().as_encoded_bytes().iter().copied().chain(
            fs::read(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display())),
        ) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    println!("cargo:rustc-env=SUPATERM_HOST_EMBEDDED_FINGERPRINT={hash:016x}");
}

fn collect(directory: &Path, files: &mut Vec<PathBuf>) {
    let mut entries = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("read {}: {error}", directory.display()))
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(&path, files);
        } else if path.is_file() {
            files.push(path);
        }
    }
}
