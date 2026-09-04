import { useEffect, useRef } from "react";

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsApi {
  id: {
    initialize(options: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
      auto_select?: boolean;
      cancel_on_tap_outside?: boolean;
      use_fedcm_for_prompt?: boolean;
    }): void;
    renderButton(element: HTMLElement, options: Record<string, string | number | boolean>): void;
    prompt(): void;
    cancel(): void;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccountsApi };
  }
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-systolab-google-identity="true"]');
    const script = existing ?? document.createElement("script");
    const onLoad = () => resolve();
    const onError = () => {
      googleScriptPromise = null;
      reject(new Error("Google sign-in could not be loaded. Check your connection and try again."));
    };

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.systolabGoogleIdentity = "true";
      document.head.appendChild(script);
    }
  });
  return googleScriptPromise;
}

export function GoogleSignInButton({
  clientId,
  mode,
  onCredential,
  onError
}: {
  clientId: string;
  mode: "login" | "signup";
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const credentialHandlerRef = useRef(onCredential);
  const errorHandlerRef = useRef(onError);

  useEffect(() => {
    credentialHandlerRef.current = onCredential;
    errorHandlerRef.current = onError;
  }, [onCredential, onError]);

  useEffect(() => {
    let active = true;
    void loadGoogleIdentityScript()
      .then(() => {
        if (!active || !containerRef.current || !window.google?.accounts.id) return;
        const identity = window.google.accounts.id;
        identity.initialize({
          client_id: clientId,
          callback: (response) => {
            if (!response.credential) {
              errorHandlerRef.current("Google did not return a sign-in credential. Please try again.");
              return;
            }
            credentialHandlerRef.current(response.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true
        });
        containerRef.current.replaceChildren();
        identity.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: mode === "signup" ? "signup_with" : "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: Math.max(240, Math.min(400, Math.floor(containerRef.current.getBoundingClientRect().width || 360)))
        });
        if (mode === "login") identity.prompt();
      })
      .catch((error) => {
        if (active) errorHandlerRef.current(error instanceof Error ? error.message : "Google sign-in could not be loaded.");
      });

    return () => {
      active = false;
      window.google?.accounts.id.cancel();
    };
  }, [clientId, mode]);

  return <div className="portal-google-identity" ref={containerRef} aria-label="Continue with Google" />;
}
