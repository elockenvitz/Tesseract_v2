import { useNavigate } from 'react-router-dom'
import { SetupWizard } from '../components/onboarding/SetupWizard'

export function SetupWizardPage() {
  const navigate = useNavigate()

  const handleComplete = () => {
    console.log('SetupWizardPage handleComplete called, navigating to /dashboard')
    navigate('/dashboard')
  }

  const handleSkip = () => {
    console.log('SetupWizardPage handleSkip called, navigating to /dashboard')
    navigate('/dashboard')
  }

  return (
    <SetupWizard
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  )
}
