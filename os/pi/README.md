# sprout-pi — thriveOS for Raspberry Pi 5

The arm64 flavor of **Sprout**: same appliance (Docker + `thrive.service` +
first-boot bootstrap from the shared [`../mkosi.extra/`](../mkosi.extra/)
overlay), rebuilt for the Pi 5's very different boot reality:

| | amd64 Sprout | sprout-pi |
|---|---|---|
| Boot | UEFI → systemd-boot | Pi firmware loads the kernel directly |
| Partition table | GPT | **MBR** (the Pi firmware can't read GPT) |
| Disk assembly | mkosi `Format=disk` | mkosi `Format=directory` + [`build.sh`](build.sh) |
| First-boot grow | systemd-repart | `sprout-grow` (growpart + resize2fs; repart is GPT-only) |
| Kernel | mainline `linux-image-arm64` | **RPi downstream `linux-image-rpi-2712`** (see below) |
| Desktop | XFCE + Firefox | **headless** (ssh + thrive on :9500) |

## Why the Raspberry Pi kernel, not mainline
The Pi 5 moved **USB *and* Ethernet behind the `RP1` I/O chip**, whose drivers are
**not in mainline Linux 6.12** (what Debian trixie ships) — only in Raspberry Pi's
downstream kernel. A mainline image boots the Pi 5's CPU but has **no network**, so
the first-boot bootstrap can't even clone thrive → dead appliance. So this image
keeps a **Debian userland** but pulls the kernel + boot firmware from
`archive.raspberrypi.com` (`linux-image-rpi-2712`, kernel 6.18; verified to carry the
RP1 drivers). Apt config in [`mkosi.sandbox/`](mkosi.sandbox/) (build) +
[`mkosi.extra/`](mkosi.extra/) (image), pinned so *only* the kernel/firmware come
from RPi. (Pi 4 worked fine on mainline — its I/O is on-SoC — but the Pi 5 needs this.)

> The RPi repo is marked `Trusted: yes`: trixie's apt verifier (`sqv`) rejects the RPi
> archive key's SHA1 binding signature (policy change 2026-02-01). Revisit if RPi re-keys.

## Build (on any amd64 box with Docker)
```bash
cd os
make pi-image        # → os/sprout-pi.raw
```
The arm64 rootfs is cross-built under qemu-user binfmt emulation — expect the first
build to be slow (emulated dpkg) and to download the arm64 debs + RPi kernel into the
shared `mkosi.cache/`. `SKIP_MKOSI=1` (env) reuses an already-built rootfs to re-run
just the disk assembly.

## Flash & boot
```bash
# from os/ — dd the Pi image to the SD card / USB SSD (NOT write-usb.sh; that's the
# amd64 stick flasher and its size/USB guards reject SD cards)
sudo dd if=sprout-pi.raw of=/dev/sdX bs=4M conv=fsync status=progress && sync
```
Boot the Pi 5 with wired ethernet. First boot: grows root to fill the card, clones
thrive into `/opt/thrive`, builds + starts the stack → `http://<pi-ip>:9500`.
Logins: `thrive` / `growth` (sudo) or root / `sprout` — **dev defaults, change them**.
Serial console is live on the Pi 5 UART (115200) if it ever doesn't come up.

## Honest expectations
- A Pi 5 (4 GB+) runs the stack comfortably, but the **first boot is slow**: it
  docker-builds thrive's UI (npm/vite) on the Pi itself. Give it time.
- Userland is Debian trixie; only the **kernel + boot firmware** track Raspberry Pi.
  Kernel updates on the running Pi pull from the RPi repo (see `mkosi.extra` apt config).
- SD cards die under Docker write load eventually; a USB-attached SSD is the nicer
  home for a long-lived appliance (the image boots from USB unchanged).
- **Untested on real Pi 5 hardware yet** — built + structurally verified (RP1 in the
  kernel, `kernel_2712.img` + `bcm2712-rpi-5-b.dtb` on the boot partition), but the
  proof is a boot. Flash it and watch the serial console / `http://<ip>:9500`.
