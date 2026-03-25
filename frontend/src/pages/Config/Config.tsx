import { useLocation } from 'react-router-dom'
import GuardrailsManagement from './GuardrailsManagement'
import SensitivityThresholdManagement from './SensitivityThresholdManagement'
import DataSecurity from '../DataSecurity'
import KeywordListManagement from './KeywordListManagement'
import AnswerManagement from './AnswerManagement'

const Config: React.FC = () => {
  const location = useLocation()

  const renderContent = () => {
    const path = location.pathname

    if (path === '/config' || path === '/config/' || path.includes('/guardrails')) {
      return <GuardrailsManagement />
    }
    if (path.includes('/sensitivity-thresholds')) {
      return <SensitivityThresholdManagement />
    }
    if (path.includes('/data-masking') || path.includes('/data-security')) {
      return <DataSecurity />
    }
    if (path.includes('/keyword-list') || path.includes('/blacklist') || path.includes('/whitelist')) {
      return <KeywordListManagement />
    }
    // Unified answer management page (combines response templates and knowledge bases)
    if (path.includes('/answers') || path.includes('/responses') || path.includes('/response-templates') || path.includes('/knowledge-bases')) {
      return <AnswerManagement />
    }

    return <GuardrailsManagement />
  }

  return (
    <div className="space-y-6">
      {renderContent()}
    </div>
  )
}

export default Config
