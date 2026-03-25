"""Workspace Management Router - CRUD operations for workspaces and workspace guardrail configs"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database.connection import get_admin_db
from database.models import (
    Workspace, Application, Tenant, RiskTypeConfig,
    Blacklist, Whitelist, BanPolicy, ApplicationDataLeakagePolicy,
    ApplicationScannerConfig, Scanner, ScannerPackage, ApplicationSettings
)
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime
import uuid
from utils.logger import setup_logger
from services.keyword_cache import keyword_cache

logger = setup_logger()

router = APIRouter(prefix="/api/v1/workspaces", tags=["Workspaces"])


def get_current_tenant_id(request: Request) -> str:
    """Get current tenant ID from request context"""
    auth_context = getattr(request.state, 'auth_context', None)
    if not auth_context:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if 'data' not in auth_context:
        raise HTTPException(status_code=401, detail="Invalid auth context")
    tenant_id = auth_context['data'].get('tenant_id')
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Tenant ID not found in auth context")
    return str(tenant_id)


# Pydantic models
class WorkspaceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    owner: Optional[str] = None

class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    owner: Optional[str] = None

class WorkspaceResponse(BaseModel):
    id: str
    tenant_id: str
    name: str
    description: Optional[str]
    owner: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    application_count: int = 0

    class Config:
        from_attributes = True

class WorkspaceAssignRequest(BaseModel):
    application_ids: List[str]


@router.get("", response_model=List[WorkspaceResponse])
async def list_workspaces(
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """List all workspaces for current tenant"""
    tenant_id = get_current_tenant_id(request)

    workspaces = db.query(Workspace).filter(
        Workspace.tenant_id == tenant_id
    ).order_by(Workspace.created_at.desc()).all()

    result = []
    for ws in workspaces:
        app_count = db.query(func.count(Application.id)).filter(
            Application.workspace_id == ws.id
        ).scalar()
        result.append(WorkspaceResponse(
            id=str(ws.id),
            tenant_id=str(ws.tenant_id),
            name=ws.name,
            description=ws.description,
            owner=ws.owner,
            created_at=ws.created_at,
            updated_at=ws.updated_at,
            application_count=app_count,
        ))

    return result


@router.post("", response_model=WorkspaceResponse)
async def create_workspace(
    request: Request,
    body: WorkspaceCreate,
    db: Session = Depends(get_admin_db),
):
    """Create a new workspace"""
    tenant_id = get_current_tenant_id(request)

    # Check name uniqueness
    existing = db.query(Workspace).filter(
        Workspace.tenant_id == tenant_id,
        Workspace.name == body.name
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Workspace name already exists")

    workspace = Workspace(
        tenant_id=uuid.UUID(tenant_id),
        name=body.name,
        description=body.description,
        owner=body.owner,
    )
    db.add(workspace)
    db.commit()
    db.refresh(workspace)

    return WorkspaceResponse(
        id=str(workspace.id),
        tenant_id=str(workspace.tenant_id),
        name=workspace.name,
        description=workspace.description,
        owner=workspace.owner,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
        application_count=0,
    )


@router.put("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: str,
    request: Request,
    body: WorkspaceUpdate,
    db: Session = Depends(get_admin_db),
):
    """Update a workspace"""
    tenant_id = get_current_tenant_id(request)

    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id,
        Workspace.tenant_id == tenant_id,
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if body.name is not None:
        # Check name uniqueness
        existing = db.query(Workspace).filter(
            Workspace.tenant_id == tenant_id,
            Workspace.name == body.name,
            Workspace.id != workspace.id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Workspace name already exists")
        workspace.name = body.name

    if body.description is not None:
        workspace.description = body.description

    if body.owner is not None:
        workspace.owner = body.owner

    db.commit()
    db.refresh(workspace)

    app_count = db.query(func.count(Application.id)).filter(
        Application.workspace_id == workspace.id
    ).scalar()

    return WorkspaceResponse(
        id=str(workspace.id),
        tenant_id=str(workspace.tenant_id),
        name=workspace.name,
        description=workspace.description,
        owner=workspace.owner,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
        application_count=app_count,
    )


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Delete a workspace (applications are unassigned, not deleted)"""
    tenant_id = get_current_tenant_id(request)

    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id,
        Workspace.tenant_id == tenant_id,
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Unassign applications (SET NULL via FK, but explicit for clarity)
    db.query(Application).filter(
        Application.workspace_id == workspace.id
    ).update({Application.workspace_id: None})

    db.delete(workspace)
    db.commit()

    return {"message": "Workspace deleted successfully"}


