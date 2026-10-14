# Deployment & releases

## GitHub setup

The repository is `Ripwords/BambuDeck`. Its GitHub Actions workflows validate changes, publish Docker images, and deploy documentation to `https://ripwords.github.io/BambuDeck/`.

In **Settings → Secrets and variables → Actions**, create:

| Secret               | Value                                                            |
| -------------------- | ---------------------------------------------------------------- |
| `DOCKERHUB_USERNAME` | Docker Hub account with push access to `ripwords/bambudeck`.     |
| `DOCKERHUB_TOKEN`    | Docker Hub access token with permission to push that repository. |

Create the public `ripwords/bambudeck` repository on Docker Hub. Enter credentials directly into GitHub's secret fields; do not commit them or paste them into issue discussions.

In **Settings → Pages**, choose **GitHub Actions** as the build source. Pages deploys the documentation; it does not host the dashboard server or connect to printers. BambuDeck itself runs on your Docker host.

## Workflows

| Trigger                        | Result                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Pull request or push to `main` | Validate Conventional Commits, formatting, linting, typecheck, and build the app and documentation. No automated tests. |
| Push to `main`                 | Publish documentation through GitHub Pages.                                                                             |
| Push a stable `vX.Y.Z` tag     | Publish AMD64/ARM64 Docker images with version tags and `latest`.                                                       |
| Push a prerelease version tag  | Publish a versioned preview image without replacing `latest`.                                                           |
| Manually run Docker publishing | Publish the development `edge` image.                                                                                   |

After publishing a version tag, the workflow creates a GitHub Release with a version-pinned `compose.production.yaml` and `SHA256SUMS`. Download those assets when you want a deployment file tied to that release.

Docker builds use Buildx and a shared build cache. Credentials are supplied through GitHub Actions secrets. Review the workflow run before deploying a newly published tag.

## Publish a release

Commit changes with Conventional Commit messages and merge into `main`. Husky validates formatting, linting, and commit messages locally; CI validates commit messages and PR titles.

```sh
git switch main
git pull --ff-only
bun run release --dry-run
bun run release --minor
```

The release command checks the working tree, verifies local `main` matches `origin/main`, runs format/lint/type/build checks, and uses changelogen to update `CHANGELOG.md` and the package version. It then creates a release commit and annotated tag and pushes both atomically. Use `--patch`, `--minor`, or `--major`; these are literal increments, including before version 1.0. GitHub Actions creates release notes from the matching changelog section after publishing the image.

Use the next version for subsequent releases. Stable tags publish the exact version plus moving minor, major, and `latest` tags. Pin deployments to an exact version for predictable upgrades. Prerelease tags such as `v0.2.0-rc.1` remain opt-in.

If publishing fails, fix the underlying configuration and rerun the failed workflow. Avoid reusing an already published release tag for changed code.

## Upgrade and rollback

Back up your data first. Set the desired tag in `.env`:

```dotenv
BAMBUDECK_VERSION=0.1.0
```

Then pull and recreate the service:

```sh
docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
docker compose -f compose.production.yaml logs --tail=100 dashboard
```

Open the dashboard and confirm your printer connection. These commands preserve the named data volume.

To roll back, change `BAMBUDECK_VERSION` to the previous version and repeat the commands. If a release changed the storage format, restore its matching pre-upgrade backup as well; older images may not understand newer data.

`latest` follows stable releases. `edge` follows manually published development builds and is intended for preview use.

## Backup and restore

Back up all of `/data`, including `bambudeck.sqlite`, any SQLite sidecar files, and `secret.key`. If you supply `APP_ENCRYPTION_KEY`, preserve that value separately. Keep backups private.

For a consistent copy, stop the service briefly:

```sh
mkdir -p backup
docker compose -f compose.production.yaml stop dashboard
docker compose -f compose.production.yaml cp dashboard:/data/. ./backup/
docker compose -f compose.production.yaml start dashboard
```

Use a fresh backup directory for each backup. If copying fails, restart the stopped service and resolve the error before relying on that backup.

To restore onto a fresh deployment with an empty data volume:

```sh
docker compose -f compose.production.yaml create dashboard
docker compose -f compose.production.yaml cp ./backup/. dashboard:/data/
docker compose -f compose.production.yaml run --rm --user 0 --entrypoint chown dashboard -R 1000:1000 /data
docker compose -f compose.production.yaml up -d
```

Restore the original external encryption key before starting if you used one. Do not mix files from different backups or copy a backup over a running database.

## Validate locally

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run docs:build
docker compose build
docker compose up -d
docker compose ps
```

The runtime image includes Bun and FFmpeg, runs as a nonroot user, and exposes a healthcheck at `/api/health`. Successful builds and healthchecks do not establish real printer compatibility; see [Verification](./VERIFICATION.md).
