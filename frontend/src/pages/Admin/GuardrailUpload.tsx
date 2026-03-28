import React, { useState, useEffect } from 'react'
import { Upload, RefreshCw, Trash2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { confirmDialog } from '@/utils/confirm-dialog'
import { scannerPackagesApi } from '../../services/api'
import type { ColumnDef } from '@tanstack/react-table'

interface Package {
  id: string
  package_code: string
  package_name: string
  author: string
  description?: string
  version: string
  scanner_count: number
  bundle?: string
  created_at?: string
  archived?: boolean
  archived_at?: string
  archive_reason?: string
}

const GuardrailUpload: React.FC = () => {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [packages, setPackages] = useState<Package[]>([])
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadBundle, setUploadBundle] = useState<string>('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await scannerPackagesApi.getAllAdmin('basic', true)
      setPackages(data)
    } catch (error) {
      toast.error(t('guardrailUpload.loadFailed'))
      console.error('Failed to load packages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/json') {
      toast.error(t('guardrailUpload.jsonOnly'))
      return
    }

    setSelectedFile(file)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const jsonContent = JSON.parse(e.target?.result as string)
        if (jsonContent.bundle && !uploadBundle) {
          setUploadBundle(jsonContent.bundle)
        }
      } catch {
        console.error('Invalid JSON file')
      }
    }
    reader.readAsText(file)
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error(t('guardrailUpload.selectFile'))
      return
    }

    setUploading(true)
    const reader = new FileReader()

    reader.onload = async (e) => {
      try {
        const jsonContent = JSON.parse(e.target?.result as string)
        const defaultBundle = jsonContent.bundle || uploadBundle || undefined

        await scannerPackagesApi.uploadBasicPackage({
          package_data: jsonContent,
          bundle: defaultBundle,
        })

        toast.success(t('guardrailUpload.uploadSuccess'))
        setUploadModalVisible(false)
        setSelectedFile(null)
        setUploadBundle('')
        await loadData()
      } catch (error: any) {
        const detail = error?.response?.data?.detail || t('guardrailUpload.uploadFailed')
        toast.error(detail)
        console.error('Failed to upload package:', error)
      } finally {
        setUploading(false)
      }
    }

    reader.readAsText(selectedFile)
  }

  const handleArchive = async (pkg: Package) => {
    const confirmed = await confirmDialog({
      title: t('guardrailUpload.archivePackage'),
      description: t('guardrailUpload.confirmArchive', { name: pkg.package_name }),
    })
    if (!confirmed) return

    try {
      await scannerPackagesApi.archivePackage(pkg.id)
      toast.success(t('guardrailUpload.archiveSuccess'))
      await loadData()
    } catch {
      toast.error(t('guardrailUpload.archiveFailed'))
    }
  }

  const handleUnarchive = async (pkg: Package) => {
    try {
      await scannerPackagesApi.unarchivePackage(pkg.id)
      toast.success(t('guardrailUpload.unarchiveSuccess'))
      await loadData()
    } catch {
      toast.error(t('guardrailUpload.unarchiveFailed'))
    }
  }

  const columns: ColumnDef<Package>[] = [
    {
      accessorKey: 'package_name',
      header: t('guardrailUpload.packageName'),
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.package_name}</span>
          {row.original.archived && (
            <Badge variant="secondary" className="ml-2">{t('guardrailUpload.archived')}</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'package_code',
      header: t('guardrailUpload.packageCode'),
    },
    {
      accessorKey: 'version',
      header: t('guardrailUpload.version'),
    },
    {
      accessorKey: 'scanner_count',
      header: t('guardrailUpload.scannerCount'),
    },
    {
      accessorKey: 'author',
      header: t('guardrailUpload.author'),
    },
    {
      accessorKey: 'bundle',
      header: t('guardrailUpload.bundle'),
      cell: ({ row }) => row.original.bundle || '-',
    },
    {
      id: 'actions',
      header: t('common.actions'),
      cell: ({ row }) => (
        <div className="flex gap-1">
          {row.original.archived ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleUnarchive(row.original)}
              title={t('guardrailUpload.unarchive')}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleArchive(row.original)}
              title={t('guardrailUpload.archive')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('guardrailUpload.title')}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t('guardrailUpload.description')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw className="h-4 w-4 mr-1" />
                {t('common.refresh')}
              </Button>
              <Button size="sm" onClick={() => setUploadModalVisible(true)}>
                <Upload className="h-4 w-4 mr-1" />
                {t('guardrailUpload.upload')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={packages}
            loading={loading}
          />
        </CardContent>
      </Card>

      {/* Upload Modal */}
      <Dialog open={uploadModalVisible} onOpenChange={setUploadModalVisible}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('guardrailUpload.uploadTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t('guardrailUpload.jsonFile')}</label>
              <Input
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('guardrailUpload.jsonFileHint')}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">{t('guardrailUpload.bundle')}</label>
              <Input
                value={uploadBundle}
                onChange={(e) => setUploadBundle(e.target.value)}
                placeholder={t('guardrailUpload.bundlePlaceholder')}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadModalVisible(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
              {uploading ? t('common.uploading') : t('guardrailUpload.upload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default GuardrailUpload
