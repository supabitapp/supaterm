// Adapted from SidePulse Pro Eject Prevention (MIT, Copyright (c) 2026 Peter Kuhar).
// loginwindow ejects any disk that appears while the screen is locked, such as the SD slot
// re-enumerating after a hibernate wake. Ejects go through Disk Arbitration approval, so this
// daemon dissents them for SidePulse volumes and retries the mount until the user unlocks.
#include <CoreFoundation/CoreFoundation.h>
#include <DiskArbitration/DiskArbitration.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define MOUNT_RETRY_SECONDS 5.0
#define DA_PID_CHECK_SECONDS 0.5
#define LOG_TRUNCATE_BYTES (1024 * 1024)
#define DA_PIDFILE "/var/run/diskarbitrationd.pid"

static long g_da_pid = 0;
static DASessionRef g_session = NULL;

static long disk_arbitration_pid(void) {
    FILE *file = fopen(DA_PIDFILE, "r");
    if (!file) return 0;
    long pid = 0;
    if (fscanf(file, "%ld", &pid) != 1 || pid <= 0) pid = 0;
    fclose(file);
    return pid;
}

// A restarted diskarbitrationd forgets this session; launchd KeepAlive starts a fresh one.
static void check_disk_arbitration(CFRunLoopTimerRef timer, void *ctx) {
    (void)timer;
    (void)ctx;
    long pid = disk_arbitration_pid();
    if (g_da_pid > 0 && pid > 0 && pid != g_da_pid) {
        fprintf(stderr, "diskarbitrationd changed from %ld to %ld; restarting\n", g_da_pid, pid);
        exit(0);
    }
    if (g_da_pid == 0) g_da_pid = pid;
}

static void truncate_stdout_if_large(void) {
    fflush(stdout);
    struct stat st;
    int fd = fileno(stdout);
    if (fd < 0 || fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size <= LOG_TRUNCATE_BYTES)
        return;
    if (ftruncate(fd, 0) == 0) lseek(fd, 0, SEEK_SET);
    clearerr(stdout);
}

// Matches the desktop app's detection: the FAT label "SidePulse", optionally "Pro" and a number.
static bool is_sidepulse_name(const char *name) {
    char normalized[64];
    size_t length = 0;
    for (const char *c = name; *c && length < sizeof(normalized) - 1; c++) {
        if (isalnum((unsigned char)*c)) normalized[length++] = (char)tolower((unsigned char)*c);
    }
    normalized[length] = '\0';
    if (strncmp(normalized, "sidepulse", 9) != 0) return false;
    const char *rest = normalized + 9;
    if (strncmp(rest, "pro", 3) == 0) rest += 3;
    for (; *rest; rest++) {
        if (!isdigit((unsigned char)*rest)) return false;
    }
    return true;
}

static bool is_builtin_sidepulse(DADiskRef disk, char *volume, size_t volume_size) {
    CFDictionaryRef desc = DADiskCopyDescription(disk);
    if (!desc) return false;
    CFStringRef proto = CFDictionaryGetValue(desc, kDADiskDescriptionDeviceProtocolKey);
    CFStringRef model = CFDictionaryGetValue(desc, kDADiskDescriptionDeviceModelKey);
    CFStringRef name = CFDictionaryGetValue(desc, kDADiskDescriptionVolumeNameKey);
    bool builtin_sd =
        (proto && CFStringFind(proto, CFSTR("Secure Digital"), 0).location != kCFNotFound) ||
        (model && CFStringFind(model, CFSTR("SDXC"), 0).location != kCFNotFound);
    bool match = builtin_sd && name &&
                 CFStringGetCString(name, volume, (CFIndex)volume_size, kCFStringEncodingUTF8) &&
                 is_sidepulse_name(volume);
    CFRelease(desc);
    return match;
}

static bool is_mounted(DADiskRef disk) {
    CFDictionaryRef desc = DADiskCopyDescription(disk);
    if (!desc) return false;
    bool mounted = CFDictionaryGetValue(desc, kDADiskDescriptionVolumePathKey) != NULL;
    CFRelease(desc);
    return mounted;
}

// The slot holds one card, so one retry loop covers it; a newer eject replaces it.
static CFRunLoopTimerRef g_retry_timer = NULL;

static void stop_mount_retries(void) {
    if (!g_retry_timer) return;
    CFRunLoopTimerInvalidate(g_retry_timer);
    CFRelease(g_retry_timer);
    g_retry_timer = NULL;
}

// A callback's disk object keeps the description from that event, so re-resolve it to see the mount.
static void retry_mount(CFRunLoopTimerRef timer, void *info) {
    (void)timer;
    const char *bsd_name = DADiskGetBSDName((DADiskRef)info);
    DADiskRef disk = bsd_name ? DADiskCreateFromBSDName(kCFAllocatorDefault, g_session, bsd_name) : NULL;
    if (!disk) {
        stop_mount_retries();
        return;
    }
    if (is_mounted(disk)) {
        stop_mount_retries();
    } else {
        DADiskMount(disk, NULL, kDADiskMountOptionDefault, NULL, NULL);
    }
    CFRelease(disk);
}

static void start_mount_retries(DADiskRef disk) {
    stop_mount_retries();
    CFRunLoopTimerContext context = {0, (void *)disk, CFRetain, CFRelease, NULL};
    g_retry_timer = CFRunLoopTimerCreate(
        kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + MOUNT_RETRY_SECONDS,
        MOUNT_RETRY_SECONDS, 0, 0, retry_mount, &context);
    CFRunLoopAddTimer(CFRunLoopGetCurrent(), g_retry_timer, kCFRunLoopDefaultMode);
}

static void disk_disappeared(DADiskRef disk, void *ctx) {
    (void)ctx;
    if (!g_retry_timer) return;
    CFRunLoopTimerContext context;
    CFRunLoopTimerGetContext(g_retry_timer, &context);
    if (CFEqual(disk, (DADiskRef)context.info)) stop_mount_retries();
}

static DADissenterRef eject_approval(DADiskRef disk, void *ctx) {
    (void)ctx;
    char volume[256];
    if (!is_builtin_sidepulse(disk, volume, sizeof(volume))) return NULL;
    const char *bsd_name = DADiskGetBSDName(disk);
    truncate_stdout_if_large();
    printf("prevented eject of %s (volume: %s)\n", bsd_name ? bsd_name : "?", volume);
    fflush(stdout);
    start_mount_retries(disk);
    return DADissenterCreate(kCFAllocatorDefault, kDAReturnNotPermitted,
                             CFSTR("Supaterm keeps SidePulse connected"));
}

int main(void) {
    g_da_pid = disk_arbitration_pid();
    DASessionRef session = DASessionCreate(kCFAllocatorDefault);
    g_session = session;
    if (!session) {
        fprintf(stderr, "DASessionCreate failed\n");
        return 1;
    }
    DARegisterDiskEjectApprovalCallback(session, NULL, eject_approval, NULL);
    DARegisterDiskDisappearedCallback(session, NULL, disk_disappeared, NULL);
    DASessionScheduleWithRunLoop(session, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    CFRunLoopTimerRef daemon_timer = CFRunLoopTimerCreate(
        kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + DA_PID_CHECK_SECONDS,
        DA_PID_CHECK_SECONDS, 0, 0, check_disk_arbitration, NULL);
    CFRunLoopAddTimer(CFRunLoopGetCurrent(), daemon_timer, kCFRunLoopDefaultMode);
    CFRelease(daemon_timer);
    CFRunLoopRun();
    return 0;
}
