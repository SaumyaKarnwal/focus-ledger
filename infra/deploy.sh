#!/usr/bin/env bash
# Deploys origin/main to Cloud Run, then deletes every image in the registry except the two newest
# and the one that serves traffic. Two images fit in the free Artifact Registry storage (0.5 GB) and
# keep one version to roll back to.
#
# Usage: ./gradlew deploy                    (builds the program first)
#        infra/deploy.sh --dry-run           (shows what the cleanup would delete, changes nothing)
set -euo pipefail

PROJECT=ekagra-510007
REGION=asia-southeast1
SERVICE=focus-ledger
CONFIGURATION=focus-ledger
REPOSITORY="$REGION-docker.pkg.dev/$PROJECT/ekagra/focus-ledger"
KEEP_IMAGES=2

dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true

gcp() { gcloud --configuration="$CONFIGURATION" --project="$PROJECT" --quiet "$@"; }

cd "$(git rev-parse --show-toplevel)"

registry_login() {
  gcp auth print-access-token |
    docker login -u oauth2accesstoken --password-stdin "https://$REGION-docker.pkg.dev" \
      >/dev/null 2>&1
  # docker login stores the access token in ~/.docker/config.json until the logout.
  trap 'docker logout "https://$REGION-docker.pkg.dev" >/dev/null 2>&1' EXIT
}

deploy() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "The worktree has changes. Deploy only a clean checkout of origin/main." >&2
    exit 1
  fi
  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "HEAD is not origin/main. Run: git switch --detach origin/main" >&2
    exit 1
  fi
  if [ ! -x backend/app/build/install/app/bin/app ]; then
    echo "The program is not built. Run ./gradlew deploy, not this script." >&2
    exit 1
  fi

  local image
  image="$REPOSITORY:$(git rev-parse --short=7 HEAD)"
  # Without provenance and SBOM, the push is one manifest, so the cleanup cannot split an image.
  docker build --platform linux/amd64 --provenance=false --sbom=false -t "$image" .
  registry_login
  docker push "$image"
  gcp run deploy "$SERVICE" --image="$image" --region="$REGION"
}

# The digests to keep: the two newest tagged images, the serving image, and the manifests that
# any of them lists (an older multi-platform push stores the image under an untagged digest).
kept_digests() {
  local images="$1" serving="$2"
  {
    jq -r --argjson keep "$KEEP_IMAGES" \
      '[.[] | select((.tags // []) | length > 0)] | sort_by(.createTime) | reverse
       | .[:$keep][] | .version' <<<"$images"
    echo "$serving"
  } | sort -u | while read -r digest; do
    echo "$digest"
    docker buildx imagetools inspect --raw "$REPOSITORY@$digest" | jq -r '.manifests[]?.digest'
  done | sort -u
}

clean_up() {
  local images kept revision serving
  registry_login
  revision=$(gcp run services describe "$SERVICE" --region="$REGION" \
    --format='value(status.traffic[0].revisionName)')
  serving=$(gcp run revisions describe "$revision" --region="$REGION" \
    --format='value(status.imageDigest)' | sed 's/.*@//')
  images=$(gcp artifacts docker images list "$REPOSITORY" --include-tags --format=json)
  kept=$(kept_digests "$images" "$serving")
  if [ -z "$serving" ] || ! grep -qxF "$serving" <<<"$kept"; then
    echo "The serving image is not in the kept list, so nothing is deleted." >&2
    exit 1
  fi
  # Tagged entries first: an index goes before the untagged manifests that it lists.
  jq -r '(map(select((.tags // []) | length > 0)) + map(select((.tags // []) | length == 0)))[]
         | .version' <<<"$images" |
    { grep -vxF -f <(printf '%s\n' "$kept") || true; } |
    while read -r digest; do
      if $dry_run; then
        echo "Would delete $digest"
      else
        gcp artifacts docker images delete "$REPOSITORY@$digest" --delete-tags
      fi
    done
  echo "Kept (the serving image is $serving):"
  printf '  %s\n' $kept
}

$dry_run || deploy
clean_up
