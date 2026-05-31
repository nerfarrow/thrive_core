# Build-container for thriveOS images. Carries mkosi + the toolchain needed to
# assemble a bootable Debian disk image and test-boot it in QEMU. Run privileged.
FROM debian:trixie-slim

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