@router.post("/{workspace_id}/assign", response_model=WorkspaceResponse)
async def assign_applications(
    workspace_id: str,
    request: Request,
    body: WorkspaceAssignRequest,
    db: Session = Depends(get_admin_db),
):
    """Assign applications to a workspace"""
    tenant_id = get_current_tenant_id(request)

    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id,
        Workspace.tenant_id == tenant_id,
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Update applications
    for app_id in body.application_ids:
        app = db.query(Application).filter(
            Application.id == app_id,
            Application.tenant_id == tenant_id,
        ).first()
        if app:
            app.workspace_id = workspace.id

    db.commit()
    db.refresh(workspace)

    app_count = db.query(func.count(Application.id)).filter(
        Application.workspace_id == workspace.id
    ).scalar()

    return WorkspaceResponse(
        id=str(workspace.id),
        tenant_id=str(workspace.tenant_id),
        name=workspace.name,
        description=workspace.description,
        owner=workspace.owner,
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
        application_count=app_count,
    )


@router.post("/{workspace_id}/unassign")
async def unassign_applications(
    workspace_id: str,
    request: Request,
    body: WorkspaceAssignRequest,
    db: Session = Depends(get_admin_db),
):
    """Remove applications from a workspace"""
    tenant_id = get_current_tenant_id(request)

    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id,
        Workspace.tenant_id == tenant_id,
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    for app_id in body.application_ids:
        app = db.query(Application).filter(
            Application.id == app_id,
            Application.tenant_id == tenant_id,
            Application.workspace_id == workspace.id,
        ).first()
        if app:
            app.workspace_id = None

    db.commit()

    return {"message": "Applications unassigned successfully"}


