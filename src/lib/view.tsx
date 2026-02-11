import { type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'

export function page(element: ReactElement): string {
  return `<!DOCTYPE html>\n${renderToString(element)}`
}
