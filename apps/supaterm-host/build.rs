fn main() {
    println!("cargo:rerun-if-env-changed=SUPATERM_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=SUPATERM_BUILD_IDENTITY");
    println!("cargo:rerun-if-env-changed=SUPATERM_GHOSTTY_VT_ARCHIVE");
    let version = std::env::var("SUPATERM_BUILD_VERSION")
        .unwrap_or_else(|_| std::env::var("CARGO_PKG_VERSION").expect("package version"));
    let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let mut files = vec![
        manifest.join("Cargo.toml"),
        manifest.join("Cargo.lock"),
        manifest.join("build.rs"),
    ];
    collect_files(&manifest.join("src"), &mut files);
    files.sort();
    let mut hash = 0xcbf29ce484222325_u64;
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        for byte in std::fs::read(path).expect("package source must be readable") {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    let identity = std::env::var("SUPATERM_BUILD_IDENTITY")
        .unwrap_or_else(|_| format!("{version}-{hash:016x}"));
    println!("cargo:rustc-env=SUPATERM_BUILD_VERSION={version}");
    println!("cargo:rustc-env=SUPATERM_BUILD_IDENTITY={identity}");
    if let Some(archive) = std::env::var_os("SUPATERM_GHOSTTY_VT_ARCHIVE") {
        println!("cargo:rerun-if-changed={}", archive.to_string_lossy());
        println!("cargo:rustc-link-arg-bin=supaterm-host=-Wl,-u,_ghostty_terminal_new");
        println!(
            "cargo:rustc-link-arg-bin=supaterm-host={}",
            archive.to_string_lossy()
        );
    }
}

fn collect_files(directory: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
    let mut entries = std::fs::read_dir(directory)
        .expect("source directory must be readable")
        .map(|entry| entry.expect("source entry must be readable").path())
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect_files(&path, files);
        } else {
            files.push(path);
        }
    }
}
