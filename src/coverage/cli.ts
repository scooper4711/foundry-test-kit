#!/usr/bin/env node
/**
 * foundry-test-coverage: turns the raw V8 chunks the fixtures recorded in
 * coverage/e2e-raw/ into an Istanbul report on the module's source files.
 *
 * Each chunk is mapped back onto the sources through the bundle's
 * sourcemap, the chunks are merged, and text + lcov reports are written to
 * coverage/e2e/. Run it after the integration suite.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import convertSourceMap from "convert-source-map";
import v8toIstanbul from "v8-to-istanbul";
import { loadTestKitConfig } from "../config.js";
import { COVERAGE_RAW_DIR } from "../coverage.js";
import { isMainModule } from "../cli/is-main.js";

interface RawChunk {
  url: string;
  functions: Parameters<ReturnType<typeof v8toIstanbul>["applyCoverage"]>[0];
}

interface SourceMapJson {
  sources: string[];
  sourcesContent?: (string | null)[];
}

export async function writeCoverageReport(projectRoot: string, bundlePath: string): Promise<void> {
  const bundle = resolve(projectRoot, bundlePath);
  const rawDirectory = resolve(projectRoot, COVERAGE_RAW_DIR);
  const tempDirectory = resolve(projectRoot, "coverage/.e2e-tmp");
  const reportDirectory = resolve(projectRoot, "coverage/e2e");
  if (!existsSync(bundle) || !existsSync(`${bundle}.map`)) {
    throw new Error(`foundry-test-coverage: ${bundlePath}(.map) missing — build the module first`);
  }
  const rawFiles = existsSync(rawDirectory) ? readdirSync(rawDirectory).filter((f) => f.endsWith(".json")) : [];
  if (rawFiles.length === 0) {
    throw new Error(`foundry-test-coverage: no chunks in ${COVERAGE_RAW_DIR} — run the integration suite first`);
  }
  rmSync(tempDirectory, { recursive: true, force: true });
  mkdirSync(tempDirectory, { recursive: true });
  const chunks = await convertChunks(bundle, projectRoot, rawDirectory, rawFiles, tempDirectory);
  console.log(`foundry-test-coverage: converted ${chunks} chunk(s) from ${rawFiles.length} file(s)`);
  const nyc = ["nyc", "report", "--temp-dir", tempDirectory, "--report-dir", reportDirectory];
  execFileSync("npx", [...nyc, "--reporter=text", "--reporter=lcov", "--exclude", "node_modules/**"], {
    stdio: "inherit",
    cwd: projectRoot,
  });
  rmSync(tempDirectory, { recursive: true, force: true });
  console.log(`foundry-test-coverage: report written to ${reportDirectory}/lcov.info`);
}

async function convertChunks(
  bundle: string,
  projectRoot: string,
  rawDirectory: string,
  rawFiles: string[],
  tempDirectory: string
): Promise<number> {
  const source = readFileSync(bundle, "utf8");
  const sourceMap = convertSourceMap.fromObject(loadSourceMap(bundle, projectRoot));
  let chunks = 0;
  for (const file of rawFiles) {
    const entries = JSON.parse(readFileSync(join(rawDirectory, file), "utf8")) as RawChunk[];
    for (const [index, entry] of entries.entries()) {
      // Pass the local bundle path, not the page URL: the converter resolves
      // the map's relative sources against it.
      const converter = v8toIstanbul(bundle, 0, { source, sourceMap });
      await converter.load();
      converter.applyCoverage(entry.functions);
      const name = `${file.replace(/\.json$/, "")}-${index}.json`;
      writeFileSync(join(tempDirectory, name), JSON.stringify(converter.toIstanbul()));
      chunks += 1;
    }
  }
  return chunks;
}

/** Reads the bundle's sourcemap, filling missing sourcesContent from disk. */
function loadSourceMap(bundle: string, projectRoot: string): SourceMapJson {
  const map = JSON.parse(readFileSync(`${bundle}.map`, "utf8")) as SourceMapJson;
  if (map.sourcesContent?.every(Boolean)) return map;
  const bundleDirectory = resolve(bundle, "..");
  map.sourcesContent = map.sources.map(
    (relativePath) => readIfExists(join(bundleDirectory, relativePath)) ?? readIfExists(join(projectRoot, relativePath)) ?? ""
  );
  return map;
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

if (isMainModule(import.meta.url)) {
  const config = loadTestKitConfig();
  writeCoverageReport(config.projectRoot, config.coverage.bundle).catch((failure: unknown) => {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  });
}