@router.get("/{workspace_id}/applications")
async def list_workspace_applications(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """List applications in a workspace"""
    tenant_id = get_current_tenant_id(request)

    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id,
        Workspace.tenant_id == tenant_id,
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    apps = db.query(Application).filter(
        Application.workspace_id == workspace.id,
        Application.tenant_id == tenant_id,
    ).order_by(Application.created_at.desc()).all()

    return [{
        "id": str(app.id),
        "name": app.name,
        "description": app.description,
        "is_active": app.is_active,
        "source": app.source,
        "external_id": app.external_id,
        "created_at": app.created_at.isoformat() if app.created_at else None,
    } for app in apps]


# ============================================================
# Workspace Guardrail Configuration Endpoints
# ============================================================

def _verify_workspace_ownership(db: Session, workspace_id: str, tenant_id: str) -> Workspace:
    """Verify workspace exists and belongs to tenant"""
    workspace = db.query(Workspace).filter(
        Workspace.id == workspace_id,
        Workspace.tenant_id == tenant_id,
    ).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


# --- Risk Type Config ---

class WorkspaceRiskTypeConfigUpdate(BaseModel):
    s1_enabled: Optional[bool] = None
    s2_enabled: Optional[bool] = None
    s3_enabled: Optional[bool] = None
    s4_enabled: Optional[bool] = None
    s5_enabled: Optional[bool] = None
    s6_enabled: Optional[bool] = None
    s7_enabled: Optional[bool] = None
    s8_enabled: Optional[bool] = None
    s9_enabled: Optional[bool] = None
    s10_enabled: Optional[bool] = None
    s11_enabled: Optional[bool] = None
    s12_enabled: Optional[bool] = None
    s13_enabled: Optional[bool] = None
    s14_enabled: Optional[bool] = None
    s15_enabled: Optional[bool] = None
    s16_enabled: Optional[bool] = None
    s17_enabled: Optional[bool] = None
    s18_enabled: Optional[bool] = None
    s19_enabled: Optional[bool] = None
    s20_enabled: Optional[bool] = None
    s21_enabled: Optional[bool] = None
    high_sensitivity_threshold: Optional[float] = None
    medium_sensitivity_threshold: Optional[float] = None
    low_sensitivity_threshold: Optional[float] = None
    sensitivity_trigger_level: Optional[str] = None


@router.get("/{workspace_id}/config/risk-types")
async def get_workspace_risk_config(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level risk type configuration"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    config = db.query(RiskTypeConfig).filter(
        RiskTypeConfig.workspace_id == workspace_id
    ).first()

    if not config:
        return {f"s{i}_enabled": True for i in range(1, 22)} | {
            "high_sensitivity_threshold": 0.40,
            "medium_sensitivity_threshold": 0.60,
            "low_sensitivity_threshold": 0.95,
            "sensitivity_trigger_level": "medium",
            "exists": False,
        }

    result = {}
    for i in range(1, 22):
        result[f"s{i}_enabled"] = getattr(config, f"s{i}_enabled", True)
    result["high_sensitivity_threshold"] = config.high_sensitivity_threshold or 0.40
    result["medium_sensitivity_threshold"] = config.medium_sensitivity_threshold or 0.60
    result["low_sensitivity_threshold"] = config.low_sensitivity_threshold or 0.95
    result["sensitivity_trigger_level"] = config.sensitivity_trigger_level or "medium"
    result["exists"] = True
    return result


@router.put("/{workspace_id}/config/risk-types")
async def update_workspace_risk_config(
    workspace_id: str,
    request: Request,
    body: WorkspaceRiskTypeConfigUpdate,
    db: Session = Depends(get_admin_db),
):
    """Update workspace-level risk type configuration"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    config = db.query(RiskTypeConfig).filter(
        RiskTypeConfig.workspace_id == workspace_id
    ).first()

    if not config:
        config = RiskTypeConfig(
            tenant_id=uuid.UUID(tenant_id),
            workspace_id=uuid.UUID(workspace_id),
        )
        db.add(config)

    updates = body.dict(exclude_none=True)
    for field, value in updates.items():
        if hasattr(config, field):
            setattr(config, field, value)

    db.commit()
    db.refresh(config)

    result = {}
    for i in range(1, 22):
        result[f"s{i}_enabled"] = getattr(config, f"s{i}_enabled", True)
    result["high_sensitivity_threshold"] = config.high_sensitivity_threshold or 0.40
    result["medium_sensitivity_threshold"] = config.medium_sensitivity_threshold or 0.60
    result["low_sensitivity_threshold"] = config.low_sensitivity_threshold or 0.95
    result["sensitivity_trigger_level"] = config.sensitivity_trigger_level or "medium"
    return result


# --- Blacklist / Whitelist ---

class WorkspaceKeywordListCreate(BaseModel):
    name: str
    keywords: List[str]
    description: Optional[str] = None
    is_active: bool = True

class WorkspaceKeywordListUpdate(BaseModel):
    name: Optional[str] = None
    keywords: Optional[List[str]] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/{workspace_id}/config/blacklist")
async def get_workspace_blacklists(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level blacklists"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    lists = db.query(Blacklist).filter(
        Blacklist.workspace_id == workspace_id,
    ).all()

    return [{
        "id": item.id,
        "name": item.name,
        "keywords": item.keywords,
        "description": item.description,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    } for item in lists]


@router.post("/{workspace_id}/config/blacklist")
async def create_workspace_blacklist(
    workspace_id: str,
    request: Request,
    body: WorkspaceKeywordListCreate,
    db: Session = Depends(get_admin_db),
):
    """Create a workspace-level blacklist"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    item = Blacklist(
        tenant_id=uuid.UUID(tenant_id),
        workspace_id=uuid.UUID(workspace_id),
        name=body.name,
        keywords=body.keywords,
        description=body.description,
        is_active=body.is_active,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    await keyword_cache.invalidate_cache()

    return {
        "id": item.id,
        "name": item.name,
        "keywords": item.keywords,
        "description": item.description,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


@router.put("/{workspace_id}/config/blacklist/{item_id}")
async def update_workspace_blacklist(
    workspace_id: str,
    item_id: int,
    request: Request,
    body: WorkspaceKeywordListUpdate,
    db: Session = Depends(get_admin_db),
):
    """Update a workspace-level blacklist"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    item = db.query(Blacklist).filter(
        Blacklist.id == item_id,
        Blacklist.workspace_id == workspace_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blacklist not found")

    updates = body.dict(exclude_none=True)
    for field, value in updates.items():
        if hasattr(item, field):
            setattr(item, field, value)

    db.commit()
    await keyword_cache.invalidate_cache()
    return {"message": "Updated successfully"}


@router.delete("/{workspace_id}/config/blacklist/{item_id}")
async def delete_workspace_blacklist(
    workspace_id: str,
    item_id: int,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Delete a workspace-level blacklist"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    item = db.query(Blacklist).filter(
        Blacklist.id == item_id,
        Blacklist.workspace_id == workspace_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blacklist not found")

    item.is_active = False
    db.commit()
    await keyword_cache.invalidate_cache()
    return {"message": "Deleted successfully"}


@router.get("/{workspace_id}/config/whitelist")
async def get_workspace_whitelists(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level whitelists"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    lists = db.query(Whitelist).filter(
        Whitelist.workspace_id == workspace_id,
    ).all()

    return [{
        "id": item.id,
        "name": item.name,
        "keywords": item.keywords,
        "description": item.description,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    } for item in lists]


@router.post("/{workspace_id}/config/whitelist")
async def create_workspace_whitelist(
    workspace_id: str,
    request: Request,
    body: WorkspaceKeywordListCreate,
    db: Session = Depends(get_admin_db),
):
    """Create a workspace-level whitelist"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    item = Whitelist(
        tenant_id=uuid.UUID(tenant_id),
        workspace_id=uuid.UUID(workspace_id),
        name=body.name,
        keywords=body.keywords,
        description=body.description,
        is_active=body.is_active,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    await keyword_cache.invalidate_cache()

    return {
        "id": item.id,
        "name": item.name,
        "keywords": item.keywords,
        "description": item.description,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


@router.put("/{workspace_id}/config/whitelist/{item_id}")
async def update_workspace_whitelist(
    workspace_id: str,
    item_id: int,
    request: Request,
    body: WorkspaceKeywordListUpdate,
    db: Session = Depends(get_admin_db),
):
    """Update a workspace-level whitelist"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    item = db.query(Whitelist).filter(
        Whitelist.id == item_id,
        Whitelist.workspace_id == workspace_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Whitelist not found")

    updates = body.dict(exclude_none=True)
    for field, value in updates.items():
        if hasattr(item, field):
            setattr(item, field, value)

    db.commit()
    await keyword_cache.invalidate_cache()
    return {"message": "Updated successfully"}


@router.delete("/{workspace_id}/config/whitelist/{item_id}")
async def delete_workspace_whitelist(
    workspace_id: str,
    item_id: int,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Delete a workspace-level whitelist"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    item = db.query(Whitelist).filter(
        Whitelist.id == item_id,
        Whitelist.workspace_id == workspace_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Whitelist not found")

    item.is_active = False
    db.commit()
    await keyword_cache.invalidate_cache()
    return {"message": "Deleted successfully"}


# --- Ban Policy ---

class WorkspaceBanPolicyUpdate(BaseModel):
    enabled: bool = False
    risk_level: str = "high_risk"
    trigger_count: int = 3
    time_window_minutes: int = 10
    ban_duration_minutes: int = 60


@router.get("/{workspace_id}/config/ban-policy")
async def get_workspace_ban_policy(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level ban policy"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    policy = db.query(BanPolicy).filter(
        BanPolicy.workspace_id == workspace_id
    ).first()

    if not policy:
        return {
            "enabled": False,
            "risk_level": "high_risk",
            "trigger_count": 3,
            "time_window_minutes": 10,
            "ban_duration_minutes": 60,
            "exists": False,
        }

    return {
        "enabled": policy.enabled,
        "risk_level": policy.risk_level,
        "trigger_count": policy.trigger_count,
        "time_window_minutes": policy.time_window_minutes,
        "ban_duration_minutes": policy.ban_duration_minutes,
        "exists": True,
    }


@router.put("/{workspace_id}/config/ban-policy")
async def update_workspace_ban_policy(
    workspace_id: str,
    request: Request,
    body: WorkspaceBanPolicyUpdate,
    db: Session = Depends(get_admin_db),
):
    """Update workspace-level ban policy"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    policy = db.query(BanPolicy).filter(
        BanPolicy.workspace_id == workspace_id
    ).first()

    if not policy:
        policy = BanPolicy(
            tenant_id=uuid.UUID(tenant_id),
            workspace_id=uuid.UUID(workspace_id),
            enabled=body.enabled,
            risk_level=body.risk_level,
            trigger_count=body.trigger_count,
            time_window_minutes=body.time_window_minutes,
            ban_duration_minutes=body.ban_duration_minutes,
        )
        db.add(policy)
    else:
        policy.enabled = body.enabled
        policy.risk_level = body.risk_level
        policy.trigger_count = body.trigger_count
        policy.time_window_minutes = body.time_window_minutes
        policy.ban_duration_minutes = body.ban_duration_minutes

    db.commit()
    return {
        "enabled": policy.enabled,
        "risk_level": policy.risk_level,
        "trigger_count": policy.trigger_count,
        "time_window_minutes": policy.time_window_minutes,
        "ban_duration_minutes": policy.ban_duration_minutes,
    }


# --- Data Masking Policy ---

class WorkspaceDataLeakagePolicyUpdate(BaseModel):
    input_high_risk_action: Optional[str] = None
    input_medium_risk_action: Optional[str] = None
    input_low_risk_action: Optional[str] = None
    output_high_risk_action: Optional[str] = None
    output_medium_risk_action: Optional[str] = None
    output_low_risk_action: Optional[str] = None
    general_input_high_risk_action: Optional[str] = None
    general_input_medium_risk_action: Optional[str] = None
    general_input_low_risk_action: Optional[str] = None
    general_output_high_risk_action: Optional[str] = None
    general_output_medium_risk_action: Optional[str] = None
    general_output_low_risk_action: Optional[str] = None
    private_model_id: Optional[str] = None
    enable_format_detection: Optional[bool] = None
    enable_smart_segmentation: Optional[bool] = None


@router.get("/{workspace_id}/config/data-leakage-policy")
async def get_workspace_data_leakage_policy(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level data masking policy"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    policy = db.query(ApplicationDataLeakagePolicy).filter(
        ApplicationDataLeakagePolicy.workspace_id == workspace_id,
        ApplicationDataLeakagePolicy.application_id.is_(None),
    ).first()

    if not policy:
        return {"exists": False}

    return {
        "exists": True,
        "input_high_risk_action": policy.input_high_risk_action,
        "input_medium_risk_action": policy.input_medium_risk_action,
        "input_low_risk_action": policy.input_low_risk_action,
        "output_high_risk_action": policy.output_high_risk_action,
        "output_medium_risk_action": policy.output_medium_risk_action,
        "output_low_risk_action": policy.output_low_risk_action,
        "general_input_high_risk_action": policy.general_input_high_risk_action,
        "general_input_medium_risk_action": policy.general_input_medium_risk_action,
        "general_input_low_risk_action": policy.general_input_low_risk_action,
        "general_output_high_risk_action": policy.general_output_high_risk_action,
        "general_output_medium_risk_action": policy.general_output_medium_risk_action,
        "general_output_low_risk_action": policy.general_output_low_risk_action,
        "private_model_id": str(policy.private_model_id) if policy.private_model_id else None,
        "enable_format_detection": policy.enable_format_detection,
        "enable_smart_segmentation": policy.enable_smart_segmentation,
    }


@router.put("/{workspace_id}/config/data-leakage-policy")
async def update_workspace_data_leakage_policy(
    workspace_id: str,
    request: Request,
    body: WorkspaceDataLeakagePolicyUpdate,
    db: Session = Depends(get_admin_db),
):
    """Update workspace-level data masking policy"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    policy = db.query(ApplicationDataLeakagePolicy).filter(
        ApplicationDataLeakagePolicy.workspace_id == workspace_id,
        ApplicationDataLeakagePolicy.application_id.is_(None),
    ).first()

    if not policy:
        policy = ApplicationDataLeakagePolicy(
            tenant_id=uuid.UUID(tenant_id),
            workspace_id=uuid.UUID(workspace_id),
        )
        db.add(policy)

    updates = body.dict(exclude_none=True)
    if "private_model_id" in updates:
        val = updates.pop("private_model_id")
        policy.private_model_id = uuid.UUID(val) if val else None
    for field, value in updates.items():
        if hasattr(policy, field):
            setattr(policy, field, value)

    db.commit()
    return {"message": "Updated successfully"}


# --- Scanner Configs ---

class WorkspaceScannerConfigUpdate(BaseModel):
    scanner_id: str
    is_enabled: Optional[bool] = None
    risk_level: Optional[str] = None
    scan_prompt: Optional[bool] = None
    scan_response: Optional[bool] = None


class WorkspaceScannerConfigBulkUpdate(BaseModel):
    configs: List[WorkspaceScannerConfigUpdate]


@router.get("/{workspace_id}/config/scanners")
async def get_workspace_scanner_configs(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level scanner configurations"""
    tenant_id = get_current_tenant_id(request)
    workspace = _verify_workspace_ownership(db, workspace_id, tenant_id)

    # Get available scanners (built-in + purchased)
    from services.scanner_config_service import ScannerConfigService
    svc = ScannerConfigService(db)
    available_scanners = svc._get_available_scanners(uuid.UUID(tenant_id))

    # Get workspace configs
    configs = db.query(ApplicationScannerConfig).filter(
        ApplicationScannerConfig.workspace_id == workspace_id,
        ApplicationScannerConfig.application_id.is_(None),
    ).all()
    config_map = {str(c.scanner_id): c for c in configs}

    result = []
    for scanner in available_scanners:
        config = config_map.get(str(scanner.id))
        is_enabled = config.is_enabled if config else True
        risk_level = config.risk_level_override if config and config.risk_level_override else scanner.default_risk_level
        scan_prompt = config.scan_prompt_override if config and config.scan_prompt_override is not None else scanner.default_scan_prompt
        scan_response = config.scan_response_override if config and config.scan_response_override is not None else scanner.default_scan_response

        result.append({
            "id": str(scanner.id),
            "tag": scanner.tag,
            "name": scanner.name,
            "description": scanner.description,
            "scanner_type": scanner.scanner_type,
            "package_name": scanner.package.package_name if scanner.package else "Custom",
            "is_enabled": is_enabled,
            "risk_level": risk_level,
            "scan_prompt": scan_prompt,
            "scan_response": scan_response,
            "default_risk_level": scanner.default_risk_level,
            "default_scan_prompt": scanner.default_scan_prompt,
            "default_scan_response": scanner.default_scan_response,
            "has_override": config is not None,
        })

    return result


@router.put("/{workspace_id}/config/scanners")
async def update_workspace_scanner_configs(
    workspace_id: str,
    request: Request,
    body: WorkspaceScannerConfigBulkUpdate,
    db: Session = Depends(get_admin_db),
):
    """Bulk update workspace-level scanner configurations"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    ws_uuid = uuid.UUID(workspace_id)
    for item in body.configs:
        scanner_uuid = uuid.UUID(item.scanner_id)

        config = db.query(ApplicationScannerConfig).filter(
            ApplicationScannerConfig.workspace_id == ws_uuid,
            ApplicationScannerConfig.scanner_id == scanner_uuid,
            ApplicationScannerConfig.application_id.is_(None),
        ).first()

        if not config:
            config = ApplicationScannerConfig(
                workspace_id=ws_uuid,
                scanner_id=scanner_uuid,
            )
            db.add(config)

        if item.is_enabled is not None:
            config.is_enabled = item.is_enabled
        if item.risk_level is not None:
            config.risk_level_override = item.risk_level
        if item.scan_prompt is not None:
            config.scan_prompt_override = item.scan_prompt
        if item.scan_response is not None:
            config.scan_response_override = item.scan_response

    db.commit()
    return {"message": "Updated successfully"}


# --- Fixed Answer Templates ---

DEFAULT_TEMPLATES = {
    "security_risk_template": {
        "en": "Request blocked by OpenGuardrails due to possible violation of policy related to {guardrail_name}.",
        "zh": "请求已被OpenGuardrails拦截，原因：可能违反了与{guardrail_name}有关的策略要求。"
    },
    "data_leakage_template": {
        "en": "Request blocked by OpenGuardrails due to possible sensitive data ({entity_type_names}).",
        "zh": "请求已被OpenGuardrails拦截，原因：可能包含敏感数据（{entity_type_names}）。"
    }
}


@router.get("/{workspace_id}/config/fixed-answer-templates")
async def get_workspace_fixed_answer_templates(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Get workspace-level fixed answer templates"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    settings = db.query(ApplicationSettings).filter(
        ApplicationSettings.workspace_id == workspace_id,
        ApplicationSettings.application_id.is_(None),
    ).first()

    if settings:
        return {
            "security_risk_template": settings.security_risk_template or DEFAULT_TEMPLATES["security_risk_template"],
            "data_leakage_template": settings.data_leakage_template or DEFAULT_TEMPLATES["data_leakage_template"],
        }
    return DEFAULT_TEMPLATES


@router.put("/{workspace_id}/config/fixed-answer-templates")
async def update_workspace_fixed_answer_templates(
    workspace_id: str,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Update workspace-level fixed answer templates"""
    tenant_id = get_current_tenant_id(request)
    _verify_workspace_ownership(db, workspace_id, tenant_id)

    body = await request.json()

    settings = db.query(ApplicationSettings).filter(
        ApplicationSettings.workspace_id == workspace_id,
        ApplicationSettings.application_id.is_(None),
    ).first()

    if not settings:
        settings = ApplicationSettings(
            tenant_id=uuid.UUID(tenant_id),
            workspace_id=uuid.UUID(workspace_id),
            security_risk_template=DEFAULT_TEMPLATES["security_risk_template"],
            data_leakage_template=DEFAULT_TEMPLATES["data_leakage_template"],
        )
        db.add(settings)

    if "security_risk_template" in body:
        existing = dict(settings.security_risk_template or DEFAULT_TEMPLATES["security_risk_template"])
        if isinstance(body["security_risk_template"], dict):
            existing.update(body["security_risk_template"])
        else:
            existing = body["security_risk_template"]
        settings.security_risk_template = existing

    if "data_leakage_template" in body:
        existing = dict(settings.data_leakage_template or DEFAULT_TEMPLATES["data_leakage_template"])
        if isinstance(body["data_leakage_template"], dict):
            existing.update(body["data_leakage_template"])
        else:
            existing = body["data_leakage_template"]
        settings.data_leakage_template = existing

    db.commit()
    return {"success": True, "message": "Fixed answer templates updated successfully"}
