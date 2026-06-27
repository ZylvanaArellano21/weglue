declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

declare function setTimeout(
  handler: () => void,
  timeout?: number,
  ...args: unknown[]
): number;
