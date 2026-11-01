export const AUTH_SECRET_MIN_LENGTH = 32;

export const requireAuthSecret = (value: string | undefined): string => {
  if (!value) {
    throw new Error(
      "AUTH_SECRET is not set. better-auth would sign sessions with its public default secret.",
    );
  }
  if (value.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error(
      `AUTH_SECRET is shorter than ${AUTH_SECRET_MIN_LENGTH} characters (got ${value.length}). Generate one with \`openssl rand -hex 32\`.`,
    );
  }
  return value;
};
