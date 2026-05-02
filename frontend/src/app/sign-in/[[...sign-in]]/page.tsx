import { SignIn } from '@clerk/nextjs'
import { AuthShell } from '@/components/auth/AuthShell'

export default function SignInPage() {
  return (
    <AuthShell
      kicker="Welcome back"
      title="Continue protecting every payment decision."
      description="Sign in to access your quote history, negotiation scripts, and saved outcomes."
      panelTitle="Why users sign in"
      bullets={[
        'Track savings and overcharge patterns over time',
        'Reopen verdicts instantly from the history vault',
        'Follow negotiation outcomes and evidence trails',
      ]}
      backLabel="Back to landing"
      backHref="/"
    >
      <SignIn />
    </AuthShell>
  )
}
