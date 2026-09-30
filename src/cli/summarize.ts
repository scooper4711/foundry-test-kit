#!/usr/bin/env node
/**
 * Summarizes a Playwright JSON report after a `foundry-test test run`:
 * overall counts plus, for every failed test, its spec file, title path,
 * and the first lines of its errors.
 *
 *   summarize.js <report.json>
 */
import { readFileSync } from "node:fs";
import { isMainModule } from "./is-main.js";

interface ReportError {
  message?: string;
  location?: { file: string; line: number };
}

interface ReportResult {
  status: string;
  errors?: ReportError[];
}

interface ReportSuite {
  specs?: { title: string; file: string; tests?: { status: string; results?: ReportResult[] }[] }[];
  suites?: ReportSuite[];
}

export interface RunSummary {
  passed: number;
  skipped: number;
  flaky: number;
  failures: { file: string; title: string; errors: string[] }[];
}

/** Tallies a Playwright JSON report (tolerating log lines before the JSON). */
export function summarizeReport(rawReport: string): RunSummary {
  const report = JSON.parse(rawReport.slice(rawReport.indexOf("{"))) as { suites?: ReportSuite[] };
  const summary: RunSummary = { passed: 0, skipped: 0, flaky: 0, failures: [] };
  for (const suite of report.suites ?? []) visitSuite(suite, summary);
  return summary;
}

function visitSuite(suite: ReportSuite, summary: RunSummary): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      // test.status is "expected" for a pass or an intended skip,
      // "unexpected" for a real failure, "flaky" for a pass after retry.
      const attempts = test.results ?? [];
      if (attempts.length > 0 && attempts.every((result) => result.status === "skipped")) {
        summary.skipped += 1;
      } else if (test.status === "unexpected") {
        summary.failures.push({ file: spec.file, title: spec.title, errors: failureMessages(attempts) });
      } else {
        summary.passed += 1;
        if (test.status === "flaky") summary.flaky += 1;
      }
    }
  }
  for (const child of suite.suites ?? []) visitSuite(child, summary);
}

function failureMessages(attempts: ReportResult[]): string[] {
  return attempts
    .filter((result) => result.status !== "passed" && result.status !== "skipped")
    .flatMap((result) => (result.errors ?? []).filter(Boolean))
    .map(
      (error) =>
        `${error.message ?? String(error)}${error.location ? ` (${error.location.file}:${error.location.line})` : ""}`
    );
}

/** Renders the summary for the terminal. */
export function formatSummary(summary: RunSummary): string {
  const total = summary.passed + summary.skipped + summary.failures.length;
  const lines = [
    `\n=== Summary: ${summary.passed} passed, ${summary.failures.length} failed, ${summary.skipped} skipped, ` +
      `${summary.flaky} flaky (${total} total) ===`,
  ];
  for (const failure of summary.failures) {
    lines.push(`\nFAIL ${failure.file}\n  ${failure.title}`);
    for (const error of failure.errors.slice(0, 2)) {
      lines.push(`    ${error.split("\n").slice(0, 15).join("\n    ")}`);
    }
  }
  return lines.join("\n");
}

if (isMainModule(import.meta.url)) {
  const [reportPath] = process.argv.slice(2);
  try {
    console.log(formatSummary(summarizeReport(readFileSync(reportPath ?? "", "utf8"))));
  } catch (failure) {
    console.error(`summarize: cannot read report ${reportPath}: ${String(failure)}`);
  }
}
