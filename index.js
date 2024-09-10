#!/usr/bin/env node

import { program } from "commander";
import axios from "axios";
import path from "node:path";
import os from "os";
import fs from "fs";
import * as stream from "stream";
import { promisify } from "util";
import decompress from "decompress";

const HOME_DIR = os.homedir();
const ROOT_DIR = path.join(HOME_DIR, ".wbvm");

const finished = promisify(stream.finished);

async function downloadFile(fileUrl, outputLocationPath) {
  const writer = fs.createWriteStream(outputLocationPath);
  return axios({
    method: "get",
    url: fileUrl,
    responseType: "stream",
  }).then((response) => {
    response.data.pipe(writer);
    return finished(writer);
  });
}

async function fetchVersions() {
  try {
    const releases = (
      await axios.get(
        "https://api.github.com/repos/babymotte/worterbuch/releases"
      )
    ).data;
    const file = path.join(ROOT_DIR, "releases.json");
    try {
      fs.writeFileSync(file, JSON.stringify(releases, null, 2));
    } catch (err) {
      console.error("Could not write releases file:", err.message);
    }
  } catch (err) {
    console.error("Could not fetch available releases:", err.message);
  }
}

async function listVersions() {
  try {
    await fetchVersions();
    const releases = loadReleases().map((r) => r.name);
    for (const r of releases) {
      const version = r.substring(1);
      console.log(isInstalled(version) ? `${version} (installed)` : version);
    }
  } catch (err) {
    console.error("Could not fetch available releases:", err.message);
  }
}

async function installVersion(version) {
  const releases = loadReleases();
  const versionName =
    version === "latest" ? getLatest(releases) : "v" + version;
  version = versionName.substring(1);
  let release;
  for (const r of releases) {
    if (r.name === versionName) {
      release = r;
      break;
    }
  }

  if (!release) {
    console.error(`No release with name v${version}, "found.`);
    return;
  }

  let zipFileName;

  switch (process.platform) {
    case "linux": {
      zipFileName = "worterbuch-x86_64-unknown-linux-gnu.zip";
      break;
    }
    case "win32": {
      zipFileName = "worterbuch-x86_64-pc-windows-msvc.zip";
      break;
    }
    case "darwin": {
      zipFileName = "worterbuch-x86_64-apple-darwin.zip";
      break;
    }
    default: {
      console.error("Operating system", process.platform, "is not supported.");
      return;
    }
  }

  let asset;

  for (const a of release.assets) {
    if (a.name === zipFileName) {
      asset = a;
      break;
    }
  }

  if (!asset) {
    console.error("No asset found for this OS.");
    return;
  }

  const zipFilePath = path.join(ROOT_DIR, zipFileName);

  try {
    await downloadFile(asset.browser_download_url, zipFilePath);

    const versionDir = path.join(ROOT_DIR, version);

    await decompress(zipFilePath, versionDir);

    const files = fs.readdirSync(versionDir);

    files.forEach((file) => {
      const filePath = path.join(versionDir, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        fs.chmodSync(filePath, 0o755);
      }
    });

    console.log("Ok");
  } catch (err) {
    console.error("Failed to install:", err.message);
  }
}

function useVersion(version) {
  console.log("use", version);
}

async function setDefaultVersion(version) {
  const versionName =
    version === "latest" ? getLatest(loadReleases()) : "v" + version;
  version = versionName.substring(1);

  if (!isInstalled(version)) {
    console.error(
      "Version",
      version,
      "is not installed, please install it first!"
    );
    return;
  }

  const binPath = path.join(ROOT_DIR, "bin");
  const dirPath = path.join(ROOT_DIR, version);

  if (fs.existsSync(binPath)) {
    fs.rmSync(binPath);
  }

  fs.symlinkSync(dirPath, binPath);
}

function loadReleases() {
  const file = path.join(ROOT_DIR, "releases.json");
  const data = fs.readFileSync(file);
  return JSON.parse(data);
}

function getLatest(releases) {
  return releases[0].name;
}

function isInstalled(version) {
  const filePath = path.join(ROOT_DIR, version, "worterbuch");
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const stats = fs.statSync(filePath);
  return stats.isFile();
}

function main() {
  if (!fs.existsSync(ROOT_DIR)) {
    try {
      fs.mkdirSync(ROOT_DIR);
    } catch (err) {
      console.error("Error creating app dir:", err.message);
    }
    if (!fs.existsSync(ROOT_DIR)) {
      process.exit(1);
    } else {
      console.log("App dir already exists.");
    }
  }

  program.version("1.0.0").description("Manage Wörterbuch versions");

  program
    .command("list")
    .description("List available versions")
    .action(listVersions);

  program
    .command("install <version>")
    .description("Install specified version")
    .action(installVersion);

  program
    .command("use <version>")
    .description("Use specified version for this session")
    .action(useVersion);

  program
    .command("default <version>")
    .description("Set the specified version as the default version to use")
    .action(setDefaultVersion);

  program.parse(process.argv);
}

main();
