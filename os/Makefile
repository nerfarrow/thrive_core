# thriveOS build — produces Sprout, the thrive appliance distro (sprout.raw).
# Containerized; host needs only Docker.
SHELL := /bin/bash
BUILDER := sprout-builder
# base image for the build-container; override when Docker Hub is unreachable, e.g.
#   make builder BASE=some-local-debian-trixie:latest
BASE ?= debian:trixie-slim
# pass /dev/kvm through when present so QEMU/mkosi build is fast (TCG fallback otherwise)
KVM := $(shell [ -e /dev/kvm ] && echo "--device /dev/kvm" || echo "")
RUN := docker run --rm --privileged $(KVM) -v $$PWD:/work -w /work $(BUILDER)

.PHONY: builder image vm shell clean

builder:                ## build the build-container (debian + mkosi + qemu)
	docker build --build-arg BASE=$(BASE) -t $(BUILDER) build/

image: builder          ## produce sprout*.raw
	# --package-cache-directory points the apt .deb cache at the host-mounted
	# mkosi.cache/ (not mkosi's in-container default, which the --rm throws away),
	# so re-builds reuse the ~1GB of packages instead of re-downloading them.
	# --force replaces a prior sprout.raw (mkosi refuses to overwrite otherwise)
	$(RUN) --package-cache-directory=/work/mkosi.cache --force build

vm: builder             ## boot the built image in QEMU
	docker run --rm -it --privileged $(KVM) -v $$PWD:/work -w /work $(BUILDER) vm

vmdk: builder           ## sprout.raw -> sprout.vmdk (VirtualBox/VMware/Proxmox; sparse)
	docker run --rm -v $$PWD:/work -w /work --entrypoint qemu-img $(BUILDER) \
		convert -f raw -O vmdk -o subformat=monolithicSparse sprout.raw sprout.vmdk

vdi: builder            ## sprout.raw -> sprout.vdi (VirtualBox native; sparse)
	docker run --rm -v $$PWD:/work -w /work --entrypoint qemu-img $(BUILDER) \
		convert -f raw -O vdi sprout.raw sprout.vdi

shell: builder          ## drop into the build-container for debugging
	docker run --rm -it --privileged $(KVM) -v $$PWD:/work -w /work --entrypoint /bin/bash $(BUILDER)

clean:                  ## remove build artifacts
	-$(RUN) clean
	rm -rf output mkosi.output *.raw *.qcow2
