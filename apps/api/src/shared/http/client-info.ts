interface IpResolver {
  requestIP(request: Request): { address: string } | null
}

/** Client IP. `x-forwarded-for` is trustworthy only when the API sits behind a reverse proxy/LB we control. */
export function clientIp(request: Request, server: IpResolver | null): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || server?.requestIP(request)?.address || 'unknown'
}

export function userAgent(request: Request): string | null {
  return request.headers.get('user-agent')?.slice(0, 255) ?? null
}
