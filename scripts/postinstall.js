#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const BIN_DIR = path.join(PACKAGE_ROOT, "bin");
const RECON_BIN = path.join(BIN_DIR, "recon");
const OWNER_REPO = "hegstadjosh/claude-manager";

function log(msg) {
  console.log(`[claude-manager] ${msg}`);
}

function isSourceCheckout() {
  return fs.existsSync(path.join(PACKAGE_ROOT, ".git"));
}

function targetTriple() {
  const key = `${process.platform}-${process.arch}`;
  const mapping = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
  };
  return mapping[key] || null;
}

function fail(message) {
  const source = isSourceCheckout();
  log(message);
  if (source) {
    log("Source checkout detected, continuing without downloaded binary.");
    return;
  }
  process.exit(1);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed (${res.statusCode})`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function main() {
  if (process.env.CLAUDE_MANAGER_SKIP_POSTINSTALL === "1") {
    log("Skipping binary download (CLAUDE_MANAGER_SKIP_POSTINSTALL=1).");
    return;
  }

  const target = targetTriple();
  if (!target) {
    fail(`Unsupported platform/arch: ${process.platform}/${process.arch}`);
    return;
  }

  const pkg = require(path.join(PACKAGE_ROOT, "package.json"));
  const version = pkg.version;
  const asset = `recon-v${version}-${target}.tar.gz`;
  const url = `https://github.com/${OWNER_REPO}/releases/download/v${version}/${asset}`;
  const tmpTar = path.join(os.tmpdir(), asset);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  log(`Downloading ${asset}...`);

  try {
    await download(url, tmpTar);
  } catch (err) {
    fail(`Failed to download binary from ${url}: ${err.message}`);
    log("Manual fallback: cargo install --path server/");
    return;
  }

  const extracted = spawnSync("tar", ["-xzf", tmpTar, "-C", BIN_DIR], { stdio: "inherit" });
  if (extracted.status !== 0) {
    fail(`Failed to extract ${asset}`);
    return;
  }

  if (!fs.existsSync(RECON_BIN)) {
    fail(`Extracted archive but ${RECON_BIN} was not found`);
    return;
  }

  fs.chmodSync(RECON_BIN, 0o755);
  const verify = spawnSync(RECON_BIN, ["--version"], { encoding: "utf8" });
  if (verify.status !== 0) {
    fail(`Downloaded binary failed --version check`);
    return;
  }

  log(`Installed recon (${verify.stdout.trim()}).`);
}

main().catch((err) => {
  fail(`postinstall failed: ${err.message}`);
});

