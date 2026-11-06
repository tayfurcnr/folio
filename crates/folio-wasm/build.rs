use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let lock_path = manifest_dir.join("Cargo.lock");
    println!("cargo:rerun-if-changed={}", lock_path.display());

    let lock = fs::read_to_string(&lock_path).expect("Folio Cargo.lock must be readable");
    let mut current_name = None;
    let mut revisions = Vec::new();
    for line in lock.lines() {
        if line == "[[package]]" {
            current_name = None;
        } else if let Some(name) = line.strip_prefix("name = \"").and_then(|value| value.strip_suffix('\"')) {
            current_name = Some(name.to_owned());
        } else if current_name.as_deref().is_some_and(|name| name.starts_with("deckcraft-")) {
            if let Some(source) = line.strip_prefix("source = \"").and_then(|value| value.strip_suffix('\"')) {
                if let Some((_, revision)) = source.rsplit_once('#') {
                    revisions.push(revision.to_owned());
                }
            }
        }
    }

    let Some(revision) = revisions.first() else {
        panic!("Cargo.lock contains no pinned DeckCraft git packages");
    };
    if revisions.iter().any(|candidate| candidate != revision) {
        panic!("DeckCraft packages in Cargo.lock resolve to different Git revisions");
    }
    println!("cargo:rustc-env=DECKCRAFT_REVISION={revision}");
}
