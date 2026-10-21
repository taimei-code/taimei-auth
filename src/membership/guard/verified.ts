declare const checkedByGuard: unique symbol;

export type Verified<T> = T & { readonly [checkedByGuard]: T };

export const verified = <T>(value: T): Verified<T> => value as Verified<T>;
