# thriveOS — builds **Sprout** 🌱

**Sprout** is a self-hosted **appliance distro** whose entire purpose is to run
[thrive](https://github.com/nerfarrow/thrive) — specifically the platform shell in
its [`core/`](../core/) directory. Boot a machine on it and it comes up as a thrive
server on your LAN — Docker, thrive's `core/` stack, and its modules, with nothing
else in the way.

> **Names:** *thriveOS* is this build project (the `os/` dir); **Sprout** is the
> bootable distro it produces (`sprout.raw`). The app it runs is **thrive**. Sprout
> ships as a tiny ~1.6 GB seed image that **grows to fill its disk on first boot** —
> hence the name. It's a Debian trixie derivative (`ID=sprout`, `ID_LIKE=debian`).

> **v0 scope:** a reproducible **amd64 appliance image** (minimal Debian + Docker +
> thrive's `core/` stack, brought up on first boot). It is *not* a from-scratch distro
> — it's a stock Debian base assembled declaratively with [mkosi](https://github.com/systemd/mkosi).
> We earn the from-scratch distro later only if we ever actually need it.

## How it works
1. `mkosi` assembles a minimal Debian `trixie` rootfs with Docker + tooling baked in.
2. Our overlay ([`mkosi.extra/`](mkosi.extra/)) adds a systemd service + a first-boot
   bootstrap script.
3. On first boot, `thrive-bootstrap` clones the thrive repo into `/opt/thrive` and
   `thrive.service` runs `docker compose up -d --build` from `/opt/thrive/core`.
4. The machine is now a thrive server on `http://<its-ip>:9500`.

```
 [ Debian trixie minimal ]
        + Docker + compose
        + thrive.service / thrive-bootstrap
        =  sprout.raw     →  flash to disk / boot as VM
                              boot → grow → thrive (core/) on :9500
```

## Build & test — no host tooling required
Everything runs in a **privileged build container** (defined in [`build/`](build/)),
so the host needs only Docker. Nothing is installed on the host; the build emits a
`.raw` disk image into this directory.

```bash
make builder   # build the build-container (debian + mkosi + qemu)
make image     # produce sprout*.raw  (privileged container; needs KVM for speed)
make vm        # boot the freshly built image in QEMU to test
make clean     # remove build artifacts
```

**Flash to a USB stick** (gives the stick meaningful labels — shows up as `Sprout`,
not mkosi's default `root-x86-64`):
```bash
sudo ./write-usb.sh /dev/sdX           # refuses non-removable/non-USB; retype to confirm
sudo FORCE=1 ./write-usb.sh /dev/sdX   # skip the confirm prompt (scripted)
```
Then boot the target in **UEFI mode, Secure Boot off**.

> ⚠️ **First build is a bring-up pass, not guaranteed one-shot.** OS image tooling is
> fussy: exact `mkosi` verb names, Debian package names (e.g. the compose plugin), and
> bootloader specifics vary by version. Expect to iterate `make image` a couple times.
> Spots likely to need a tweak are marked `# VERIFY` in the config.

## Design decisions (v0)
- **Appliance, not distro** — stock Debian base, declaratively assembled. Maintainable.
- **amd64**, testable in QEMU first (no flashing hardware to iterate).
- **XFCE desktop** (LightDM login → XFCE, with Firefox) so the box is usable at a
  monitor — open thrive's own UI locally, or just have a desktop. It's still a server
  first (thrive runs as a service regardless of who's logged into X); the desktop is a
  convenience layer. Networking stays on systemd-networkd (no NetworkManager).
- **thrive pulled at first boot**, not baked in — so the appliance tracks the repo
  without rebuilding the OS image. (A future "release-pinned" mode can bake a version in.)

## Security notes (read before shipping past your LAN)
- Default console login is **`thrive` / `growth`** (a sudo user; created in
  [`mkosi.postinst`](mkosi.postinst)); root also has a default password set in
  [`mkosi.conf`](mkosi.conf). **Change both** before any real deployment.
- thrive runs over **http** on :9500 (`COOKIE_SECURE=false`). Fine on a trusted
  LAN; put it behind TLS (reverse proxy) for anything exposed.

## Status
- [x] Repo + containerized build pipeline scaffolded
- [x] `make image` produces a bootable `sprout.raw` (~1.6G, UEFI ESP)
- [x] Boots to Debian userspace — hostname `sprout`, root autologin
- [x] docker / ssh / thrive services enabled in the image
- [x] grow-on-boot: root grows to fill the disk (systemd-repart + growfs)
- [x] **thrive live on :9500** — verified end-to-end on a real LAN
- [x] **Flash + boot on real amd64 hardware** — USB → UEFI boot → autologin →
      first-boot clone+build → thrive serving on the network (2026-06-11)
- [ ] Optional kiosk-display mode
- [ ] Release-pinned thrive mode (bake a thrive version in vs. pull-on-boot)
