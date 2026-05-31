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
        ovmf \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
# `docker run thriveos-builder build`  ->  `mkosi build`
ENTRYPOINT ["mkosi"]
