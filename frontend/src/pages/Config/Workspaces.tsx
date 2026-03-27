import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Plus, Edit, Trash2, ArrowRightLeft, Settings, ChevronLeft, Search, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCanEdit } from '../../hooks/useCanEdit'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable } from '@/components/data-table/DataTable'
import { confirmDialog } from '@/utils/confirm-dialog'
import api from '../../services/api'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'

// Import reusable config components
import GuardrailsManagement from './GuardrailsManagement'
import DataSecurity from '../DataSecurity'
import KeywordListManagement from './KeywordListManagement'
import AnswerManagement from './AnswerManagement'
import SecurityPolicy from '../SecurityGateway/SecurityPolicy'

const workspaceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  owner: z.string().optional(),
})

type WorkspaceFormData = z.infer<typeof workspaceSchema>

interface Workspace {
  id: string
  tenant_id: string
  name: string
  description: string | null
  owner: string | null
  is_global: boolean
  created_at: string
  updated_at: string
  application_count: number
}

interface Application {
  id: string
  name: string
  description?: string | null
  is_active: boolean
  source: string
  external_id?: string
  workspace_id: string | null
  workspace_name: string | null
  created_at?: string
}

// ============================================================
// Workspace Apps Tab
// ============================================================

const WorkspaceAppsTab: React.FC<{
  workspace: Workspace
}> = ({ workspace }) => {
  const { t } = useTranslation()
  const canEdit = useCanEdit()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingApp, setEditingApp] = useState<Application | null>(null)
  // Search & filter
  const [searchText, setSearchText] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'manual' | 'auto_discovery'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  // Batch operations
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [batchMoveDialogOpen, setBatchMoveDialogOpen] = useState(false)
  const [batchMoveTargetWs, setBatchMoveTargetWs] = useState<string>('')
  const [allWorkspaces, setAllWorkspaces] = useState<{ id: string; name: string; is_global: boolean }[]>([])

  const appSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
  })

  const form = useForm<z.infer<typeof appSchema>>({
    resolver: zodResolver(appSchema),
    defaultValues: { name: '', description: '' },
  })

  const fetchApps = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/api/v1/workspaces/${workspace.id}/applications`)
      setApps(res.data)
    } catch {
      toast.error(t('workspaces.configFetchError'))
    } finally {
      setLoading(false)
    }
  }, [workspace.id])

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await api.get('/api/v1/workspaces')
      setAllWorkspaces(res.data.map((w: any) => ({ id: w.id, name: w.name, is_global: w.is_global })))
    } catch {
      // silent
    }
  }, [])

  useEffect(() => { fetchApps(); fetchWorkspaces() }, [fetchApps, fetchWorkspaces])

  // Filter apps
  const filteredApps = useMemo(() => {
    let result = apps
    if (sourceFilter !== 'all') {
      result = result.filter(app => (app.source || 'manual') === sourceFilter)
    }
    if (statusFilter !== 'all') {
      result = result.filter(app => statusFilter === 'active' ? app.is_active : !app.is_active)
    }
    if (searchText.trim()) {
      const search = searchText.toLowerCase().trim()
      result = result.filter(app =>
        app.name.toLowerCase().includes(search) ||
        (app.external_id && app.external_id.toLowerCase().includes(search))
      )
    }
    return result
  }, [apps, sourceFilter, statusFilter, searchText])

  // Selection helpers
  const toggleRowSelection = (appId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedRowIds.size === filteredApps.length) {
      setSelectedRowIds(new Set())
    } else {
      setSelectedRowIds(new Set(filteredApps.map(app => app.id)))
    }
  }

  // Available target workspaces (exclude current)
  const targetWorkspaces = useMemo(() =>
    allWorkspaces
      .filter(w => w.id !== workspace.id)
      .sort((a, b) => {
        if (a.is_global !== b.is_global) return a.is_global ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [allWorkspaces, workspace.id])

  const handleBatchMove = async () => {
    if (selectedRowIds.size === 0 || !batchMoveTargetWs) return
    try {
      const appIds = Array.from(selectedRowIds)
      await api.post(`/api/v1/workspaces/${batchMoveTargetWs}/assign`, {
        application_ids: appIds,
      })
      toast.success(t('workspaces.assignSuccess'))
      setBatchMoveDialogOpen(false)
      setSelectedRowIds(new Set())
      fetchApps()
    } catch {
      toast.error(t('workspaces.assignError'))
    }
  }

  const handleCreate = () => {
    setEditingApp(null)
    form.reset({ name: '', description: '' })
    setDialogOpen(true)
  }

  const handleEdit = (app: Application) => {
    setEditingApp(app)
    form.reset({ name: app.name, description: app.description || '' })
    setDialogOpen(true)
  }

  const handleDelete = async (app: Application) => {
    const confirmed = await confirmDialog({
      title: t('applicationManagement.confirmDelete'),
      description: t('applicationManagement.confirmDeleteContent', { name: app.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await api.delete(`/api/v1/applications/${app.id}`)
      toast.success(t('common.deleteSuccess'))
      fetchApps()
    } catch {
      toast.error(t('common.deleteFailed'))
    }
  }

  const handleSubmit = async (values: z.infer<typeof appSchema>) => {
    try {
      if (editingApp) {
        await api.put(`/api/v1/applications/${editingApp.id}`, values)
        toast.success(t('common.updateSuccess'))
      } else {
        const res = await api.post('/api/v1/applications', values)
        const newAppId = res.data.id
        await api.post(`/api/v1/workspaces/${workspace.id}/assign`, {
          application_ids: [newAppId],
        })
        toast.success(t('common.createSuccess'))
      }
      setDialogOpen(false)
      fetchApps()
    } catch (error: any) {
      const msg = error.response?.data?.detail || t('common.saveFailed')
      toast.error(msg)
    }
  }

  const handleToggleActive = async (app: Application) => {
    try {
      await api.put(`/api/v1/applications/${app.id}`, { is_active: !app.is_active })
      setApps(prev => prev.map(a => a.id === app.id ? { ...a, is_active: !a.is_active } : a))
      toast.success(t('common.updateSuccess'))
    } catch {
      toast.error(t('common.saveFailed'))
    }
  }

  const columns: ColumnDef<Application>[] = [
    ...(canEdit ? [{
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border cursor-pointer"
          checked={filteredApps.length > 0 && selectedRowIds.size === filteredApps.length}
          onChange={toggleSelectAll}
        />
      ),
      cell: ({ row }: { row: any }) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border cursor-pointer"
          checked={selectedRowIds.has(row.original.id)}
          onChange={() => toggleRowSelection(row.original.id)}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        />
      ),
    }] : []),
    {
      accessorKey: 'name',
      header: t('applicationManagement.name'),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: 'description',
      header: t('applicationManagement.description'),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm truncate max-w-[200px] block">
          {row.original.description || '-'}
        </span>
      ),
    },
    {
      accessorKey: 'is_active',
      header: t('common.status'),
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? 'default' : 'secondary'}>
          {row.original.is_active ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      accessorKey: 'source',
      header: t('applicationManagement.source'),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.source === 'auto_discovery'
            ? t('applicationManagement.sourceAutoDiscovery')
            : t('applicationManagement.sourceManual')}
        </Badge>
      ),
    },
    {
      accessorKey: 'created_at',
      header: t('workspaces.createdAt'),
      cell: ({ row }) =>
        row.original.created_at
          ? format(new Date(row.original.created_at), 'yyyy-MM-dd HH:mm')
          : '-',
    },
    ...(canEdit ? [{
      id: 'actions',
      header: t('common.actions'),
      cell: ({ row }: { row: any }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => handleToggleActive(row.original)}
            title={row.original.is_active ? t('common.disable') : t('common.enable')}>
            <Switch checked={row.original.is_active} className="pointer-events-none" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(row.original)}
            className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      {/* Header with search, filters, and actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{t('workspaces.tabApplications')}</h3>
          <p className="text-sm text-muted-foreground">{t('workspaces.applicationsDesc')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('applicationManagement.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-8 w-[180px] h-8 text-sm"
            />
            {searchText && (
              <button
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchText('')}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {/* Source filter */}
          <Select value={sourceFilter} onValueChange={(v: any) => setSourceFilter(v)}>
            <SelectTrigger className="w-[120px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('applicationManagement.filterAll')}</SelectItem>
              <SelectItem value="manual">{t('applicationManagement.sourceManual')}</SelectItem>
              <SelectItem value="auto_discovery">{t('applicationManagement.sourceAutoDiscovery')}</SelectItem>
            </SelectContent>
          </Select>
          {/* Status filter */}
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="w-[100px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('applicationManagement.filterAll')}</SelectItem>
              <SelectItem value="active">{t('common.active')}</SelectItem>
              <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
            </SelectContent>
          </Select>
          {/* Batch move button */}
          {canEdit && selectedRowIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBatchMoveTargetWs('')
                setBatchMoveDialogOpen(true)
              }}
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              {t('workspaces.batchMove', { count: selectedRowIds.size })}
            </Button>
          )}
          {canEdit && (
            <Button onClick={handleCreate} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {t('applicationManagement.createApplication')}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable columns={columns} data={filteredApps} loading={loading} />
        </CardContent>
      </Card>

      {/* Create/Edit App Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingApp ? t('applicationManagement.editApplication') : t('applicationManagement.createApplication')}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField control={form.control} name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('applicationManagement.name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('applicationManagement.namePlaceholder')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              <FormField control={form.control} name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('applicationManagement.description')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder={t('applicationManagement.descriptionPlaceholder')} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit">
                  {editingApp ? t('common.save') : t('common.create')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Batch Move Dialog */}
      <Dialog open={batchMoveDialogOpen} onOpenChange={setBatchMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspaces.batchMoveTitle', { count: selectedRowIds.size })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('workspaces.batchMoveDesc')}
            </p>
            <Select value={batchMoveTargetWs} onValueChange={setBatchMoveTargetWs}>
              <SelectTrigger>
                <SelectValue placeholder={t('workspaces.selectWorkspace')} />
              </SelectTrigger>
              <SelectContent>
                {targetWorkspaces.map(ws => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                    {ws.is_global && ` (${t('workspaces.global')})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBatchMoveDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleBatchMove} disabled={!batchMoveTargetWs}>
              {t('workspaces.batchMove', { count: selectedRowIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


// ============================================================
// Workspace Config Panel (detail view)
// ============================================================

const WorkspaceConfigPanel: React.FC<{
  workspace: Workspace
  onBack: () => void
}> = ({ workspace, onBack }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('applications')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{workspace.name}</h1>
            {workspace.is_global && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
                {t('workspaces.global')}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            {workspace.is_global ? t('workspaces.globalConfigSubtitle') : t('workspaces.configSubtitle')}
          </p>
        </div>
      </div>

      <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
        {workspace.is_global ? t('workspaces.globalInheritNote') : t('workspaces.inheritNote')}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="applications">{t('workspaces.tabApplications')}</TabsTrigger>
          <TabsTrigger value="guardrails">{t('workspaces.tabGuardrails')}</TabsTrigger>
          <TabsTrigger value="data-masking">{t('workspaces.tabDataMasking')}</TabsTrigger>
          <TabsTrigger value="keywords">{t('workspaces.tabKeywords')}</TabsTrigger>
          <TabsTrigger value="answers">{t('workspaces.tabAnswers')}</TabsTrigger>
          <TabsTrigger value="security">{t('workspaces.tabSecurity')}</TabsTrigger>
        </TabsList>

        {/* AI Applications Tab */}
        <TabsContent value="applications">
          <WorkspaceAppsTab workspace={workspace} />
        </TabsContent>

        {/* Guardrails Tab - Reuses global GuardrailsManagement */}
        <TabsContent value="guardrails">
          <GuardrailsManagement workspaceId={workspace.id} />
        </TabsContent>

        {/* Data Masking Tab - Reuses global DataSecurity */}
        <TabsContent value="data-masking">
          <DataSecurity workspaceId={workspace.id} />
        </TabsContent>

        {/* Keywords Tab - Reuses global KeywordListManagement */}
        <TabsContent value="keywords">
          <KeywordListManagement workspaceId={workspace.id} />
        </TabsContent>

        {/* Answers Tab - Reuses global AnswerManagement */}
        <TabsContent value="answers">
          <AnswerManagement workspaceId={workspace.id} />
        </TabsContent>

        {/* Security Policy Tab - Reuses global SecurityPolicy */}
        <TabsContent value="security">
          <SecurityPolicy workspaceId={workspace.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}


// ============================================================
// Main Workspace List View
// ============================================================

const Workspaces: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const canEdit = useCanEdit()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [configWorkspace, setConfigWorkspace] = useState<Workspace | null>(null)
  const prevLocationKeyRef = useRef(location.key)

  // Reset to workspace list when navigating to this page via menu
  useEffect(() => {
    if (prevLocationKeyRef.current !== location.key) {
      prevLocationKeyRef.current = location.key
      setConfigWorkspace(null)
    }
  }, [location.key])

  const form = useForm<WorkspaceFormData>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: '', description: '' },
  })

  const fetchWorkspaces = async () => {
    setLoading(true)
    try {
      const response = await api.get('/api/v1/workspaces')
      // Sort: global first, then alphabetical
      const sorted = (response.data as Workspace[]).sort((a, b) => {
        if (a.is_global !== b.is_global) return a.is_global ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setWorkspaces(sorted)
    } catch (error) {
      toast.error(t('workspaces.fetchError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkspaces()
  }, [])

  const handleCreate = () => {
    setEditingWorkspace(null)
    form.reset({ name: '', description: '', owner: '' })
    setDialogOpen(true)
  }

  const handleEdit = (workspace: Workspace) => {
    setEditingWorkspace(workspace)
    form.reset({
      name: workspace.name,
      description: workspace.description || '',
      owner: workspace.owner || '',
    })
    setDialogOpen(true)
  }

  const isEditingGlobal = editingWorkspace?.is_global === true

  const handleDelete = async (workspace: Workspace) => {
    if (workspace.is_global) {
      toast.error(t('workspaces.cannotDeleteGlobal', 'Cannot delete the Global workspace'))
      return
    }
    const confirmed = await confirmDialog({
      title: t('workspaces.deleteConfirmTitle'),
      description: t('workspaces.deleteConfirmDesc', { name: workspace.name }),
    })
    if (!confirmed) return

    try {
      await api.delete(`/api/v1/workspaces/${workspace.id}`)
      toast.success(t('workspaces.deleteSuccess'))
      fetchWorkspaces()
    } catch (error) {
      toast.error(t('workspaces.deleteError'))
    }
  }

  const handleSubmit = async (values: WorkspaceFormData) => {
    try {
      if (editingWorkspace) {
        await api.put(`/api/v1/workspaces/${editingWorkspace.id}`, values)
        toast.success(t('workspaces.updateSuccess'))
      } else {
        await api.post('/api/v1/workspaces', values)
        toast.success(t('workspaces.createSuccess'))
      }
      setDialogOpen(false)
      fetchWorkspaces()
    } catch (error: any) {
      const msg = error.response?.data?.detail || t('workspaces.saveError')
      toast.error(msg)
    }
  }

  // If viewing workspace config, show config panel
  if (configWorkspace) {
    return (
      <WorkspaceConfigPanel
        workspace={configWorkspace}
        onBack={() => { setConfigWorkspace(null); fetchWorkspaces() }}
      />
    )
  }

  const columns: ColumnDef<Workspace>[] = [
    {
      accessorKey: 'name',
      header: t('workspaces.name'),
      cell: ({ row }) => (
        <div className="cursor-pointer hover:underline" onClick={() => setConfigWorkspace(row.original)}>
          <span className="font-medium flex items-center gap-2">
            {row.original.name}
            {row.original.is_global && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">
                {t('workspaces.global')}
              </span>
            )}
          </span>
          {row.original.is_global && (
            <span className="text-xs text-muted-foreground">{t('workspaces.globalHint')}</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: t('workspaces.description'),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.description || '-'}
        </span>
      ),
    },
    {
      accessorKey: 'owner',
      header: t('workspaces.owner'),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {row.original.owner || '-'}
        </span>
      ),
    },
    {
      accessorKey: 'application_count',
      header: t('workspaces.appCount'),
      cell: ({ row }) => (
        <Badge variant="secondary">{row.original.application_count}</Badge>
      ),
    },
    {
      accessorKey: 'created_at',
      header: t('workspaces.createdAt'),
      cell: ({ row }) => format(new Date(row.original.created_at), 'yyyy-MM-dd HH:mm'),
    },
    ...(canEdit ? [{
      id: 'actions',
      header: t('common.actions'),
      cell: ({ row }: { row: any }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfigWorkspace(row.original)}
            title={t('workspaces.config')}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleEdit(row.original)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          {!row.original.is_global && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(row.original)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('workspaces.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('workspaces.subtitle')}</p>
        </div>
        {canEdit && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('workspaces.create')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={workspaces}
            loading={loading}
          />
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWorkspace ? t('workspaces.edit') : t('workspaces.create')}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('workspaces.name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('workspaces.namePlaceholder')} disabled={isEditingGlobal} />
                    </FormControl>
                    {isEditingGlobal && (
                      <p className="text-xs text-muted-foreground">{t('workspaces.globalNameProtected')}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('workspaces.description')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('workspaces.descriptionPlaceholder')}
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('workspaces.owner')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('workspaces.ownerPlaceholder')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit">
                  {editingWorkspace ? t('common.save') : t('common.create')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

    </div>
  )
}

export default Workspaces
