import * as v from "valibot";

import { InputValidationError } from "./errors.js";

const EmailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email());

export function normalizeEmail(email: string): string {
  try {
    return v.parse(EmailSchema, stripWrappingQuotes(email));
  } catch (error) {
    throw new InputValidationError("A valid email address is required.", { cause: error });
  }
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const firstCharacter = trimmed.at(0);
  const lastCharacter = trimmed.at(-1);
  if (!isQuote(firstCharacter) || firstCharacter !== lastCharacter) {
    return trimmed;
  }

  return trimmed.slice(1, -1).trim();
}

function isQuote(character: string | undefined): character is '"' | "'" {
  return character === '"' || character === "'";
}
