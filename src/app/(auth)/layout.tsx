export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4 overflow-hidden">
      <div className="relative w-full max-w-md z-10 space-y-6">
        {/* Logo / Brand */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg bg-primary text-primary-foreground mb-4 shadow-sm ring-1 ring-border">
            <svg
              className="w-7 h-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-heading font-extrabold  text-foreground">
            {process.env.NEXT_PUBLIC_APP_NAME ?? 'MOT Business AI'}
          </h1>
          <p className="text-xs text-muted-foreground mt-1 uppercase font-semibold">
            Secure Admin Portal
          </p>
        </div>

        {children}
      </div>
    </div>
  );
}
