use bytes::BytesMut;
use supaterm_host::protocol::frame::{
    DecodeError, Direction, Frame, FrameDecoder, FrameKind, MAX_TERMINAL_PAYLOAD, PREFACE,
};

#[test]
fn fragmented_preface_and_frame_decode_to_one_message() {
    let mut decoder = FrameDecoder::new(Direction::ClientToHost);
    let mut bytes = BytesMut::new();
    let wire = [
        PREFACE.as_slice(),
        &[FrameKind::ClientControl as u8, 0, 0, 0, 0, 0, 0, 0, 2],
        b"{}",
    ]
    .concat();

    for byte in wire {
        bytes.extend_from_slice(&[byte]);
        if let Some(frame) = decoder.decode(&mut bytes).unwrap() {
            assert_eq!(
                frame,
                Frame {
                    kind: FrameKind::ClientControl,
                    stream_id: 0,
                    payload: b"{}".to_vec().into(),
                }
            );
        }
    }

    assert!(bytes.is_empty());
}

#[test]
fn coalesced_frames_remain_separate() {
    let mut wire = BytesMut::from(PREFACE.as_slice());
    Frame {
        kind: FrameKind::ClientControl,
        stream_id: 0,
        payload: b"one".to_vec().into(),
    }
    .encode(&mut wire)
    .unwrap();
    Frame {
        kind: FrameKind::TerminalInput,
        stream_id: 7,
        payload: b"two".to_vec().into(),
    }
    .encode(&mut wire)
    .unwrap();
    let mut decoder = FrameDecoder::new(Direction::ClientToHost);

    assert_eq!(
        decoder.decode(&mut wire).unwrap().unwrap().payload,
        b"one"[..]
    );
    assert_eq!(
        decoder.decode(&mut wire).unwrap().unwrap().payload,
        b"two"[..]
    );
    assert!(decoder.decode(&mut wire).unwrap().is_none());
}

#[test]
fn oversized_terminal_frame_fails_from_its_header() {
    let mut wire = BytesMut::from(PREFACE.as_slice());
    wire.extend_from_slice(&[FrameKind::TerminalInput as u8]);
    wire.extend_from_slice(&1_u32.to_be_bytes());
    wire.extend_from_slice(
        &u32::try_from(MAX_TERMINAL_PAYLOAD + 1)
            .unwrap()
            .to_be_bytes(),
    );
    let mut decoder = FrameDecoder::new(Direction::ClientToHost);

    assert_eq!(
        decoder.decode(&mut wire),
        Err(DecodeError::Oversized {
            kind: FrameKind::TerminalInput,
            length: MAX_TERMINAL_PAYLOAD + 1,
            maximum: MAX_TERMINAL_PAYLOAD,
        })
    );
}

#[test]
fn unknown_and_misdirected_frames_fail() {
    let mut unknown = BytesMut::from(PREFACE.as_slice());
    unknown.extend_from_slice(&[255, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(
        FrameDecoder::new(Direction::ClientToHost).decode(&mut unknown),
        Err(DecodeError::UnknownKind(255))
    );

    let mut misdirected = BytesMut::from(PREFACE.as_slice());
    misdirected.extend_from_slice(&[FrameKind::HostControl as u8, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(
        FrameDecoder::new(Direction::ClientToHost).decode(&mut misdirected),
        Err(DecodeError::InvalidDirection {
            kind: FrameKind::HostControl,
            direction: Direction::ClientToHost,
        })
    );
}

#[test]
fn control_and_terminal_streams_cannot_be_confused() {
    let mut control = BytesMut::from(PREFACE.as_slice());
    control.extend_from_slice(&[FrameKind::ClientControl as u8, 0, 0, 0, 1, 0, 0, 0, 0]);
    assert_eq!(
        FrameDecoder::new(Direction::ClientToHost).decode(&mut control),
        Err(DecodeError::InvalidStream {
            kind: FrameKind::ClientControl,
            stream_id: 1,
        })
    );

    let mut terminal = BytesMut::from(PREFACE.as_slice());
    terminal.extend_from_slice(&[FrameKind::TerminalInput as u8, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(
        FrameDecoder::new(Direction::ClientToHost).decode(&mut terminal),
        Err(DecodeError::InvalidStream {
            kind: FrameKind::TerminalInput,
            stream_id: 0,
        })
    );
}
