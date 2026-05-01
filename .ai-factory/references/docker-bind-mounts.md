# Docker Bind Mounts Reference

> Source: https://docs.docker.com/engine/storage/bind-mounts/
> Created: 2026-05-01
> Updated: 2026-05-01

## Overview

Docker bind mounts map a host file or directory into a container. This matters for Tuitube's Local Bot API deployment because Telegram Bot API local-path/file-URI uploads only work when the Bot API server process can see the same file path that the bot process passes.

If Tuitube and `telegram-bot-api` run in different containers, an absolute path inside one container is not automatically valid inside the other. Shared bind mounts must be designed so both processes can access the downloaded file at an agreed path, or the implementation should fall back to `InputFile` streaming.

## Core Concepts

Bind mount: a host path mounted into a container path.

Source path: host-side file or directory. Docker docs call this `source` or `src`.

Destination path: container-side mount point. Docker docs call this `destination`, `dst`, or `target`; it must be absolute.

Daemon host: bind mounts are created on the Docker daemon host, not necessarily the CLI client machine. Remote Docker daemons cannot bind-mount client-local files.

Container path identity: two containers only share a path if both are mounted in a way that gives them access to the same host data. The destination path can differ between containers, which makes passing raw absolute paths across containers unsafe unless coordinated.

Read-only mount: `readonly` or `ro` prevents writes from the container into the mounted host path.

Obscured contents: mounting over a non-empty container directory hides the original directory contents for the lifetime of that container.

## API / Interface

### `--mount` Syntax

```bash
docker run --mount type=bind,src=<host-path>,dst=<container-path>
```

Options:

| Option | Meaning |
| --- | --- |
| `source`, `src` | Host file or directory path. Can be absolute or relative. |
| `destination`, `dst`, `target` | Container mount path. Must be absolute. |
| `readonly`, `ro` | Mount read-only. |
| `bind-propagation` | Advanced propagation setting. |

By default, `--mount` errors if the source path does not exist.

### `--volume` Syntax

```bash
docker run -v <host-path>:<container-path>[:opts]
```

Fields:

| Field | Meaning |
| --- | --- |
| First | Host path. |
| Second | Container destination path. |
| Third | Optional comma-separated options such as `ro`. |

Docker docs note that `--volume` can create a missing host source as a directory, while `--mount` is more explicit.

### Docker Compose Bind Mount

```yaml
services:
  frontend:
    image: node:lts
    volumes:
      - type: bind
        source: ./static
        target: /opt/app/static
```

## Usage Patterns

### Shared Download Directory For Tuitube And Local Bot API

If local path/file-URI optimization is enabled, both services need access to the same download directory.

```yaml
services:
  tuitube-bot:
    volumes:
      - type: bind
        source: /srv/tuitube/downloads
        target: /srv/tuitube/downloads

  telegram-bot-api:
    volumes:
      - type: bind
        source: /srv/tuitube/downloads
        target: /srv/tuitube/downloads
```

The key property is that the absolute path passed by the bot, such as `/srv/tuitube/downloads/job/file.mp4`, is also valid inside the Bot API server container.

### Safer Default: Stream Through grammY

When path identity is not guaranteed, avoid local path/file URI optimization and let grammY stream the file contents.

```ts
await bot.api.sendVideo(chatId, new InputFile(result.filePath), {
  supports_streaming: true,
});
```

This requires the Tuitube bot process to see the file, but not the Bot API server container to resolve the same absolute path.

### Verify Mounts

```bash
docker inspect <container>
```

Look for `Mounts` entries with `Type`, `Source`, `Destination`, `Mode`, and `RW`.

## Configuration

| Deployment shape | Requirement for local path/file URI upload |
| --- | --- |
| Bot and Bot API server on same host process namespace | Bot API server must read the absolute path passed by the bot. |
| Bot and Bot API server in separate containers | Bind the same host directory into both containers at the same destination path, or translate paths explicitly. |
| Remote Docker daemon | Source path must exist on the daemon host, not the CLI client. |
| Docker Desktop | Host path sharing goes through Docker Desktop's Linux VM support; verify with `docker inspect` and smoke tests. |

## Best Practices

1. Keep `InputFile` streaming as the default until local path visibility is proven.
2. If using local path/file URI optimization, mount the download directory into both containers at the same absolute path.
3. Prefer `--mount` or Compose long syntax for explicit `source` and `target`.
4. Use read-only mounts where possible, but Tuitube's download directory must be writable by the downloader process.
5. Verify mounts with `docker inspect` before claiming Local Bot API local-path delivery works.
6. Include a smoke test with a file larger than 50 MB after enabling Local Bot API mode.

## Common Pitfalls

1. Passing `/app/downloads/file.mp4` to a Bot API server container that only has `/data/downloads/file.mp4`.
2. Assuming a host path exists when using a remote Docker daemon; bind mounts are created on the daemon host.
3. Mounting over a non-empty container directory and hiding files that the image expected to be present.
4. Forgetting that bind mounts are writable by default and can modify host files.
5. Using local path/file URI upload without a rollback path to `InputFile` streaming.

## Version Notes

This reference is based on Docker Engine bind mount docs fetched on 2026-05-01. Docker Desktop and remote daemon behavior can affect path visibility; verify the actual target host before deployment.
