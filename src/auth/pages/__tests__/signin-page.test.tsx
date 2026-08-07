/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../../../test/test-utils';
import { supabase } from '@/lib/supabase';
import { SignInPage } from '../signin-page';

vi.mock('@/lib/supabase', () => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    user_metadata: {},
  };

  const mockSession = {
    user: mockUser,
    access_token: 'fake-token',
  };

  return {
    supabase: {
      auth: {
        getSession: vi
          .fn()
          .mockResolvedValue({ data: { session: mockSession }, error: null }),
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: mockUser }, error: null }),
        signInWithIdToken: vi
          .fn()
          .mockResolvedValue({ data: { session: mockSession }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      storage: {
        from: vi.fn().mockReturnThis(),
        upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
        remove: vi.fn().mockResolvedValue({ data: {}, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({
          data: { publicUrl: 'http://example.com/pic.png' },
        }),
      },
    },
  };
});

describe('SignInPage - OIDC Login Integration Tests', () => {
  let mockLoginPopup: any;
  let mockPublicClientApplication: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock window.crypto.subtle.digest for secure nonce pairing
    Object.defineProperty(window, 'crypto', {
      value: {
        getRandomValues: (arr: Uint8Array) => arr.fill(1),
        subtle: {
          digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
        },
      },
      writable: true,
      configurable: true,
    });

    // Mock window.msal
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

    (window as any).msal = {
      PublicClientApplication: mockPublicClientApplication,
    };

    // Configure spy on Supabase auth
    vi.spyOn(supabase.auth, 'signInWithIdToken').mockResolvedValue({
      data: {
        session: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
        },
      },
      error: null,
    } as any);

    // Define environment variables
    import.meta.env.VITE_MICROSOFT_CLIENT_ID = 'mock-microsoft-client-id';
  });

  it('initializes MSAL client with consumers authority when Microsoft login is triggered', async () => {
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

  it('exchanges ID token with Supabase using the raw nonce', async () => {
    render(<SignInPage />);

    const microsoftButton = screen.getByRole('button', { name: /microsoft/i });
    fireEvent.click(microsoftButton);

    // wait for MSAL popup to be invoked (ensures the async login flow has started/completed)
    await waitFor(() => {
      expect(mockLoginPopup).toHaveBeenCalled();
    });

    // now assert the Supabase exchange is performed with the expected raw nonce
    await waitFor(() => {
      expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: 'azure',
        token: 'mock-id-token',
        nonce: '01010101010101010101010101010101', // random values mocked with 1s
      });
    });
  });
});

