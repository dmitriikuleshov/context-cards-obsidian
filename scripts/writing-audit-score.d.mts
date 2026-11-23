export function scoreWritingEdits(
  actual: string[],
  testCase: {
    expected: string[];
    alternativeExpected?: string[][];
  },
): { matchedExpected: string[]; missing: string[]; extra: string[]; pass: boolean };
