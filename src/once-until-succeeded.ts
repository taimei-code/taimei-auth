export const onceUntilSucceeded = (run: () => Promise<void>) => {
  let attempt: Promise<void> | null = null;
  return (): Promise<void> => {
    attempt ??= run().catch((cause: unknown) => {
      attempt = null;
      throw cause;
    });
    return attempt;
  };
};
