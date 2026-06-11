# Build-container for thriveOS images. Carries mkosi + the toolchain needed to
# assemble a bootable Debian disk image and test-boot it in QEMU. Run privileged.
#
# BASE is parametrized so the builder can start from any Debian-trixie userland.
# Default is the official slim image; override (e.g. BASE=some-local-trixie:latest)
# when Docker Hub is unreachable but a local Debian image + deb.debian.org are.
ARG BASE=debian:trixie-slim
FROM ${BASE}

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        mkosi \
        debootstrap \
        systemd-container \
        dosfstools \
        e2fsprogs \
        mtools \
        gdisk \
        ca-certificates \
        apt-utils \
        qemu-system-x86 \
        qemu-utils \
        ovmf \
        git \
        qemu-user-static \
        binfmt-support \
        fdisk \
    && rm -rf /var/lib/apt/lists/*
# qemu-user-static + binfmt-support: arm64 (Raspberry Pi) rootfs builds on an
# amd64 host — pi/build.sh registers the qemu-aarch64 binfmt at runtime (the deb
# postinst can't do it during docker build; binfmt_misc isn't mounted there).
# fdisk: sfdisk for the Pi image's MBR partition table (the Pi firmware can't
# read GPT, which is all mkosi/systemd-repart produce).

WORKDIR /work
# `docker run thriveos-builder build`  ->  `mkosi build`
ENTRYPOINT ["mkosi"]
