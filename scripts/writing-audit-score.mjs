// Alternative gold plans are scorer-only; none are included in model requests.
export function scoreWritingEdits(actual, testCase) {
  const plans = [testCase.expected, ...(testCase.alternativeExpected || [])];
  const scored = plans.map((expected) => ({
    matchedExpected: expected,
    missing: expected.filter((s) => !actual.includes(s)),
    extra: actual.filter((s) => !expected.includes(s)),
  }));
  scored.sort((a, b) => a.missing.length + a.extra.length - b.missing.length - b.extra.length);
  const best = scored[0];
  return { ...best, pass: !best.missing.length && !best.extra.length };
}
