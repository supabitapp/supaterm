pub mod host;
pub mod protocol;
pub mod transport;

pub fn random_identifier(prefix: &str) -> String {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).expect("OS randomness must be available");
    let random = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if prefix.is_empty() {
        random
    } else {
        format!("{prefix}-{random}")
    }
}
