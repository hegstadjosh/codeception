# Claude Manager

Local dashboard for monitoring and managing multiple Claude Code sessions from one browser tab.

## Quick start

```bash
npx claude-manager
```

Opens `http://localhost:3456` and starts:
- `recon serve` on `localhost:3100`
- Dashboard server on `localhost:3456`
- Manager tmux session (unless `--no-manager`)

## Requirements

- Node.js 20+
- `tmux`
- Claude Code CLI (`npm i -g @anthropic-ai/claude-code`)
- macOS or Linux

## CLI options

```bash
claude-manager --port 8080
claude-manager --no-open
claude-manager --no-manager
claude-manager stop
```

## How packaging works

- npm package ships built Next.js standalone output.
- `postinstall` downloads a prebuilt `recon` binary matching your platform.
- Runtime state is stored in `~/.claude-manager/`:
  - `config.json`
  - `recon-summaries.json`
  - `recon-groups.json`
  - `recon-notes.json`
  - `recon-names.json`
  - `recon.log`
  - `next.log`

## Development

```bash
pnpm install
bash scripts/dev.sh
```

Dev script:
- builds Rust backend from `server/`
- starts `recon serve` on `3100`
- starts Next.js dev server on `3456`

## Release

Tag a version:

```bash
git tag v0.5.1
git push --tags
```

Release workflow:
- builds target binaries (`aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`)
- uploads binary tarballs to GitHub Release
- builds standalone frontend
- publishes npm package

## Support

If you like it, pay me :)

Venmo: `@josh-hegstad`
