/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from '@atproto/lexicon'
import { lexicons } from '../../../lexicons'
import { isObj, hasProp } from '../../../util'
import { CID } from 'multiformats/cid'

export interface Record {
  name?: string
  /** A nearby place label grounding the tree in the physical world, e.g. reverse-geocoded from coordinates */
  place?: string
  description?: string
  image?: BlobRef
  latitude?: string
  longitude?: string
  createdAt: string
  [k: string]: unknown
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, '$type') &&
    (v.$type === 'com.treeappreciation.tree#main' ||
      v.$type === 'com.treeappreciation.tree')
  )
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate('com.treeappreciation.tree#main', v)
}
