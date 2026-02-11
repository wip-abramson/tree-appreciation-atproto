export function Shell({
  title,
  children,
  headContent,
}: {
  title: string
  children: React.ReactNode
  headContent?: React.ReactNode
}) {
  return (
    <html>
      <head>
        <title>{title}</title>
        <link rel="stylesheet" href="/public/styles.css" />
        {headContent}
      </head>
      <body>{children}</body>
    </html>
  )
}
