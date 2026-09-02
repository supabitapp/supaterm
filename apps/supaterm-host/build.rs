use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
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
