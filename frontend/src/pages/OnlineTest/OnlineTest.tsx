import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import { Send, Trash2, Upload, Download, FileSpreadsheet, Loader2, Globe, FolderOpen, AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import * as XLSX from 'xlsx'
import { cn } from '../../lib/utils'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  detection?: GuardrailResult
  isDetecting?: boolean
}

interface GuardrailResult {
  compliance: {
    risk_level: string
    categories: string[]
  }
  security: {
    risk_level: string
    categories: string[]
  }
  data?: {
    risk_level: string
    categories: string[]
  }
  overall_risk_level: string
  suggest_action: string
  suggest_answer: string
  error?: string
}

// Batch test interfaces
interface ReplayMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ExcelRow {
  detection_content: string
  messages: ReplayMessage[]
  originalRow: Record<string, any>
}

interface BatchTestResult {
  detection_content: string
  compliance_risk_level: string
  compliance_categories: string
  security_risk_level: string
  security_categories: string
  data_risk_level: string
  data_categories: string
  overall_risk_level: string
  suggest_action: string
  suggest_answer: string
}

type BatchTestStatus = 'idle' | 'uploaded' | 'detecting' | 'completed' | 'error'

interface WorkspaceOption {
  id: string
  name: string
}

interface PresetTestCase {
  id: string
  label: string
  content: string
  category: 'security' | 'data' | 'compliance'
}

