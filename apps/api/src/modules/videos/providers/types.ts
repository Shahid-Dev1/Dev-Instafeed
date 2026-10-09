export interface OAuthTokens {
  externalUserId: string;
  username: string | null;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string;
}

/** A video from a connected creator account, normalized across providers. */
export interface AccountVideo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  embedUrl: string | null;
  permalink: string | null;
  /** Source file URL; only Instagram exposes one (for the account owner's own media). */
  mediaUrl: string | null;
  importable: boolean;
  reason: string | null;
}

export interface AccountVideoPage {
  items: AccountVideo[];
  nextCursor: string | null;
}

export class ReauthRequiredError extends Error {}
