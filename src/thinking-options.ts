export type ThinkingChoice = 'off' | 'on' | 'default' | `level:${string}`;
export type ThinkingValue = boolean | string;
export interface ThinkingSupport {
  known: boolean;
  values: ThinkingValue[];
  default?: ThinkingValue;
}
export function validThinkingChoice(value: unknown): value is ThinkingChoice {
  return (
    value === 'off' ||
    value === 'on' ||
    value === 'default' ||
    (typeof value === 'string' &&
      /^level:[^\s\x00-\x1f][^\x00-\x1f]{0,63}$/.test(value) &&
      value === value.trim())
  );
}
export function parseThinkingSupport(raw: unknown): ThinkingSupport {
  const metadata = (raw as { thinking?: { values?: unknown; default?: unknown } } | null)?.thinking;
  const values = metadata?.values;
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 32 ||
    values.some(
      (v) =>
        typeof v !== 'boolean' &&
        (typeof v !== 'string' ||
          !v.trim() ||
          v !== v.trim() ||
          v.length > 64 ||
          /[\x00-\x1f]/.test(v)),
    )
  )
    return { known: false, values: [] };
  const support: ThinkingSupport = { known: true, values: [...new Set(values)] };
  if (support.values.includes(metadata!.default as ThinkingValue))
    support.default = metadata!.default as ThinkingValue;
  return support;
}
export function thinkingChoices(
  support: ThinkingSupport,
): Array<{ value: ThinkingChoice; label: string }> {
  if (!support.known) return [{ value: 'default', label: 'Model default' }];
  if (support.values.length === 1 && support.values[0] === false)
    return [{ value: 'off', label: 'Not supported' }];
  return [
    ...support.values.map((v) =>
      typeof v === 'boolean'
        ? { value: v ? ('on' as const) : ('off' as const), label: v ? 'On' : 'Off' }
        : {
            value: `level:${v}` as const,
            label:
              ({ low: 'Low', medium: 'Medium', high: 'High' } as Record<string, string>)[v] ?? v,
          },
    ),
    { value: 'default', label: 'Model default' },
  ];
}
export function thinkingValue(
  choice: ThinkingChoice,
  support: ThinkingSupport,
): ThinkingValue | null | undefined {
  if (choice === 'default') return support.known ? null : undefined;
  if (choice === 'off') return support.known && !support.values.includes(false) ? null : false;
  if (!support.known)
    throw new Error('Thinking support is unknown. Use Model default or check Ollama in settings.');
  const value = choice === 'on' ? true : choice.slice(6);
  if (!support.values.includes(value))
    throw new Error(
      'This model does not support the selected Thinking option. Check Ollama and choose an available option in settings.',
    );
  return value;
}

export function usesThinking(
  value: ThinkingValue | null | undefined,
  support: ThinkingSupport,
): boolean {
  return (
    value !== false &&
    !(
      value == null &&
      (support.default === false || (support.known && support.values.every((v) => v === false)))
    )
  );
}
