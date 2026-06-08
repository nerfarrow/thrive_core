# thriveOS

A self-hosted **appliance OS** whose entire purpose is to run
[thrive](https://github.com/nerfarrow/thrive) — specifically the platform shell in
its [`core/`](../core/) directory. Boot a machine on it and it comes up as a thrive
server on your LAN — Docker, thrive's `core/` stack, and its modules, with nothing
else in the way.

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
        =  thriveos.raw   →  flash to disk / boot as VM
                              boot → thrive (core/) on :9500
```

## Build & test — no host tooling required
Everything runs in a **privileged build container** (defined in [`build/`](build/)),
so the host needs only Docker. Nothing is installed on the host; the build emits a
`.raw` disk image into this directory.

```bash
make builder   # build the build-container (debian + mkosi + qemu)
make image     # produce thriveos*.raw  (privileged container; needs KVM for speed)
make vm        # boot the freshly built image in QEMU to test
make clean     # remove build artifacts
```

> ⚠️ **First build is a bring-up pass, not guaranteed one-shot.** OS image tooling is
> fussy: exact `mkosi` verb names, Debian package names (e.g. the compose plugin), and
> bootloader specifics vary by version. Expect to iterate `make image` a couple times.
> Spots likely to need a tweak are marked `# VERIFY` in the config.

## Design decisions (v0)
- **Appliance, not distro** — stock Debian base, declaratively assembled. Maintainable.
- **amd64**, testable in QEMU first (no flashing hardware to iterate).
- **Headless server** by default — thrive is a household app you reach from your
  phone/laptop, not a kiosk terminal. (A kiosk-display mode is a future opt-in.)
- **thrive pulled at first boot**, not baked in — so the appliance tracks the repo
  without rebuilding the OS image. (A future "release-pinned" mode can bake a version in.)

## Security notes (read before shipping past your LAN)
- v0 sets a **default root password + console autologin** for testing — see
  [`mkosi.conf`](mkosi.conf). **Change these** before any real deployment.
- thrive runs over **http** on :9500 (`COOKIE_SECURE=false`). Fine on a trusted
  LAN; put it behind TLS (reverse proxy) for anything exposed.

## Status
- [x] Repo + containerized build pipeline scaffolded
- [x] `make image` produces a bootable `thriveos.raw` (1.7G, UEFI ESP)
- [x] Boots in QEMU to Debian userspace — hostname `thriveos`, root autologin
- [x] docker / ssh / thrive services enabled in the image (verified at build time)
- [ ] thrive live on :9500 — needs a boot on a real network (guest must reach
      GitHub + Docker Hub to clone the thrive repo and pull its images). Not verifiable
      in a network-restricted build sandbox; the machinery is in place and assembled.
- [ ] Flash/boot on real amd64 hardware
- [ ] Optional kiosk-display mode
- [ ] Release-pinned thrive mode (bake a thrive version in vs. pull-on-boot)
