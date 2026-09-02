use std::ffi::c_void;
use std::ptr::NonNull;
use thiserror::Error;

const GHOSTTY_SUCCESS: i32 = 0;
const GHOSTTY_OUT_OF_SPACE: i32 = -3;
const GHOSTTY_TERMINAL_OPT_USERDATA: i32 = 0;
const GHOSTTY_TERMINAL_OPT_WRITE_PTY: i32 = 1;
const GHOSTTY_TERMINAL_OPT_ENQUIRY: i32 = 3;
const GHOSTTY_TERMINAL_OPT_XTVERSION: i32 = 4;
const GHOSTTY_TERMINAL_OPT_SIZE: i32 = 6;
const GHOSTTY_TERMINAL_OPT_COLOR_SCHEME: i32 = 7;
const GHOSTTY_TERMINAL_OPT_DEVICE_ATTRIBUTES: i32 = 8;
const GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES: i32 = 27;
const GHOSTTY_TERMINAL_OPT_CONTINUATION_MAX_BYTES: i32 = 31;
const GHOSTTY_TERMINAL_OPT_TERMINFO_NAME: i32 = 37;
const GHOSTTY_SNAPSHOT_DECODER_OPT_MAX_CONTINUATION_BYTES: i32 = 0;
const GHOSTTY_SNAPSHOT_DECODER_OPT_RETAIN_CONTINUATION: i32 = 1;
const MAXIMUM_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
const MAXIMUM_CONTINUATION_BYTES: usize = 16 * 1024 * 1024;
const MAXIMUM_SCROLLBACK_BYTES: usize = 64 * 1024 * 1024;

type GhosttyTerminal = *mut c_void;
type GhosttySnapshotDecoder = *mut c_void;

#[repr(C)]
struct GhosttyString {
    pointer: *const u8,
    length: usize,
}

#[repr(C)]
struct GhosttySizeReportSize {
    rows: u16,
    columns: u16,
    cell_width: u32,
    cell_height: u32,
}

#[repr(C)]
struct GhosttyDeviceAttributesPrimary {
    conformance_level: u16,
    features: [u16; 64],
    feature_count: usize,
}

#[repr(C)]
struct GhosttyDeviceAttributesSecondary {
    device_type: u16,
    firmware_version: u16,
    rom_cartridge: u16,
}

#[repr(C)]
struct GhosttyDeviceAttributesTertiary {
    unit_id: u32,
}

#[repr(C)]
struct GhosttyDeviceAttributes {
    primary: GhosttyDeviceAttributesPrimary,
    secondary: GhosttyDeviceAttributesSecondary,
    tertiary: GhosttyDeviceAttributesTertiary,
}

