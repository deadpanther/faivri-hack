import { SignUp } from '@clerk/nextjs'
import { AuthShell } from '@/components/auth/AuthShell'

export default function SignUpPage() {
  return (
    <AuthShell
      kicker="Create your Faivri account"
      title="Turn one quote check into a complete protection workflow."
      description="Build your savings trail with history, community context, and guided negotiations."
      panelTitle="Included from day one"
      bullets={[
        'Structured quote analysis with confidence signals',
        'Negotiation scripts ranked by likely savings impact',
        'Personal history vault and progress insights',
      ]}
      backLabel="Back to landing"
      backHref="/"
    >
      <SignUp />
    </AuthShell>
  )
}
