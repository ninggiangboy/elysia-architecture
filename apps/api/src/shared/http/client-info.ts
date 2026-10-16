interface IpResolver {
  requestIP(request: Request): { address: string } | null
}

/** IP client. `x-forwarded-for` chỉ đáng tin khi API nằm sau reverse proxy/LB do mình kiểm soát. */
export function clientIp(request: Request, server: IpResolver | null): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || server?.requestIP(request)?.address || 'unknown'
}

export function userAgent(request: Request): string | null {
  return request.headers.get('user-agent')?.slice(0, 255) ?? null
}
