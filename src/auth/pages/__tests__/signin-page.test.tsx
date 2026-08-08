/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../test/test-utils';
import { SignInPage } from '../signin-page';

describe('SignInPage - OIDC Login Integration Tests', () => {
  let mockLoginPopup: any;
  let mockPublicClientApplication: any;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockCrypto = {
      getRandomValues: (arr: Uint8Array) => arr.fill(1),
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      },
    };

    vi.stubGlobal('crypto', mockCrypto);

    mockLoginPopup = vi.fn().mockResolvedValue({
      idToken: 'mock-id-token',
      idTokenClaims: { nonce: 'mocked-hashed-nonce' },
    });

    mockPublicClientApplication = vi.fn().mockImplementation(function (
      this: any,
    ) {
      this.loginPopup = mockLoginPopup;
      return this;
    });

    vi.stubGlobal('msal', {
      PublicClientApplication: mockPublicClientApplication,
    });

    import.meta.env.VITE_MICROSOFT_CLIENT_ID = 'mock-microsoft-client-id';
  });

  it('initializes MSAL client and triggers popup auth when Microsoft login is clicked', async () => {
    render(<SignInPage />);

    const microsoftButton = screen.getByRole('button', { name: /microsoft/i });
    expect(microsoftButton).toBeDefined();

    fireEvent.click(microsoftButton);

    await waitFor(() => {
      expect(mockPublicClientApplication).toHaveBeenCalledWith({
        auth: {
          clientId: 'mock-microsoft-client-id',
          authority: 'https://login.microsoftonline.com/consumers',
          redirectUri: expect.any(String),
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        },
      });
    });

    expect(mockLoginPopup).toHaveBeenCalledWith({
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      nonce: expect.any(String),
    });
  });
});