unsafe extern "C" {
    fn ghostty_terminal_new(
        allocator: *const c_void,
        terminal: *mut GhosttyTerminal,
        columns: u16,
        rows: u16,
    ) -> i32;
    fn ghostty_terminal_free(terminal: GhosttyTerminal);
    fn ghostty_terminal_set(terminal: GhosttyTerminal, option: i32, value: *const c_void) -> i32;
    fn ghostty_terminal_resize(
        terminal: GhosttyTerminal,
        columns: u16,
        rows: u16,
        cell_width: u32,
        cell_height: u32,
    ) -> i32;
    fn ghostty_terminal_vt_write(terminal: GhosttyTerminal, bytes: *const u8, length: usize);
    fn ghostty_snapshot_encode_buf(
        terminal: GhosttyTerminal,
        buffer: *mut u8,
        buffer_length: usize,
        written: *mut usize,
    ) -> i32;
    fn ghostty_snapshot_decoder_new_buf(
        allocator: *const c_void,
        decoder: *mut GhosttySnapshotDecoder,
        bytes: *const u8,
        length: usize,
    ) -> i32;
    fn ghostty_snapshot_decoder_set(
        decoder: GhosttySnapshotDecoder,
        option: i32,
        value: *const c_void,
    ) -> i32;
    fn ghostty_snapshot_decoder_decode(
        decoder: GhosttySnapshotDecoder,
        terminal: *mut GhosttyTerminal,
    ) -> i32;
    fn ghostty_snapshot_decoder_free(decoder: GhosttySnapshotDecoder);
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TerminalViewport {
    pub rows: u16,
    pub columns: u16,
    pub cell_width: u32,
    pub cell_height: u32,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum TerminalStateError {
    #[error("libghostty-vt returned {0}")]
    Ghostty(i32),
    #[error("terminal snapshot is {0} bytes, maximum is 64 MiB")]
    SnapshotTooLarge(usize),
    #[error("terminal state worker stopped")]
    Stopped,
}

struct ReplyContext {
    replies: Vec<Vec<u8>>,
    viewport: TerminalViewport,
}

pub struct HostTerminal {
    terminal: NonNull<c_void>,
    context: Box<ReplyContext>,
}

unsafe impl Send for HostTerminal {}

impl HostTerminal {
    pub fn new(viewport: TerminalViewport) -> Result<Self, TerminalStateError> {
        let mut terminal = std::ptr::null_mut();
        check(unsafe {
            ghostty_terminal_new(
                std::ptr::null(),
                &raw mut terminal,
                viewport.columns,
                viewport.rows,
            )
        })?;
        let terminal = NonNull::new(terminal).ok_or(TerminalStateError::Ghostty(-2))?;
        Self::from_terminal(terminal, viewport)
    }

    pub fn restore(
        snapshot: &[u8],
        viewport: TerminalViewport,
    ) -> Result<Self, TerminalStateError> {
        let mut decoder = std::ptr::null_mut();
        check(unsafe {
            ghostty_snapshot_decoder_new_buf(
                std::ptr::null(),
                &raw mut decoder,
                snapshot.as_ptr(),
                snapshot.len(),
            )
        })?;
        let decoder = Decoder(decoder);
        let continuation_limit = MAXIMUM_CONTINUATION_BYTES;
        let retain_continuation = true;
        check(unsafe {
            ghostty_snapshot_decoder_set(
                decoder.0,
                GHOSTTY_SNAPSHOT_DECODER_OPT_MAX_CONTINUATION_BYTES,
                (&raw const continuation_limit).cast(),
            )
        })?;
        check(unsafe {
            ghostty_snapshot_decoder_set(
                decoder.0,
                GHOSTTY_SNAPSHOT_DECODER_OPT_RETAIN_CONTINUATION,
                (&raw const retain_continuation).cast(),
            )
        })?;
        let mut terminal = std::ptr::null_mut();
        check(unsafe { ghostty_snapshot_decoder_decode(decoder.0, &raw mut terminal) })?;
        let terminal = NonNull::new(terminal).ok_or(TerminalStateError::Ghostty(-2))?;
        Self::from_terminal(terminal, viewport)
    }

    pub fn write(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.context.replies.clear();
        unsafe {
            ghostty_terminal_vt_write(self.terminal.as_ptr(), bytes.as_ptr(), bytes.len());
        }
        self.take_replies()
    }

    pub fn resize(
        &mut self,
        viewport: TerminalViewport,
    ) -> Result<Vec<Vec<u8>>, TerminalStateError> {
        self.context.replies.clear();
        self.context.viewport = viewport;
        check(unsafe {
            ghostty_terminal_resize(
                self.terminal.as_ptr(),
                viewport.columns,
                viewport.rows,
                viewport.cell_width,
                viewport.cell_height,
            )
        })?;
        Ok(self.take_replies())
    }

    pub fn take_replies(&mut self) -> Vec<Vec<u8>> {
        std::mem::take(&mut self.context.replies)
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, TerminalStateError> {
        let mut required = 0;
        let result = unsafe {
            ghostty_snapshot_encode_buf(
                self.terminal.as_ptr(),
                std::ptr::null_mut(),
                0,
                &raw mut required,
            )
        };
        if result != GHOSTTY_OUT_OF_SPACE {
            check(result)?;
        }
        if required > MAXIMUM_SNAPSHOT_BYTES {
            return Err(TerminalStateError::SnapshotTooLarge(required));
        }
        let mut snapshot = vec![0_u8; required];
        let mut written = 0;
        check(unsafe {
            ghostty_snapshot_encode_buf(
                self.terminal.as_ptr(),
                snapshot.as_mut_ptr(),
                snapshot.len(),
                &raw mut written,
            )
        })?;
        snapshot.truncate(written);
        Ok(snapshot)
    }

    fn from_terminal(
        terminal: NonNull<c_void>,
        viewport: TerminalViewport,
    ) -> Result<Self, TerminalStateError> {
        let mut result = Self {
            terminal,
            context: Box::new(ReplyContext {
                replies: Vec::new(),
                viewport,
            }),
        };
        result.configure()?;
        Ok(result)
    }

    fn configure(&mut self) -> Result<(), TerminalStateError> {
        let userdata = (&raw mut *self.context).cast::<c_void>();
        let continuation_limit = MAXIMUM_CONTINUATION_BYTES;
        let scrollback_limit = MAXIMUM_SCROLLBACK_BYTES;
        set(self.terminal, GHOSTTY_TERMINAL_OPT_USERDATA, userdata)?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_WRITE_PTY,
            write_pty as *const () as *const c_void,
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_ENQUIRY,
            enquiry as *const () as *const c_void,
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_XTVERSION,
            xtversion as *const () as *const c_void,
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_SIZE,
            size as *const () as *const c_void,
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_COLOR_SCHEME,
            color_scheme as *const () as *const c_void,
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_DEVICE_ATTRIBUTES,
            device_attributes as *const () as *const c_void,
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_CONTINUATION_MAX_BYTES,
            (&raw const continuation_limit).cast(),
        )?;
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES,
            (&raw const scrollback_limit).cast(),
        )?;
        let terminfo = GhosttyString {
            pointer: b"xterm-256color".as_ptr(),
            length: b"xterm-256color".len(),
        };
        set(
            self.terminal,
            GHOSTTY_TERMINAL_OPT_TERMINFO_NAME,
            (&raw const terminfo).cast(),
        )
    }
}

impl Drop for HostTerminal {
    fn drop(&mut self) {
        unsafe {
            ghostty_terminal_free(self.terminal.as_ptr());
        }
    }
}

struct Decoder(GhosttySnapshotDecoder);

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe {
            ghostty_snapshot_decoder_free(self.0);
        }
    }
}

