/**
 * A name someone has offered for a tree.
 *
 * Today a tree carries at most one, because the tree record lives in the
 * seeder's repo and only they can write it. The shape is a list anyway: names
 * are personal, and when other stewards can offer their own, nothing about how
 * they are stored, read, or rendered has to change.
 */
export type TreeName = {
  name: string
  /** The person who offered it. A name is always someone's. */
  handle: string
  did: string
  /** Whether the viewer is the one who offered this name. */
  isYours: boolean
}

/**
 * The lexicon permits 200 characters, which is a sentence, not a name. Existing
 * records are left alone; this is what the form and the route will accept.
 */
export const MAX_TREE_NAME = 60

/**
 * How much of a rejected name we hand back to the form. Longer than the limit
 * on purpose: someone who typed 90 characters needs to see all 90 to decide
 * what to cut. Bounded so an over-long name can't bloat the redirect URL.
 */
export const MAX_TREE_NAME_ECHO = 200

export type NameError = 'too_long' | 'blank' | 'save_failed'

const NAME_ERRORS: Record<NameError, string> = {
  too_long: `A name can be at most ${MAX_TREE_NAME} characters.`,
  blank: 'That name is only spaces.',
  save_failed: "The name couldn't be saved. Nothing was changed.",
}

export function isNameError(value: unknown): value is NameError {
  return typeof value === 'string' && value in NAME_ERRORS
}

export function nameErrorMessage(error: NameError): string {
  return NAME_ERRORS[error]
}
