import { describe, expect, it } from "vitest";
import { formatSummary, summarizeReport } from "../src/cli/summarize.js";

const report = {
  suites: [
    {
      specs: [
        { title: "passes", file: "a.spec.ts", tests: [{ status: "expected", results: [{ status: "passed" }] }] },
        { title: "skips", file: "a.spec.ts", tests: [{ status: "skipped", results: [{ status: "skipped" }] }] },
      ],
      suites: [
        {
          specs: [
            {
              title: "retries",
              file: "b.spec.ts",
              tests: [{ status: "flaky", results: [{ status: "failed" }, { status: "passed" }] }],
            },
            {
              title: "fails",
              file: "b.spec.ts",
              tests: [
                {
                  status: "unexpected",
                  results: [
                    {
                      status: "failed",
                      errors: [{ message: "Expected 1\nReceived 2", location: { file: "b.spec.ts", line: 9 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("summarizeReport", () => {
  it("counts outcomes across nested suites, after leading log lines", () => {
    const summary = summarizeReport(`[setup] log line\n${JSON.stringify(report)}`);
    expect(summary).toMatchObject({ passed: 2, skipped: 1, flaky: 1 });
    expect(summary.failures).toEqual([
      { file: "b.spec.ts", title: "fails", errors: ["Expected 1\nReceived 2 (b.spec.ts:9)"] },
    ]);
  });
});

describe("formatSummary", () => {
  it("prints the totals and each failure", () => {
    const text = formatSummary(summarizeReport(JSON.stringify(report)));
    expect(text).toContain("=== Summary: 2 passed, 1 failed, 1 skipped, 1 flaky (4 total) ===");
    expect(text).toContain("FAIL b.spec.ts\n  fails");
    expect(text).toContain("    Expected 1\n    Received 2 (b.spec.ts:9)");
  });
});
