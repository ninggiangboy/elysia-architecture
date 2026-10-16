export interface AccessTokenClaims {
  userId: string
  /** = id của refresh-token family (phiên đăng nhập). */
  sessionId: string
}

export interface AccessTokenVerifier {
  /** Ném lỗi nếu token sai chữ ký, hết hạn hoặc sai issuer/audience. */
  verify(token: string): Promise<AccessTokenClaims>
}
