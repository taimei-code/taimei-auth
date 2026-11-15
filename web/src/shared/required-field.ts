import { Array, Effect, Option, String } from "effect";
import { Dom } from "foldkit";

export type RequiredField = Readonly<{
  id: string;
  label: string;
  value: string;
  isEmail?: true;
}>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export const isBlank = (value: string): boolean => String.isEmpty(String.trim(value));

export const requiredErrorText = (label: string): string => `${label}を入力してください。`;

const fieldErrorOf = (field: Omit<RequiredField, "id">): Option.Option<string> => {
  if (isBlank(field.value)) {
    return Option.some(requiredErrorText(field.label));
  }
  return field.isEmail === true && !EMAIL_SHAPE.test(String.trim(field.value))
    ? Option.some(`${field.label}の形式が正しくありません。`)
    : Option.none();
};

export const maybeFieldError = (
  showsRequiredErrors: boolean,
  field: Omit<RequiredField, "id">,
): Option.Option<string> => (showsRequiredErrors ? fieldErrorOf(field) : Option.none());

export const maybeFirstInvalidField = (
  fields: ReadonlyArray<RequiredField>,
): Option.Option<RequiredField> =>
  Array.findFirst(fields, (field) => Option.isSome(fieldErrorOf(field)));

export const focusField = (id: string): Effect.Effect<void> =>
  Dom.focus(`#${id}`).pipe(Effect.ignore);
