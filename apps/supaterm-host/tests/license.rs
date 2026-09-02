use supaterm_host::license::{EntitlementStatus, EntitlementVerifier, LicenseCredential};

#[test]
fn credential_parser_normalizes_and_extracts_the_license_id() {
    let credential = LicenseCredential::parse(
        "  supaterm-aaIsem2ekvthpcezvk54zxpo74-3pkijufyd2ax67q72ctxrzueva\n",
    )
    .unwrap();

    assert_eq!(
        credential.raw_value(),
        "SUPATERM-AAISEM2EKVTHPCEZVK54ZXPO74-3PKIJUFYD2AX67Q72CTXRZUEVA"
    );
    assert_eq!(credential.license_id(), "00112233445566778899aabbccddeeff");
}

#[test]
fn signed_entitlement_compatibility_vector_verifies_exact_claims() {
    let verifier = EntitlementVerifier::new([
        0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07,
        0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07,
        0x51, 0x1a,
    ])
    .unwrap();
    let token = concat!(
        "eyJ2IjoxLCJsaWQiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiIsImRpZCI6ImRldmljZS12ZWN0",
        "b3IiLCJzdGF0dXMiOiJhY3RpdmUiLCJ1cGQiOiIyMDI3LTA4LTE3IiwicmV2Ijo0LCJpYXQiOjE3NTU0MDAwMDB9",
        ".yiQ9tbd-6lnTXv8JqeKIJzmI70WJx67yH84Tc8hO167_jIsRA_MPOBUyokKeTlU5TuaOvAznA-fmonaA676QCA"
    );

    let entitlement = verifier
        .decode(token, "device-vector", "00112233445566778899aabbccddeeff")
        .unwrap();

    assert_eq!(entitlement.status, EntitlementStatus::Active);
    assert_eq!(entitlement.updates_through.as_deref(), Some("2027-08-17"));
    assert_eq!(entitlement.revision, 4);
    assert_eq!(entitlement.issued_at, 1_755_400_000);
}

#[test]
fn edited_or_misdirected_entitlements_are_rejected() {
    let verifier = EntitlementVerifier::new([
        0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07,
        0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07,
        0x51, 0x1a,
    ])
    .unwrap();
    let token = concat!(
        "eyJ2IjoxLCJsaWQiOiIwMDExMjIzMzQ0NTU2Njc3ODg5OWFhYmJjY2RkZWVmZiIsImRpZCI6ImRldmljZS12ZWN0",
        "b3IiLCJzdGF0dXMiOiJhY3RpdmUiLCJ1cGQiOiIyMDI3LTA4LTE3IiwicmV2Ijo0LCJpYXQiOjE3NTU0MDAwMDB9",
        ".yiQ9tbd-6lnTXv8JqeKIJzmI70WJx67yH84Tc8hO167_jIsRA_MPOBUyokKeTlU5TuaOvAznA-fmonaA676QCA"
    );

    assert!(
        verifier
            .decode(token, "wrong-device", "00112233445566778899aabbccddeeff")
            .is_none()
    );
    let (payload, signature) = token.split_once('.').unwrap();
    let replacement = if signature.starts_with('A') { "B" } else { "A" };
    let edited = format!("{payload}.{replacement}{}", &signature[1..]);
    assert!(
        verifier
            .decode(&edited, "device-vector", "00112233445566778899aabbccddeeff")
            .is_none()
    );
}
