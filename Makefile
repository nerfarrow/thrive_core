# thriveOS — containerized image build. Host needs only Docker.
SHELL := /bin/bash
BUILDER := thriveos-builder
# base image for the build-container; override when Docker Hub is unreachable, e.g.
#   make builder BASE=some-local-debian-trixie:latest
BASE ?= debian:trixie-slim
# pass /dev/kvm through when present so QEMU/mkosi build is fast (TCG fallback otherwise)
KVM := $(shell [ -e /dev/kvm ] && echo "--device /dev/kvm" || echo "")
RUN := docker run --rm --privileged $(KVM) -v $$PWD:/work -w /work $(BUILDER)

.PHONY: builder image vm shell clean

builder:                ## build the build-container (debian + mkosi + qemu)
	docker build --build-arg BASE=$(BASE) -t $(BUILDER) build/

image: builder          ## produce thriveos*.raw
	$(RUN) build

vm: builder             ## boot the built image in QEMU
	docker run --rm -it --privileged $(KVM) -v $$PWD:/work -w /work $(BUILDER) vm

shell: builder          ## drop into the build-container for debugging
	docker run --rm -it --privileged $(KVM) -v $$PWD:/work -w /work --entrypoint /bin/bash $(BUILDER)

clean:                  ## remove build artifacts
	-$(RUN) clean
	rm -rf output mkosi.output *.raw *.qcow2
