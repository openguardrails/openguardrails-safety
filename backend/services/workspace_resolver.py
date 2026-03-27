"""
Workspace Resolver - resolves workspace_id from application_id.

All configuration lives at workspace level. This utility provides
the mapping from application_id to workspace_id for detection services.
"""

from typing import Optional
from sqlalchemy.orm import Session
from database.models import Application, Workspace
from utils.logger import setup_logger

logger = setup_logger()

# In-memory cache for app → workspace mapping (refreshed per-request via DB session)
_app_workspace_cache = {}


def get_workspace_id_for_app(db: Session, application_id: str) -> Optional[str]:
    """Get workspace_id for an application.

    All applications should have a workspace (global workspace for unassigned apps).
    Returns None only if the application doesn't exist.
    """
    if not application_id:
        return None

    try:
        app = db.query(Application.workspace_id).filter(
            Application.id == application_id
        ).first()

        if app and app.workspace_id:
            return str(app.workspace_id)

        logger.warning(f"Application {application_id} has no workspace_id")
        return None
    except Exception as e:
        logger.error(f"Failed to resolve workspace for app {application_id}: {e}")
        return None


def get_global_workspace_id(db: Session, tenant_id: str) -> Optional[str]:
    """Get the global workspace for a tenant."""
    if not tenant_id:
        return None

    try:
        ws = db.query(Workspace.id).filter(
            Workspace.tenant_id == tenant_id,
            Workspace.is_global == True
        ).first()

        if ws:
            return str(ws.id)

        logger.warning(f"No global workspace found for tenant {tenant_id}")
        return None
    except Exception as e:
        logger.error(f"Failed to get global workspace for tenant {tenant_id}: {e}")
        return None


def ensure_global_workspace(db: Session, tenant_id: str) -> str:
    """Ensure a global workspace exists for the tenant, create if missing.
    Returns the global workspace ID."""
    import uuid as uuid_mod

    existing = get_global_workspace_id(db, tenant_id)
    if existing:
        return existing

    ws = Workspace(
        tenant_id=uuid_mod.UUID(str(tenant_id)),
        name="Global",
        description="Default global workspace",
        is_global=True,
    )
    db.add(ws)
    db.flush()
    logger.info(f"Created global workspace {ws.id} for tenant {tenant_id}")
    return str(ws.id)
