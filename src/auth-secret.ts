export const requireAuthSecret = (value: string | undefined): string => {
  if (value) return value;
  throw new Error(
    "AUTH_SECRET is not set. better-auth would sign sessions with its public default secret.",
  );
};
