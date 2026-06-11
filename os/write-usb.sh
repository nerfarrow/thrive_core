#!/usr/bin/env bash
# write-usb.sh — flash Sprout to a USB stick and give it MEANINGFUL volume labels.
#
# Usage:  sudo ./write-usb.sh /dev/sdX [image.raw]
#         sudo FORCE=1 ./write-usb.sh /dev/sdX        # skip the confirm prompt
#
# Defaults the image to ./sprout.raw (run `make image` first). Refuses anything
# that isn't a removable USB disk, and makes you retype the device name unless
# FORCE=1. After dd it relabels the filesystems so the stick shows up as "Sprout"
# instead of mkosi's default "root-x86-64"/"ESP" — safe, because boot uses GPT
# partition TYPES (discoverable-partitions spec), not filesystem labels.
set -euo pipefail

DEV="${1:?usage: write-usb.sh /dev/sdX [image.raw]}"
RAW="${2:-$(cd "$(dirname "$0")" && pwd)/sprout.raw}"
LABEL_ROOT="Sprout"        # ext4 label (<=16 chars) — the volume you see when plugged in
LABEL_ESP="SPROUT-ESP"     # FAT label (<=11 chars, uppercased by the FS)

[ "$(id -u)" -eq 0 ] || { echo "ABORT: run as root (sudo)"; exit 1; }
[ -b "$DEV" ]        || { echo "ABORT: $DEV is not a block device"; exit 1; }
[ -f "$RAW" ]        || { echo "ABORT: image not found: $RAW (run 'make image' first)"; exit 1; }

RM=$(lsblk -dno RM   "$DEV"); TR=$(lsblk -dno TRAN "$DEV"); SZ=$(blockdev --getsize64 "$DEV")
[ "$RM" = "1" ]   || { echo "ABORT: $DEV is not removable — refusing to write"; exit 1; }
[ "$TR" = "usb" ] || { echo "ABORT: $DEV is not a USB device — refusing"; exit 1; }

echo "About to ERASE and flash:"
lsblk -o NAME,SIZE,MODEL,TRAN,RM,LABEL "$DEV"
echo "image: $RAW ($(du -h "$RAW" | cut -f1))"
if [ "${FORCE:-0}" != "1" ]; then
    read -rp "Retype the device to confirm ($DEV): " ok
    [ "$ok" = "$DEV" ] || { echo "aborted."; exit 1; }
fi

echo "=== unmount + wipe old signatures ==="
for p in "${DEV}"*; do [ "$p" = "$DEV" ] && continue; umount "$p" 2>/dev/null || true; done
wipefs -a "$DEV"; sgdisk --zap-all "$DEV" 2>/dev/null || true

echo "=== writing image ==="
dd if="$RAW" of="$DEV" bs=4M conv=fsync status=progress
sync; partprobe "$DEV" 2>/dev/null || true; sleep 1

echo "=== labeling (Sprout) ==="
for p in "${DEV}1" "${DEV}2"; do umount "$p" 2>/dev/null || true; done
e2label  "${DEV}2" "$LABEL_ROOT"
fatlabel "${DEV}1" "$LABEL_ESP" 2>/dev/null || dosfslabel "${DEV}1" "$LABEL_ESP" 2>/dev/null || true
partprobe "$DEV" 2>/dev/null || true; sleep 1

echo "=== done ==="
lsblk -no NAME,SIZE,FSTYPE,LABEL "$DEV"