const OnlineTest: React.FC = () => {
  const { t } = useTranslation()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const translateRiskLevel = (riskLevel: string) => {
    const riskLevelMap: { [key: string]: string } = {
      high_risk: t('risk.level.high_risk'),
      medium_risk: t('risk.level.medium_risk'),
      low_risk: t('risk.level.low_risk'),
      no_risk: t('risk.level.no_risk'),
    }
    return riskLevelMap[riskLevel] || riskLevel
  }

  // Chat states
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isDetecting, setIsDetecting] = useState(false)

  // Workspace selector states
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('global')

  // Batch test states
  const [batchStatus, setBatchStatus] = useState<BatchTestStatus>('idle')
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [batchData, setBatchData] = useState<ExcelRow[]>([])
  const [batchResults, setBatchResults] = useState<BatchTestResult[]>([])
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preset test cases
  const presetTestCases: PresetTestCase[] = [
    {
      id: 'prompt-injection',
      label: t('onlineTest.chat.presets.promptInjection'),
      content: t('onlineTest.testCases.promptAttackContent'),
      category: 'security'
    },
    {
      id: 'violent-crime',
      label: t('onlineTest.chat.presets.violentCrime'),
      content: t('onlineTest.testCases.violentCrimeContent'),
      category: 'security'
    },
    {
      id: 'pornographic',
      label: t('onlineTest.chat.presets.pornographic'),
      content: t('onlineTest.testCases.pornographicContent'),
      category: 'compliance'
    },
    {
      id: 'discrimination',
      label: t('onlineTest.chat.presets.discrimination'),
      content: t('onlineTest.testCases.discriminatoryContent'),
      category: 'compliance'
    },
    {
      id: 'safe',
      label: t('onlineTest.chat.presets.safe'),
      content: t('onlineTest.chat.presets.safeContent'),
      category: 'security'
    }
  ]

  const loadWorkspaces = useCallback(async () => {
    try {
      const response = await api.get('/api/v1/workspaces')
      setWorkspaces(response.data.filter((ws: any) => !ws.is_global).map((ws: any) => ({ id: ws.id, name: ws.name })))
    } catch (error) {
      console.error('Failed to load workspaces:', error)
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const generateId = () => Math.random().toString(36).substring(2, 15)

  const sendMessage = async () => {
    const content = inputValue.trim()
    if (!content || isDetecting) return

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
      isDetecting: true
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInputValue('')
    setIsDetecting(true)

    try {
      // Build messages array for API (all messages in conversation)
      const apiMessages = newMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))

      const requestData: any = {
        messages: apiMessages,
        generate_response: true  // Request model to generate response
      }
      if (selectedWorkspaceId !== 'global') {
        requestData.workspace_id = selectedWorkspaceId
      }

      const response = await api.post('/api/v1/test/online', requestData)
      const guardrailResult = response.data.guardrail
      const modelResponse = response.data.model_response

      // Update user message with detection result
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id
          ? { ...msg, detection: guardrailResult, isDetecting: false }
          : msg
      ))

      // Add model response as assistant message
      if (modelResponse) {
        if (modelResponse.content) {
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: modelResponse.content,
            timestamp: new Date()
          }
          setMessages(prev => [...prev, assistantMessage])
        } else if (modelResponse.error) {
          // Show error as assistant message
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: `⚠️ ${modelResponse.error}`,
            timestamp: new Date()
          }
          setMessages(prev => [...prev, assistantMessage])
        }
      }

    } catch (error: any) {
      console.error('Detection failed:', error)
      const errorMessage = error?.response?.data?.detail || error?.message || t('onlineTest.testExecutionFailed')

      // Update user message with error
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id
          ? {
              ...msg,
              detection: {
                compliance: { risk_level: 'error', categories: [] },
                security: { risk_level: 'error', categories: [] },
                overall_risk_level: 'error',
                suggest_action: 'error',
                suggest_answer: '',
                error: errorMessage
              },
              isDetecting: false
            }
          : msg
      ))

      toast.error(errorMessage)
    } finally {
      setIsDetecting(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const clearConversation = () => {
    setMessages([])
    toast.success(t('onlineTest.chat.conversationCleared'))
  }

  const usePresetCase = (preset: PresetTestCase) => {
    setInputValue(preset.content)
    inputRef.current?.focus()
  }

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high_risk':
        return 'text-red-400'
      case 'medium_risk':
        return 'text-orange-400'
      case 'low_risk':
        return 'text-yellow-400'
      case 'no_risk':
      case 'safe':
        return 'text-emerald-400'
      default:
        return 'text-muted-foreground'
    }
  }

  const getRiskBgColor = (level: string) => {
    switch (level) {
      case 'high_risk':
        return 'bg-red-500/10 border-red-500/20'
      case 'medium_risk':
        return 'bg-orange-500/10 border-orange-500/20'
      case 'low_risk':
        return 'bg-yellow-500/10 border-yellow-500/20'
      case 'no_risk':
      case 'safe':
        return 'bg-emerald-500/10 border-emerald-500/20'
      default:
        return 'bg-muted border-border'
    }
  }

  const getRiskIcon = (level: string) => {
    switch (level) {
      case 'high_risk':
      case 'medium_risk':
        return <ShieldAlert className="h-4 w-4" />
      case 'low_risk':
        return <AlertTriangle className="h-4 w-4" />
      case 'no_risk':
      case 'safe':
        return <ShieldCheck className="h-4 w-4" />
      default:
        return <ShieldCheck className="h-4 w-4" />
    }
  }

  // Detection result badge component
  const DetectionBadge: React.FC<{ detection: GuardrailResult }> = ({ detection }) => {
    const [expanded, setExpanded] = useState(false)
    const riskLevel = detection.overall_risk_level

    if (detection.error) {
      return (
        <div className="mt-2 p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          {detection.error}
        </div>
      )
    }

    return (
      <div className={cn("mt-2 rounded-md border text-xs", getRiskBgColor(riskLevel))}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 rounded-md transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className={getRiskColor(riskLevel)}>{getRiskIcon(riskLevel)}</span>
            <span className={cn("font-medium", getRiskColor(riskLevel))}>
              {translateRiskLevel(riskLevel)}
            </span>
            {detection.suggest_action !== 'pass' && (
              <span className="text-muted-foreground">• {detection.suggest_action}</span>
            )}
          </div>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-muted-foreground">{t('onlineTest.securityRisk')}:</span>
                <span className={cn("ml-1", getRiskColor(detection.security?.risk_level))}>
                  {translateRiskLevel(detection.security?.risk_level || 'no_risk')}
                </span>
                {detection.security?.categories?.length > 0 && (
                  <div className="text-muted-foreground mt-0.5">
                    {detection.security.categories.join(', ')}
                  </div>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t('onlineTest.complianceRisk')}:</span>
                <span className={cn("ml-1", getRiskColor(detection.compliance?.risk_level))}>
                  {translateRiskLevel(detection.compliance?.risk_level || 'no_risk')}
                </span>
                {detection.compliance?.categories?.length > 0 && (
                  <div className="text-muted-foreground mt-0.5">
                    {detection.compliance.categories.join(', ')}
                  </div>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t('onlineTest.dataLeak')}:</span>
                <span className={cn("ml-1", getRiskColor(detection.data?.risk_level || 'no_risk'))}>
                  {translateRiskLevel(detection.data?.risk_level || 'no_risk')}
                </span>
                {detection.data?.categories && detection.data.categories.length > 0 && (
                  <div className="text-muted-foreground mt-0.5">
                    {detection.data.categories.join(', ')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Parse detection content format: [User]: ...\n[Assistant]: ...
  const parseDetectionContent = (content: string): ReplayMessage[] => {
    const msgList: ReplayMessage[] = []
    const lines = content.split('\n')
    let currentRole: 'user' | 'assistant' | null = null
    let currentContent = ''

    for (const line of lines) {
      const userMatch = line.match(/^\[User\]:\s*(.*)/)
      const assistantMatch = line.match(/^\[Assistant\]:\s*(.*)/)

      if (userMatch) {
        if (currentRole && currentContent.trim()) {
          msgList.push({ role: currentRole, content: currentContent.trim() })
        }
        currentRole = 'user'
        currentContent = userMatch[1]
      } else if (assistantMatch) {
        if (currentRole && currentContent.trim()) {
          msgList.push({ role: currentRole, content: currentContent.trim() })
        }
        currentRole = 'assistant'
        currentContent = assistantMatch[1]
      } else if (currentRole) {
        currentContent += '\n' + line
      }
    }

    if (currentRole && currentContent.trim()) {
      msgList.push({ role: currentRole, content: currentContent.trim() })
    }

    return msgList
  }

  // Batch test functions
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setBatchFile(file)
    setBatchStatus('idle')
    setBatchResults([])

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const workbook = XLSX.read(data, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const sheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })

        if (jsonData.length === 0) {
          toast.error(t('onlineTest.batchTest.emptyFile'))
          setBatchFile(null)
          return
        }

        const firstRow = jsonData[0]
        const keys = Object.keys(firstRow)
        const detectionContentKey = keys.find(k =>
          k === 'Detection Content' || k === '检测内容'
        )

        if (!detectionContentKey) {
          toast.error(t('onlineTest.batchTest.missingColumns'))
          setBatchFile(null)
          return
        }

        const mappedData: ExcelRow[] = jsonData
          .map((row: any) => {
            const rawContent = String(row[detectionContentKey] || '').trim()
            if (!rawContent) return null

            const parsedMessages = parseDetectionContent(rawContent)
            if (parsedMessages.length === 0) {
              return {
                detection_content: rawContent,
                messages: [{ role: 'user' as const, content: rawContent }],
                originalRow: { ...row }
              }
            }
            return {
              detection_content: rawContent,
              messages: parsedMessages,
              originalRow: { ...row }
            }
          })
          .filter((row): row is ExcelRow => row !== null)

        if (mappedData.length === 0) {
          toast.error(t('onlineTest.batchTest.emptyFile'))
          setBatchFile(null)
          return
        }

        setBatchData(mappedData)
        setBatchStatus('uploaded')
        toast.success(t('onlineTest.batchTest.fileInfo', { name: file.name, rows: mappedData.length }))
      } catch (error) {
        console.error('Failed to parse Excel:', error)
        toast.error(t('onlineTest.batchTest.parseError'))
        setBatchFile(null)
      }
    }
    reader.readAsBinaryString(file)
  }

  const runBatchDetection = async () => {
    if (batchData.length === 0) return

    setBatchStatus('detecting')
    setBatchProgress({ current: 0, total: batchData.length })
    setBatchResults([])

    const results: BatchTestResult[] = []

    for (let i = 0; i < batchData.length; i++) {
      const row = batchData[i]
      try {
        const batchRequestData: any = {
          messages: row.messages,
        }
        if (selectedWorkspaceId !== 'global') {
          batchRequestData.workspace_id = selectedWorkspaceId
        }

        const response = await api.post('/api/v1/test/online', batchRequestData)

        const guardrail = response.data.guardrail
        results.push({
          detection_content: row.detection_content,
          compliance_risk_level: guardrail.compliance?.risk_level || 'no_risk',
          compliance_categories: (guardrail.compliance?.categories || []).join(', '),
          security_risk_level: guardrail.security?.risk_level || 'no_risk',
          security_categories: (guardrail.security?.categories || []).join(', '),
          data_risk_level: guardrail.data?.risk_level || 'no_risk',
          data_categories: (guardrail.data?.categories || []).join(', '),
          overall_risk_level: guardrail.overall_risk_level || 'no_risk',
          suggest_action: guardrail.suggest_action || 'pass',
          suggest_answer: guardrail.suggest_answer || '',
        })
      } catch (error: any) {
        console.error(`Detection failed for row ${i + 1}:`, error)
        results.push({
          detection_content: row.detection_content,
          compliance_risk_level: 'error',
          compliance_categories: '',
          security_risk_level: 'error',
          security_categories: '',
          data_risk_level: 'error',
          data_categories: '',
          overall_risk_level: 'error',
          suggest_action: 'error',
          suggest_answer: error?.response?.data?.detail || error?.message || 'Detection failed',
        })
      }

      setBatchProgress({ current: i + 1, total: batchData.length })
    }

    setBatchResults(results)
    setBatchStatus('completed')
    toast.success(t('onlineTest.batchTest.status.completed'))
  }

  const findDifferences = (original: ExcelRow[], replay: BatchTestResult[]) => {
    const differences: any[] = []

    for (let i = 0; i < original.length && i < replay.length; i++) {
      const orig = original[i].originalRow || {}
      const repl = replay[i]

      const origRequestId = orig['Request ID'] || orig['请求ID'] || ''
      const origApplication = orig['Application'] || orig['应用'] || ''
      const origWorkspace = orig['Workspace'] || orig['工作区'] || ''
      const origPromptAttackRisk = orig['Prompt Attack Risk'] || orig['提示词攻击风险'] || orig['安全风险'] || 'no_risk'
      const origPromptAttackCategories = orig['Prompt Attack Categories'] || orig['提示词攻击类别'] || orig['安全类别'] || ''
      const origContentComplianceRisk = orig['Content Compliance Risk'] || orig['内容合规风险'] || orig['合规风险'] || 'no_risk'
      const origContentComplianceCategories = orig['Content Compliance Categories'] || orig['内容合规类别'] || orig['合规类别'] || ''
      const origDataLeakRisk = orig['Data Leak Risk'] || orig['数据泄漏风险'] || orig['数据风险'] || 'no_risk'
      const origDataLeakCategories = orig['Data Leak Categories'] || orig['数据泄漏类别'] || orig['数据类别'] || ''
      const origSuggestedAction = orig['Suggested Action'] || orig['建议操作'] || 'pass'

      const isDifferent =
        origPromptAttackRisk !== repl.security_risk_level ||
        origPromptAttackCategories !== repl.security_categories ||
        origContentComplianceRisk !== repl.compliance_risk_level ||
        origContentComplianceCategories !== repl.compliance_categories ||
        origDataLeakRisk !== repl.data_risk_level ||
        origDataLeakCategories !== repl.data_categories ||
        origSuggestedAction !== repl.suggest_action

      if (isDifferent) {
        const truncatedContent = repl.detection_content.length > 32000
          ? repl.detection_content.slice(0, 32000) + '...(truncated)'
          : repl.detection_content
        differences.push({
          [t('onlineTest.batchTest.resultColumns.requestId') || 'Request ID']: origRequestId,
          [t('onlineTest.batchTest.resultColumns.application') || 'Application']: origApplication,
          [t('onlineTest.batchTest.resultColumns.workspace') || 'Workspace']: origWorkspace,
          [t('onlineTest.batchTest.resultColumns.detectionContent') || 'Detection Content']: truncatedContent,
          [t('onlineTest.batchTest.diffColumns.origPromptAttackRisk') || 'Original Prompt Attack Risk']: origPromptAttackRisk,
          [t('onlineTest.batchTest.diffColumns.replayPromptAttackRisk') || 'Replay Prompt Attack Risk']: repl.security_risk_level,
          [t('onlineTest.batchTest.diffColumns.origPromptAttackCategories') || 'Original Prompt Attack Categories']: origPromptAttackCategories,
          [t('onlineTest.batchTest.diffColumns.replayPromptAttackCategories') || 'Replay Prompt Attack Categories']: repl.security_categories,
          [t('onlineTest.batchTest.diffColumns.origContentComplianceRisk') || 'Original Content Compliance Risk']: origContentComplianceRisk,
          [t('onlineTest.batchTest.diffColumns.replayContentComplianceRisk') || 'Replay Content Compliance Risk']: repl.compliance_risk_level,
          [t('onlineTest.batchTest.diffColumns.origContentComplianceCategories') || 'Original Content Compliance Categories']: origContentComplianceCategories,
          [t('onlineTest.batchTest.diffColumns.replayContentComplianceCategories') || 'Replay Content Compliance Categories']: repl.compliance_categories,
          [t('onlineTest.batchTest.diffColumns.origDataLeakRisk') || 'Original Data Leak Risk']: origDataLeakRisk,
          [t('onlineTest.batchTest.diffColumns.replayDataLeakRisk') || 'Replay Data Leak Risk']: repl.data_risk_level,
          [t('onlineTest.batchTest.diffColumns.origDataLeakCategories') || 'Original Data Leak Categories']: origDataLeakCategories,
          [t('onlineTest.batchTest.diffColumns.replayDataLeakCategories') || 'Replay Data Leak Categories']: repl.data_categories,
          [t('onlineTest.batchTest.diffColumns.origSuggestedAction') || 'Original Suggested Action']: origSuggestedAction,
          [t('onlineTest.batchTest.diffColumns.replaySuggestedAction') || 'Replay Suggested Action']: repl.suggest_action,
        })
      }
    }

    return differences
  }

  const downloadResults = () => {
    if (batchResults.length === 0) return

    const EXCEL_MAX_CELL_LENGTH = 32000
    const truncateText = (text: any): string => {
      const str = String(text ?? '')
      if (str.length > EXCEL_MAX_CELL_LENGTH) {
        return str.slice(0, EXCEL_MAX_CELL_LENGTH) + '...(truncated)'
      }
      return str
    }

    const truncateRow = (row: Record<string, any>): Record<string, any> => {
      const result: Record<string, any> = {}
      for (const [key, value] of Object.entries(row)) {
        result[key] = typeof value === 'string' ? truncateText(value) : value
      }
      return result
    }

    try {
      const wb = XLSX.utils.book_new()

      const sheetNameOriginal = String(t('onlineTest.batchTest.sheets.original') || 'Original Data').slice(0, 31)
      const sheetNameReplay = String(t('onlineTest.batchTest.sheets.replay') || 'Replay Results').slice(0, 31)
      const sheetNameDiff = String(t('onlineTest.batchTest.sheets.differences') || 'Differences').slice(0, 31)

      const originalSheetData = batchData.map(row => truncateRow(row.originalRow || { 'Detection Content': row.detection_content }))
      const ws1 = XLSX.utils.json_to_sheet(originalSheetData)
      XLSX.utils.book_append_sheet(wb, ws1, sheetNameOriginal)

      const replayData = batchResults.map((result, index) => {
        const orig = batchData[index]?.originalRow || {}
        const origRequestId = orig['Request ID'] || orig['请求ID'] || ''
        const origApplication = orig['Application'] || orig['应用'] || ''
        const origWorkspace = orig['Workspace'] || orig['工作区'] || ''

        return {
          [t('onlineTest.batchTest.resultColumns.requestId') || 'Request ID']: origRequestId,
          [t('onlineTest.batchTest.resultColumns.application') || 'Application']: origApplication,
          [t('onlineTest.batchTest.resultColumns.workspace') || 'Workspace']: origWorkspace,
          [t('onlineTest.batchTest.resultColumns.detectionContent') || 'Detection Content']: truncateText(result.detection_content),
          [t('onlineTest.batchTest.resultColumns.promptAttackRisk') || 'Prompt Attack Risk']: result.security_risk_level,
          [t('onlineTest.batchTest.resultColumns.promptAttackCategories') || 'Prompt Attack Categories']: result.security_categories,
          [t('onlineTest.batchTest.resultColumns.contentComplianceRisk') || 'Content Compliance Risk']: result.compliance_risk_level,
          [t('onlineTest.batchTest.resultColumns.contentComplianceCategories') || 'Content Compliance Categories']: result.compliance_categories,
          [t('onlineTest.batchTest.resultColumns.dataLeakRisk') || 'Data Leak Risk']: result.data_risk_level,
          [t('onlineTest.batchTest.resultColumns.dataLeakCategories') || 'Data Leak Categories']: result.data_categories,
          [t('onlineTest.batchTest.resultColumns.suggestedAction') || 'Suggested Action']: result.suggest_action,
          [t('onlineTest.batchTest.resultColumns.suggestedAnswer') || 'Suggested Answer']: truncateText(result.suggest_answer),
        }
      })
      const ws2 = XLSX.utils.json_to_sheet(replayData)
      ws2['!cols'] = [
        { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 60 },
        { wch: 20 }, { wch: 30 }, { wch: 22 }, { wch: 30 },
        { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 50 },
      ]
      XLSX.utils.book_append_sheet(wb, ws2, sheetNameReplay)

      const differences = findDifferences(batchData, batchResults)
      if (differences.length > 0) {
        const ws3 = XLSX.utils.json_to_sheet(differences)
        ws3['!cols'] = [
          { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 50 },
          { wch: 22 }, { wch: 22 }, { wch: 25 }, { wch: 25 },
          { wch: 24 }, { wch: 24 }, { wch: 28 }, { wch: 28 },
          { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 22 },
          { wch: 20 }, { wch: 20 },
        ]
        XLSX.utils.book_append_sheet(wb, ws3, sheetNameDiff)
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const filename = `replay_comparison_${timestamp}.xlsx`

      XLSX.writeFile(wb, filename)
      toast.success(t('onlineTest.batchTest.downloadSuccess'))
    } catch (error: any) {
      console.error('Failed to download results:', error)
      toast.error(`${t('onlineTest.batchTest.downloadError')}: ${error?.message || error}`)
    }
  }

  const resetBatchTest = () => {
    setBatchStatus('idle')
    setBatchFile(null)
    setBatchData([])
    setBatchResults([])
    setBatchProgress({ current: 0, total: 0 })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const getStatusColor = (status: BatchTestStatus) => {
    switch (status) {
      case 'idle':
        return 'bg-muted text-foreground'
      case 'uploaded':
        return 'bg-sky-500/15 text-sky-300'
      case 'detecting':
        return 'bg-yellow-500/15 text-yellow-300'
      case 'completed':
        return 'bg-emerald-500/15 text-emerald-300'
      case 'error':
        return 'bg-red-500/15 text-red-300'
      default:
        return 'bg-muted text-foreground'
    }
  }

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('onlineTest.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('onlineTest.chat.description')}</p>
        </div>
        {workspaces.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('onlineTest.guardrailConfig')}:</span>
            <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5" />
                    <span>{t('onlineTest.globalConfig')}</span>
                  </div>
                </SelectItem>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>{ws.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mb-4 self-start">
          <TabsTrigger value="chat">{t('onlineTest.chat.tabChat')}</TabsTrigger>
          <TabsTrigger value="replay">{t('onlineTest.batchTest.tabBatch')}</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-0">
          {/* Chat messages area */}
          <Card className="flex-1 flex flex-col min-h-0">
            <CardContent className="flex-1 flex flex-col min-h-0 p-0">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                    <ShieldCheck className="h-12 w-12 mb-4 opacity-50" />
                    <p className="text-lg font-medium mb-2">{t('onlineTest.chat.emptyState')}</p>
                    <p className="text-sm text-center max-w-md">{t('onlineTest.chat.emptyStateDesc')}</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex",
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2",
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-secondary text-foreground'
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        {msg.role === 'user' && msg.isDetecting && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-blue-200">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('onlineTest.chat.detecting')}
                          </div>
                        )}
                        {msg.role === 'user' && msg.detection && !msg.isDetecting && (
                          <DetectionBadge detection={msg.detection} />
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Preset test cases */}
              <div className="px-4 py-2 border-t border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">{t('onlineTest.chat.quickTest')}:</span>
                  {presetTestCases.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => usePresetCase(preset)}
                      className="px-2 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input area */}
              <div className="p-4 border-t border-border">
                <div className="flex gap-2">
                  <Textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('onlineTest.chat.inputPlaceholder')}
                    className="flex-1 min-h-[60px] max-h-[120px] resize-none"
                    disabled={isDetecting}
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={sendMessage}
                      disabled={!inputValue.trim() || isDetecting}
                      className="bg-blue-600 hover:bg-blue-700 h-[60px]"
                    >
                      {isDetecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={clearConversation}
                      disabled={messages.length === 0 || isDetecting}
                      title={t('onlineTest.chat.newConversation')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t('onlineTest.chat.enterToSend')}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="replay" className="flex-1 mt-0">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  {t('onlineTest.batchTest.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t('onlineTest.batchTest.description')}</p>
                <p className="text-xs text-muted-foreground">{t('onlineTest.batchTest.formatRequirement')}</p>

                <div className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="excel-upload"
                  />

                  {batchStatus === 'idle' && !batchFile ? (
                    <label
                      htmlFor="excel-upload"
                      className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer bg-secondary hover:bg-card/5 transition-colors"
                    >
                      <Upload className="h-8 w-8 text-slate-500 mb-2" />
                      <span className="text-sm text-muted-foreground">{t('onlineTest.batchTest.uploadArea')}</span>
                      <span className="text-xs text-slate-500 mt-1">{t('onlineTest.batchTest.uploadHint')}</span>
                    </label>
                  ) : (
                    <div className="p-4 bg-secondary rounded-lg border border-border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet className="h-8 w-8 text-emerald-400" />
                          <div>
                            <p className="text-sm font-medium text-slate-300">{batchFile?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {batchData.length} {t('onlineTest.batchTest.rowCount')}
                            </p>
                          </div>
                        </div>
                        <span className={`px-3 py-1 text-xs font-medium rounded-full ${getStatusColor(batchStatus)}`}>
                          {t(`onlineTest.batchTest.status.${batchStatus}`)}
                        </span>
                      </div>

                      {batchStatus === 'detecting' && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                            <span>{t('onlineTest.batchTest.progress', { current: batchProgress.current, total: batchProgress.total })}</span>
                            <span>{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
                          </div>
                          <div className="w-full bg-border rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {batchStatus === 'uploaded' && (
                      <Button onClick={runBatchDetection} className="bg-blue-600 hover:bg-blue-700">
                        <Send className="h-4 w-4 mr-2" />
                        {t('onlineTest.batchTest.startDetection')}
                      </Button>
                    )}

                    {batchStatus === 'detecting' && (
                      <Button disabled className="bg-blue-600">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('onlineTest.batchTest.status.detecting')}
                      </Button>
                    )}

                    {batchStatus === 'completed' && (
                      <Button onClick={downloadResults} className="bg-green-600 hover:bg-green-700">
                        <Download className="h-4 w-4 mr-2" />
                        {t('onlineTest.batchTest.downloadResult')}
                      </Button>
                    )}

                    {(batchStatus === 'uploaded' || batchStatus === 'completed' || batchStatus === 'error') && (
                      <Button variant="outline" onClick={resetBatchTest}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('onlineTest.batchTest.reupload')}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {batchResults.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('onlineTest.testResult')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 font-medium text-slate-300">#</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-300">{t('onlineTest.batchTest.resultColumns.detectionContent')}</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-300">{t('onlineTest.batchTest.resultColumns.overallRiskLevel')}</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-300">{t('onlineTest.batchTest.resultColumns.securityRiskLevel')}</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-300">{t('onlineTest.batchTest.resultColumns.complianceRiskLevel')}</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-300">{t('onlineTest.batchTest.resultColumns.dataRiskLevel')}</th>
                          <th className="text-left py-2 px-3 font-medium text-slate-300">{t('onlineTest.batchTest.resultColumns.action')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchResults.slice(0, 50).map((result, index) => (
                          <tr key={index} className="border-b border-border hover:bg-card/5">
                            <td className="py-2 px-3 text-muted-foreground">{index + 1}</td>
                            <td className="py-2 px-3 max-w-[300px] truncate" title={result.detection_content}>{result.detection_content}</td>
                            <td className="py-2 px-3">
                              <span className={cn("px-2 py-0.5 text-xs rounded border", getRiskBgColor(result.overall_risk_level))}>
                                {translateRiskLevel(result.overall_risk_level)}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={cn("px-2 py-0.5 text-xs rounded border", getRiskBgColor(result.security_risk_level))}>
                                {translateRiskLevel(result.security_risk_level)}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={cn("px-2 py-0.5 text-xs rounded border", getRiskBgColor(result.compliance_risk_level))}>
                                {translateRiskLevel(result.compliance_risk_level)}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={cn("px-2 py-0.5 text-xs rounded border", getRiskBgColor(result.data_risk_level))}>
                                {translateRiskLevel(result.data_risk_level)}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={cn(
                                "px-2 py-0.5 text-xs rounded border",
                                result.suggest_action === 'pass' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' :
                                result.suggest_action === 'reject' ? 'bg-red-500/10 border-red-500/20 text-red-300' :
                                'bg-orange-500/10 border-orange-500/20 text-orange-300'
                              )}>
                                {result.suggest_action}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {batchResults.length > 50 && (
                      <p className="text-sm text-muted-foreground mt-2 text-center">
                        ... {t('onlineTest.batchTest.progress', { current: 50, total: batchResults.length })} ...
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default OnlineTest
