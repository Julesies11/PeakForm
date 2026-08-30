/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/auth/context/auth-context';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  Eye,
  EyeOff,
  LoaderCircleIcon,
  Lock,
  Mail,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { toAbsoluteUrl } from '@/lib/helpers';
import { supabase } from '@/lib/supabase';
import { Alert, AlertDescription, AlertIcon } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/common/icons';
import { getSigninSchema, SigninSchemaType } from '../forms/signin-schema';

declare global {
  interface Window {
    google?: any;
    msal?: any;
  }
}

let isGoogleInitialized = false;

export function SignInPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login, auth, saveAuth } = useAuth();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (auth?.access_token) {
      const nextPath = searchParams.get('next') || '/dashboard';
      navigate(nextPath, { replace: true });
    }
  }, [auth, navigate, searchParams]);

  // Check for success message from password reset or error messages
  useEffect(() => {
    const pwdReset = searchParams.get('pwd_reset');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (pwdReset === 'success') {
      setSuccessMessage(
        'Your password has been successfully reset. You can now sign in with your new password.',
      );
    }

    if (errorParam) {
      switch (errorParam) {
        case 'auth_callback_failed':
          setError(
            errorDescription || 'Authentication failed. Please try again.',
          );
          break;
        case 'auth_callback_error':
          setError(
            errorDescription ||
              'An error occurred during authentication. Please try again.',
          );
          break;
        case 'auth_token_error':
          setError(
            errorDescription ||
              'Failed to set authentication session. Please try again.',
          );
          break;
        default:
          setError(
            errorDescription || 'Authentication error. Please try again.',
          );
          break;
      }
    }
  }, [searchParams]);

  const form = useForm<SigninSchemaType>({
    resolver: zodResolver(getSigninSchema()),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: true,
    },
  });

  const onInvalid = (errors: any) => {
    const firstError = Object.values(errors)[0] as any;
    if (firstError?.message) {
      toast.error(firstError.message);
    } else {
      toast.error('Please correct the errors in the form.');
    }
  };

  async function onSubmit(values: SigninSchemaType) {
    try {
      setIsProcessing(true);
      setError(null);

      console.log('Attempting to sign in with email:', values.email);

      // Simple validation
      if (!values.email.trim() || !values.password) {
        const msg = 'Email and password are required';
        setError(msg);
        toast.error(msg);
        return;
      }

      // Sign in using the auth context
      await login(values.email, values.password);
      toast.success('Signed in successfully!');
    } catch (err) {
      console.error('Unexpected sign-in error:', err);
      const errMsg =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsProcessing(false);
    }
  }

  // Handle Google OIDC ID Token credential response
  const handleGoogleCredentialResponse = useCallback(
    async (response: any) => {
      try {
        setIsGoogleLoading(true);
        setError(null);

        const idToken = response.credential;
        if (!idToken) {
          throw new Error('No credential returned from Google');
        }

        console.log(
          'Received ID token from Google OIDC, signing in to Supabase...',
        );
        const { data, error: signInError } =
          await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
          });

        console.log('signInWithIdToken response:', { data, signInError });

        if (signInError) throw signInError;

        // Manually sync session and profile details to trigger the state update
        if (data.session) {
          await saveAuth({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
        }

        toast.success('Signed in successfully!');
      } catch (err) {
        console.error('Google sign-in error:', err);
        setError(err instanceof Error ? err.message : 'Google sign-in failed');
        toast.error(
          err instanceof Error ? err.message : 'Google sign-in failed',
        );
      } finally {
        setIsGoogleLoading(false);
      }
    },
    [saveAuth],
  );

  useEffect(() => {
    let checkInterval: ReturnType<typeof setInterval>;

    const initGoogleGSI = () => {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) {
        console.warn('VITE_GOOGLE_CLIENT_ID is not configured');
        return false;
      }

      if (window.google?.accounts?.id) {
        if (!isGoogleInitialized) {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: handleGoogleCredentialResponse,
          });
          isGoogleInitialized = true;
        }

        const btnEl = document.getElementById('google-signin-button');
        if (btnEl) {
          window.google.accounts.id.renderButton(btnEl, {
            theme: document.documentElement.classList.contains('dark')
              ? 'filled_black'
              : 'outline',
            size: 'large',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left',
            width: btnEl.parentElement?.clientWidth || 180,
          });
        }
        return true;
      }
      return false;
    };

    const success = initGoogleGSI();
    if (!success) {
      let elapsed = 0;
      checkInterval = setInterval(() => {
        elapsed += 100;
        if (initGoogleGSI() || elapsed >= 5000) {
          clearInterval(checkInterval);
        }
      }, 100);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, [handleGoogleCredentialResponse]);

  // Helper to generate a raw random nonce and its SHA-256 hex hash for OIDC verification
  const generateNoncePair = async () => {
    const cryptoObj =
      typeof window !== 'undefined' && window.crypto
        ? window.crypto
        : globalThis.crypto;

    if (!cryptoObj?.getRandomValues) {
      throw new Error(
        'Cryptographically secure random number generator (crypto.getRandomValues) is required for secure authentication.',
      );
    }

    const rawBytes = new Uint8Array(16);
    cryptoObj.getRandomValues(rawBytes);

    const raw = Array.from(rawBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (!cryptoObj.subtle?.digest) {
      throw new Error(
        'SubtleCrypto SHA-256 digest is required for OIDC nonce hashing.',
      );
    }

    const msgBuffer = new TextEncoder().encode(raw);
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashed = hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return { raw, hashed };
  };

  // Handle Microsoft Sign In with MSAL.js OIDC
  const handleMicrosoftSignIn = async () => {
    try {
      setIsMicrosoftLoading(true);
      setError(null);

      const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
      if (!clientId || clientId === 'your-microsoft-client-id-here') {
        throw new Error(
          'Microsoft Client ID is not configured. Please add it to your environment variables.',
        );
      }

      if (!window.msal) {
        throw new Error(
          'Microsoft Authentication Library (MSAL.js) failed to load. Please refresh and try again.',
        );
      }

      const msalConfig = {
        auth: {
          clientId: clientId,
          authority: 'https://login.microsoftonline.com/consumers',
          redirectUri: window.location.origin,
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        },
      };

      console.log('Initializing client-side MSAL instance...');
      const msalInstance = new window.msal.PublicClientApplication(msalConfig);

      console.log('Generating secure OIDC nonce pair...');
      const { raw: rawNonce, hashed: hashedNonce } = await generateNoncePair();

      const loginRequest = {
        scopes: ['openid', 'profile', 'email', 'User.Read'],
        nonce: hashedNonce,
      };

      console.log('Initiating Microsoft popup auth...');
      const loginResponse = await msalInstance.loginPopup(loginRequest);
      const idToken = loginResponse.idToken;

      if (!idToken) {
        throw new Error('No identity token returned from Microsoft.');
      }

      console.log('Exchanging Microsoft OIDC token with Supabase...');
      const { data, error: signInError } =
        await supabase.auth.signInWithIdToken({
          provider: 'azure',
          token: idToken,
          nonce: rawNonce,
        });

      if (signInError) throw signInError;

      // Manually sync session and profile details to trigger the state update
      if (data.session) {
        await saveAuth({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }

      toast.success('Signed in successfully with Microsoft!');
    } catch (err) {
      console.error('Microsoft sign-in error:', err);
      const errMsg =
        err instanceof Error ? err.message : 'Microsoft sign-in failed.';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsMicrosoftLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await form.handleSubmit(onSubmit, onInvalid)(e);
          } catch (err) {
            console.error('Sign In form resolver error:', err);
            const errMsg =
              err instanceof Error
                ? err.message
                : 'An unexpected validation error occurred. Please try again.';
            setError(errMsg);
            toast.error(errMsg);
          }
        }}
        className="block w-full space-y-4"
      >
        <div className="text-center space-y-1 pb-3">
          <img
            src={toAbsoluteUrl('/media/app/default-logo.svg')}
            className="h-[48px] mx-auto mb-4 dark:hidden"
            alt="Logo"
          />
          <img
            src={toAbsoluteUrl('/media/app/default-logo-dark.svg')}
            className="h-[48px] mx-auto mb-4 hidden dark:block"
            alt="Logo"
          />
          <h1
            className="text-2xl font-black tracking-tight text-black dark:text-white"
            aria-label="sign in"
          >
            Welcome to Training<span className="text-success">Flow</span>
          </h1>
          <p className="sr-only">Welcome back to trainingflow.</p>
        </div>

        {error && (
          <Alert
            variant="destructive"
            appearance="light"
            className="mb-4 animate-fade-in"
          >
            <AlertIcon>
              <AlertCircle className="w-4.5 h-4.5" />
            </AlertIcon>
            <AlertDescription className="font-semibold text-sm">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {successMessage && (
          <div className="mb-4 p-4 rounded-xl bg-green-500/10 text-green-600 text-sm border border-green-500/20 text-center">
            {successMessage}
          </div>
        )}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-2sm font-semibold tracking-wide">
                Email
              </FormLabel>
              <div className="relative">
                <span className="absolute left-3.5 top-3 text-muted-foreground pointer-events-none">
                  <Mail className="w-4.5 h-4.5" />
                </span>
                <FormControl>
                  <Input
                    placeholder="your.email@example.com"
                    type="email"
                    autoComplete="username"
                    className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                    {...field}
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <div className="flex justify-between items-center gap-2.5">
                <FormLabel className="text-2sm font-semibold tracking-wide">
                  Password
                </FormLabel>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-3 text-muted-foreground pointer-events-none">
                  <Lock className="w-4.5 h-4.5" />
                </span>
                <FormControl>
                  <Input
                    placeholder="••••••••"
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="w-full pl-11 pr-11 py-2.5 rounded-xl border border-border bg-input text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                    {...field}
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="ghost"
                  mode="icon"
                  onClick={() => setPasswordVisible(!passwordVisible)}
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent cursor-pointer"
                >
                  {passwordVisible ? (
                    <EyeOff className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="rememberMe"
          render={({ field }) => (
            <FormItem className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-normal cursor-pointer select-none">
                    Remember me
                  </FormLabel>
                </div>
                <Link
                  to="/auth/reset-password"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Forgot Password?
                </Link>
              </div>
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="w-full py-2.5 mt-2 rounded-xl bg-primary text-primary-foreground font-bold shadow-md shadow-primary/20 hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer animate-fade-in"
          disabled={isProcessing}
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <LoaderCircleIcon className="h-4 w-4 animate-spin" /> Signing
              In...
            </span>
          ) : (
            'Sign In'
          )}
        </Button>

        <div className="relative flex py-2 items-center text-xs uppercase text-muted-foreground">
          <div className="flex-grow border-t border-border/30"></div>
          <span className="flex-shrink mx-3">Or continue with</span>
          <div className="flex-grow border-t border-border/30"></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative w-full h-[40px] flex items-center justify-center">
            {isGoogleLoading && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-xl">
                <LoaderCircleIcon className="size-4 animate-spin text-primary" />
              </div>
            )}
            <div
              id="google-signin-button"
              className="w-full flex justify-center"
            >
              <span className="sr-only">Google</span>
            </div>
          </div>
          <Button
            variant="outline"
            type="button"
            onClick={handleMicrosoftSignIn}
            disabled={isGoogleLoading || isMicrosoftLoading}
            className="w-full py-2.5 rounded-xl border border-border bg-input hover:bg-border/20 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 select-none"
          >
            {isMicrosoftLoading ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <>
                <Icons.microsoft className="size-4.5!" /> Microsoft
              </>
            )}
          </Button>
        </div>

        <div className="text-center text-sm text-muted-foreground pt-2">
          Don't have an account?{' '}
          <Link
            to="/auth/signup"
            className="font-semibold text-primary hover:underline"
          >
            Sign Up
          </Link>
        </div>
      </form>
    </Form>
  );
}