extern "C" fn write_pty(
    _terminal: GhosttyTerminal,
    userdata: *mut c_void,
    bytes: *const u8,
    length: usize,
) {
    let context = unsafe { &mut *userdata.cast::<ReplyContext>() };
    context
        .replies
        .push(unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec());
}

extern "C" fn enquiry(_terminal: GhosttyTerminal, _userdata: *mut c_void) -> GhosttyString {
    GhosttyString {
        pointer: b"supaterm".as_ptr(),
        length: b"supaterm".len(),
    }
}

extern "C" fn xtversion(_terminal: GhosttyTerminal, _userdata: *mut c_void) -> GhosttyString {
    GhosttyString {
        pointer: b"supaterm".as_ptr(),
        length: b"supaterm".len(),
    }
}

extern "C" fn size(
    _terminal: GhosttyTerminal,
    userdata: *mut c_void,
    output: *mut GhosttySizeReportSize,
) -> bool {
    let context = unsafe { &*userdata.cast::<ReplyContext>() };
    unsafe {
        *output = GhosttySizeReportSize {
            rows: context.viewport.rows,
            columns: context.viewport.columns,
            cell_width: context.viewport.cell_width,
            cell_height: context.viewport.cell_height,
        };
    }
    true
}

extern "C" fn color_scheme(
    _terminal: GhosttyTerminal,
    _userdata: *mut c_void,
    output: *mut i32,
) -> bool {
    unsafe {
        *output = 1;
    }
    true
}

extern "C" fn device_attributes(
    _terminal: GhosttyTerminal,
    _userdata: *mut c_void,
    output: *mut GhosttyDeviceAttributes,
) -> bool {
    let mut features = [0_u16; 64];
    let advertised = [1, 6, 9, 15, 21, 22, 28];
    features[..advertised.len()].copy_from_slice(&advertised);
    unsafe {
        *output = GhosttyDeviceAttributes {
            primary: GhosttyDeviceAttributesPrimary {
                conformance_level: 62,
                features,
                feature_count: advertised.len(),
            },
            secondary: GhosttyDeviceAttributesSecondary {
                device_type: 1,
                firmware_version: 1,
                rom_cartridge: 0,
            },
            tertiary: GhosttyDeviceAttributesTertiary { unit_id: 0 },
        };
    }
    true
}

fn set(
    terminal: NonNull<c_void>,
    option: i32,
    value: *const c_void,
) -> Result<(), TerminalStateError> {
    check(unsafe { ghostty_terminal_set(terminal.as_ptr(), option, value) })
}

fn check(result: i32) -> Result<(), TerminalStateError> {
    if result == GHOSTTY_SUCCESS {
        Ok(())
    } else {
        Err(TerminalStateError::Ghostty(result))
    }
}
