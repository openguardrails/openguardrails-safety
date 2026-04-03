import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { attackCampaignsApi } from '../../services/api'
import api from '../../services/api'
import {
  Target,
  Plus,
  Play,
  Trash2,
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Checkbox } from '../../components/ui/checkbox'
import { Badge } from '../../components/ui/badge'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'

interface TestPackage {
  code: string
  name: string
  name_en: string
  description: string
  description_en: string
  categories: PackageCategory[]
  total_questions: number
}

interface PackageCategory {
  code: string
  name: string
  name_en: string
  question_count: number
}

interface Campaign {
  id: string
  name: string
  description: string | null
  packages: string[]
  selected_categories: string[]
  workspace_id: string | null
  workspace_name: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  total_tests: number
  passed_tests: number
  failed_tests: number
  pass_rate: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

interface CampaignResult {
  id: string
  question_id: string | null
  question_content: string
  category: string
  expected_action: string
  actual_action: string | null
  detection_result: any
  passed: boolean | null
  created_at: string
}

interface WorkspaceOption {
  id: string
  name: string
}

const AttackCampaigns: React.FC = () => {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language === 'zh'

  // State
  const [packages, setPackages] = useState<TestPackage[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  // Create campaign dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [campaignName, setCampaignName] = useState('')
  const [campaignDescription, setCampaignDescription] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('global')
  const [selectedPackages, setSelectedPackages] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [expandedPackages, setExpandedPackages] = useState<string[]>([])

  // Campaign detail dialog
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [campaignResults, setCampaignResults] = useState<CampaignResult[]>([])
  const [loadingResults, setLoadingResults] = useState(false)

  // Load data
  const loadPackages = useCallback(async () => {
    try {
      const data = await attackCampaignsApi.getPackages()
      setPackages(data)
    } catch (error) {
      console.error('Failed to load packages:', error)
      toast.error(t('redTeaming.attackCampaigns.loadFailed'))
    }
  }, [t])

  const loadCampaigns = useCallback(async () => {
    try {
      const data = await attackCampaignsApi.listCampaigns({ page_size: 100 })
      setCampaigns(data.items)
    } catch (error) {
      console.error('Failed to load campaigns:', error)
    }
  }, [])

  const loadWorkspaces = useCallback(async () => {
    try {
      const response = await api.get('/api/v1/workspaces')
      setWorkspaces(response.data.filter((ws: any) => !ws.is_global).map((ws: any) => ({ id: ws.id, name: ws.name })))
    } catch (error) {
      console.error('Failed to load workspaces:', error)
    }
  }, [])

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true)
      await Promise.all([loadPackages(), loadCampaigns(), loadWorkspaces()])
      setLoading(false)
    }
    loadAll()
  }, [loadPackages, loadCampaigns, loadWorkspaces])

  // Auto-refresh campaigns that are running
  useEffect(() => {
    const runningCampaigns = campaigns.filter(c => c.status === 'running')
    if (runningCampaigns.length === 0) return

    const interval = setInterval(() => {
      loadCampaigns()
    }, 3000)

    return () => clearInterval(interval)
  }, [campaigns, loadCampaigns])

  // Package selection handlers
  const togglePackage = (packageCode: string) => {
    setSelectedPackages(prev => {
      if (prev.includes(packageCode)) {
        // Remove package and its categories
        const pkg = packages.find(p => p.code === packageCode)
        if (pkg) {
          setSelectedCategories(cats =>
            cats.filter(cat => !pkg.categories.some(c => c.code === cat))
          )
        }
        return prev.filter(p => p !== packageCode)
      } else {
        // Add package and expand it
        setExpandedPackages(exp => exp.includes(packageCode) ? exp : [...exp, packageCode])
        return [...prev, packageCode]
      }
    })
  }

  const toggleCategory = (categoryCode: string, packageCode: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryCode)) {
        return prev.filter(c => c !== categoryCode)
      } else {
        // Ensure package is selected
        if (!selectedPackages.includes(packageCode)) {
          setSelectedPackages(pkgs => [...pkgs, packageCode])
        }
        return [...prev, categoryCode]
      }
    })
  }

  const togglePackageExpand = (packageCode: string) => {
    setExpandedPackages(prev =>
      prev.includes(packageCode)
        ? prev.filter(p => p !== packageCode)
        : [...prev, packageCode]
    )
  }

  const selectAllCategories = (packageCode: string) => {
    const pkg = packages.find(p => p.code === packageCode)
    if (!pkg) return

    if (!selectedPackages.includes(packageCode)) {
      setSelectedPackages(pkgs => [...pkgs, packageCode])
    }

    const allCategoryCodes = pkg.categories.map(c => c.code)
    setSelectedCategories(prev => {
      const otherCategories = prev.filter(c => !allCategoryCodes.includes(c))
      return [...otherCategories, ...allCategoryCodes]
    })
  }

  const deselectAllCategories = (packageCode: string) => {
    const pkg = packages.find(p => p.code === packageCode)
    if (!pkg) return

    const allCategoryCodes = pkg.categories.map(c => c.code)
    setSelectedCategories(prev => prev.filter(c => !allCategoryCodes.includes(c)))
  }

  // Create campaign
  const handleCreateCampaign = async () => {
    if (!campaignName.trim()) {
      toast.error(t('common.required'))
      return
    }
    if (selectedCategories.length === 0) {
      toast.error(t('redTeaming.attackCampaigns.selectRules'))
      return
    }

    setCreating(true)
    try {
      await attackCampaignsApi.createCampaign({
        name: campaignName,
        description: campaignDescription || undefined,
        packages: selectedPackages,
        selected_categories: selectedCategories,
        workspace_id: selectedWorkspaceId !== 'global' ? selectedWorkspaceId : undefined,
      })
      toast.success(t('redTeaming.attackCampaigns.campaignCreated'))
      setShowCreateDialog(false)
      resetCreateForm()
      loadCampaigns()
    } catch (error: any) {
      console.error('Failed to create campaign:', error)
      toast.error(error?.response?.data?.detail || t('redTeaming.attackCampaigns.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const resetCreateForm = () => {
    setCampaignName('')
    setCampaignDescription('')
    setSelectedWorkspaceId('global')
    setSelectedPackages([])
    setSelectedCategories([])
    setExpandedPackages([])
  }

  // Run campaign
  const handleRunCampaign = async (campaignId: string) => {
    try {
      await attackCampaignsApi.runCampaign(campaignId)
      toast.success(t('redTeaming.attackCampaigns.campaignStarted'))
      loadCampaigns()
    } catch (error: any) {
      console.error('Failed to run campaign:', error)
      toast.error(error?.response?.data?.detail || t('redTeaming.attackCampaigns.runFailed'))
    }
  }

  // Delete campaign
  const handleDeleteCampaign = async (campaignId: string) => {
    if (!confirm(t('redTeaming.attackCampaigns.confirmDelete'))) return

    try {
      await attackCampaignsApi.deleteCampaign(campaignId)
      toast.success(t('redTeaming.attackCampaigns.campaignDeleted'))
      loadCampaigns()
    } catch (error: any) {
      console.error('Failed to delete campaign:', error)
      toast.error(error?.response?.data?.detail || t('redTeaming.attackCampaigns.deleteFailed'))
    }
  }

  // View campaign details
  const handleViewCampaign = async (campaign: Campaign) => {
    setSelectedCampaign(campaign)
    setShowDetailDialog(true)
    setLoadingResults(true)

    try {
      const data = await attackCampaignsApi.getCampaignResults(campaign.id, { page_size: 500 })
      setCampaignResults(data.items)
    } catch (error) {
      console.error('Failed to load campaign results:', error)
      toast.error(t('redTeaming.attackCampaigns.loadFailed'))
    } finally {
      setLoadingResults(false)
    }
  }

  // Status badge
  const StatusBadge: React.FC<{ status: Campaign['status'] }> = ({ status }) => {
    const config = {
      pending: { icon: Clock, color: 'bg-slate-500/10 text-slate-400 border-slate-500/20', label: t('redTeaming.attackCampaigns.campaignStatus.pending') },
      running: { icon: Loader2, color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', label: t('redTeaming.attackCampaigns.campaignStatus.running') },
      completed: { icon: CheckCircle, color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: t('redTeaming.attackCampaigns.campaignStatus.completed') },
      failed: { icon: AlertCircle, color: 'bg-red-500/10 text-red-400 border-red-500/20', label: t('redTeaming.attackCampaigns.campaignStatus.failed') },
    }
    const { icon: Icon, color, label } = config[status]

    return (
      <Badge variant="outline" className={cn("gap-1", color)}>
        <Icon className={cn("h-3 w-3", status === 'running' && "animate-spin")} />
        {label}
      </Badge>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6" />
            {t('redTeaming.attackCampaigns.title')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('redTeaming.attackCampaigns.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadCampaigns}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('redTeaming.attackCampaigns.createCampaign')}
          </Button>
        </div>
      </div>

      {/* Campaigns list */}
      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('redTeaming.attackCampaigns.noCampaigns')}</p>
            <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('redTeaming.attackCampaigns.createCampaign')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold truncate">{campaign.name}</h3>
                      <StatusBadge status={campaign.status} />
                    </div>
                    {campaign.description && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {campaign.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span>{t('redTeaming.attackCampaigns.totalTests')}: {campaign.total_tests}</span>
                      {campaign.status === 'completed' && (
                        <>
                          <span className="text-emerald-400">
                            {t('redTeaming.attackCampaigns.passed')}: {campaign.passed_tests}
                          </span>
                          <span className="text-red-400">
                            {t('redTeaming.attackCampaigns.failed')}: {campaign.failed_tests}
                          </span>
                          {campaign.pass_rate !== null && (
                            <span className={cn(
                              "font-medium",
                              campaign.pass_rate >= 80 ? "text-emerald-400" :
                              campaign.pass_rate >= 50 ? "text-yellow-400" : "text-red-400"
                            )}>
                              {t('redTeaming.attackCampaigns.passRate')}: {campaign.pass_rate.toFixed(1)}%
                            </span>
                          )}
                        </>
                      )}
                      {campaign.workspace_name && (
                        <span>Workspace: {campaign.workspace_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {campaign.status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => handleRunCampaign(campaign.id)}
                      >
                        <Play className="h-4 w-4 mr-1" />
                        {t('redTeaming.attackCampaigns.runCampaign')}
                      </Button>
                    )}
                    {(campaign.status === 'completed' || campaign.status === 'failed') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewCampaign(campaign)}
                      >
                        {t('redTeaming.attackCampaigns.viewDetails')}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    )}
                    {campaign.status !== 'running' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => handleDeleteCampaign(campaign.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Campaign Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('redTeaming.attackCampaigns.createCampaign')}</DialogTitle>
            <DialogDescription>
              {t('redTeaming.attackCampaigns.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Campaign name */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('redTeaming.attackCampaigns.campaignName')}</label>
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder={t('redTeaming.attackCampaigns.campaignName')}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('redTeaming.attackCampaigns.campaignDescription')}</label>
              <Textarea
                value={campaignDescription}
                onChange={(e) => setCampaignDescription(e.target.value)}
                placeholder={t('redTeaming.attackCampaigns.campaignDescription')}
                rows={2}
              />
            </div>

            {/* Workspace selector */}
            {workspaces.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('redTeaming.attackCampaigns.selectWorkspace')}</label>
                <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">{t('onlineTest.globalConfig')}</SelectItem>
                    {workspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Package selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('redTeaming.attackCampaigns.selectPackages')}</label>
              <div className="space-y-3">
                {packages.map((pkg) => (
                  <Card key={pkg.code} className={cn(
                    "transition-colors",
                    selectedPackages.includes(pkg.code) && "border-primary"
                  )}>
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedPackages.includes(pkg.code)}
                            onCheckedChange={() => togglePackage(pkg.code)}
                          />
                          <div>
                            <CardTitle className="text-base">
                              {isZh ? pkg.name : pkg.name_en}
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                              {isZh ? pkg.description : pkg.description_en}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {pkg.total_questions} {t('redTeaming.attackCampaigns.testQuestions')}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => togglePackageExpand(pkg.code)}
                          >
                            {expandedPackages.includes(pkg.code) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    {expandedPackages.includes(pkg.code) && (
                      <CardContent className="p-4 pt-0">
                        <div className="flex justify-end gap-2 mb-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => selectAllCategories(pkg.code)}
                          >
                            {t('redTeaming.attackCampaigns.selectAll')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deselectAllCategories(pkg.code)}
                          >
                            {t('redTeaming.attackCampaigns.deselectAll')}
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {pkg.categories.map((cat) => (
                            <div
                              key={cat.code}
                              className={cn(
                                "flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors",
                                selectedCategories.includes(cat.code)
                                  ? "bg-primary/10 border-primary"
                                  : "hover:bg-muted"
                              )}
                              onClick={() => toggleCategory(cat.code, pkg.code)}
                            >
                              <Checkbox
                                checked={selectedCategories.includes(cat.code)}
                                onCheckedChange={() => toggleCategory(cat.code, pkg.code)}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {cat.code}: {isZh ? cat.name : cat.name_en}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {cat.question_count} {t('redTeaming.attackCampaigns.testQuestions')}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>

            {/* Summary */}
            {selectedCategories.length > 0 && (
              <div className="p-3 bg-muted rounded-md">
                <div className="text-sm">
                  <span className="font-medium">{t('redTeaming.attackCampaigns.totalTests')}:</span>{' '}
                  <span className="text-primary">
                    {packages.reduce((acc, pkg) => {
                      return acc + pkg.categories
                        .filter(cat => selectedCategories.includes(cat.code))
                        .reduce((sum, cat) => sum + cat.question_count, 0)
                    }, 0)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateCampaign} disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('redTeaming.attackCampaigns.createCampaign')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaign Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedCampaign?.name}
              {selectedCampaign && <StatusBadge status={selectedCampaign.status} />}
            </DialogTitle>
            {selectedCampaign?.description && (
              <DialogDescription>{selectedCampaign.description}</DialogDescription>
            )}
          </DialogHeader>

          {selectedCampaign && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{selectedCampaign.total_tests}</div>
                    <div className="text-xs text-muted-foreground">{t('redTeaming.attackCampaigns.totalTests')}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-400">{selectedCampaign.passed_tests}</div>
                    <div className="text-xs text-muted-foreground">{t('redTeaming.attackCampaigns.passed')}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-red-400">{selectedCampaign.failed_tests}</div>
                    <div className="text-xs text-muted-foreground">{t('redTeaming.attackCampaigns.failed')}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className={cn(
                      "text-2xl font-bold",
                      selectedCampaign.pass_rate !== null && (
                        selectedCampaign.pass_rate >= 80 ? "text-emerald-400" :
                        selectedCampaign.pass_rate >= 50 ? "text-yellow-400" : "text-red-400"
                      )
                    )}>
                      {selectedCampaign.pass_rate !== null ? `${selectedCampaign.pass_rate.toFixed(1)}%` : '-'}
                    </div>
                    <div className="text-xs text-muted-foreground">{t('redTeaming.attackCampaigns.passRate')}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Results table */}
              {loadingResults ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>{t('redTeaming.attackCampaigns.category')}</TableHead>
                        <TableHead className="max-w-[300px]">{t('redTeaming.attackCampaigns.questionContent')}</TableHead>
                        <TableHead>{t('redTeaming.attackCampaigns.expectedAction')}</TableHead>
                        <TableHead>{t('redTeaming.attackCampaigns.actualAction')}</TableHead>
                        <TableHead className="text-center">{t('redTeaming.attackCampaigns.passed')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaignResults.map((result, index) => (
                        <TableRow key={result.id}>
                          <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{result.category}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[300px] truncate" title={result.question_content}>
                            {result.question_content}
                          </TableCell>
                          <TableCell>
                            <Badge variant={result.expected_action === 'reject' ? 'destructive' : 'secondary'}>
                              {result.expected_action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {result.actual_action ? (
                              <Badge variant={result.actual_action === 'reject' ? 'destructive' : 'secondary'}>
                                {result.actual_action}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {result.passed === true ? (
                              <CheckCircle className="h-5 w-5 text-emerald-400 mx-auto" />
                            ) : result.passed === false ? (
                              <XCircle className="h-5 w-5 text-red-400 mx-auto" />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AttackCampaigns
