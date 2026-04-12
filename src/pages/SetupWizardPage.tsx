import { useNavigate } from 'react-router-dom'
import { SetupWizard } from '../components/onboarding/SetupWizard'

export function SetupWizardPage() {
  const navigate = useNavigate()

  const handleComplete = () => {
    navigate('/dashboard')
  }

  const handleSkip = () => {
    navigate('/dashboard')
  }

  return (
    <SetupWizard
      onComplete={handleComplete}
      onSkip={handleSkip}
    />
  )
}
