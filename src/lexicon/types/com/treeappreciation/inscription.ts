/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from '@atproto/lexicon'
import { lexicons } from '../../../lexicons'
import { isObj, hasProp } from '../../../util'
import { CID } from 'multiformats/cid'

export interface Record {
  text?: string
  image?: BlobRef
  tree: string
  createdAt: string
  /** When the photo was taken, from EXIF or manual entry */
  photoTakenAt?: string
  [k: string]: unknown
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, '$type') &&
    (v.$type === 'com.treeappreciation.inscription#main' ||
      v.$type === 'com.treeappreciation.inscription')
  )
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate('com.treeappreciation.inscription#main', v)
}
