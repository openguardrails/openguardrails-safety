from typing import List, Optional, Tuple
import json
import uuid
from pathlib import Path
from io import BytesIO
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, text, cast
from sqlalchemy.dialects.postgresql import JSONB
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from database.connection import get_admin_db
from database.models import DetectionResult, Tenant, Application, Workspace
from models.responses import DetectionResultResponse, PaginatedResponse
from utils.logger import setup_logger
from utils.url_signature import generate_signed_media_url
from config import settings

logger = setup_logger()
router = APIRouter(tags=["Results"])

def get_current_tenant(request: Request, db: Session) -> Tenant:
    """Get current tenant from request context"""
    auth_context = getattr(request.state, 'auth_context', None)
    if not auth_context or 'data' not in auth_context:
        raise HTTPException(status_code=401, detail="Not authenticated")

    data = auth_context['data']
    tenant_id = data.get('tenant_id')
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Tenant ID not found in auth context")

    try:
        tenant_uuid = uuid.UUID(str(tenant_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant ID format")

    tenant = db.query(Tenant).filter(Tenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    return tenant


def _build_app_workspace_cache(db: Session, tenant_id) -> dict:
    """Build a lookup cache for application names and workspace info"""
    apps = db.query(Application).filter(Application.tenant_id == str(tenant_id)).all()
    workspaces = db.query(Workspace).filter(Workspace.tenant_id == str(tenant_id)).all()

    ws_map = {str(ws.id): ws for ws in workspaces}
    app_map = {}
    for app in apps:
        ws_id = str(app.workspace_id) if getattr(app, 'workspace_id', None) else None
        ws = ws_map.get(ws_id) if ws_id else None
        app_map[str(app.id)] = {
            "application_name": app.name,
            "workspace_id": ws_id,
            "workspace_name": ws.name if ws else None,
        }
    return app_map


def _enrich_result(result, app_map: dict, image_urls: list, truncate_content: bool = True) -> DetectionResultResponse:
    """Convert a DetectionResult to DetectionResultResponse with app/workspace info"""
    app_id_str = str(result.application_id) if result.application_id else None
    app_info = app_map.get(app_id_str, {}) if app_id_str else {}

    content = result.content
    if truncate_content and len(content) > 200:
        content = content[:200] + "..."

    return DetectionResultResponse(
        id=result.id,
        request_id=result.request_id,
        content=content,
        suggest_action=result.suggest_action,
        suggest_answer=result.suggest_answer,
        hit_keywords=result.hit_keywords,
        created_at=result.created_at,
        ip_address=result.ip_address,
        security_risk_level=result.security_risk_level,
        security_categories=result.security_categories,
        compliance_risk_level=result.compliance_risk_level,
        compliance_categories=result.compliance_categories,
        data_risk_level=result.data_risk_level if hasattr(result, 'data_risk_level') else "no_risk",
        data_categories=result.data_categories if hasattr(result, 'data_categories') else [],
        has_image=result.has_image if hasattr(result, 'has_image') else False,
        image_count=result.image_count if hasattr(result, 'image_count') else 0,
        image_paths=result.image_paths if hasattr(result, 'image_paths') else [],
        image_urls=image_urls,
        is_direct_model_access=result.is_direct_model_access if hasattr(result, 'is_direct_model_access') else False,
        application_id=app_id_str,
        application_name=app_info.get("application_name"),
        workspace_id=app_info.get("workspace_id"),
        workspace_name=app_info.get("workspace_name"),
    )


def _generate_image_urls(result) -> list:
    """Generate signed image URLs for a detection result"""
    image_urls = []
    if hasattr(result, 'image_paths') and result.image_paths:
        for image_path in result.image_paths:
            try:
                path_parts = Path(image_path).parts
                filename = path_parts[-1]
                extracted_tenant_id = path_parts[-2]
                signed_url = generate_signed_media_url(
                    tenant_id=extracted_tenant_id,
                    filename=filename,
                    expires_in_seconds=86400
                )
                image_urls.append(signed_url)
            except Exception as e:
                logger.error(f"Failed to generate signed URL for {image_path}: {e}")
    return image_urls


def _build_common_filters(
    tenant_id,
    application_id: Optional[str],
    workspace_id: Optional[str],
    risk_level: Optional[str],
    security_risk_level: Optional[str],
    compliance_risk_level: Optional[str],
    data_risk_level: Optional[str],
    category: Optional[str],
    data_entity_type: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    content_search: Optional[str],
    request_id_search: Optional[str],
    db: Session,
) -> list:
    """Build common query filters for detection results"""
    filters = []

    # Tenant-level filter: show ALL results for this tenant
    filters.append(DetectionResult.tenant_id == str(tenant_id))

    # Optional application filter
    if application_id:
        filters.append(DetectionResult.application_id == application_id)

    # Optional workspace filter: find all apps in this workspace, filter by those app IDs
    if workspace_id:
        app_ids = db.query(Application.id).filter(
            Application.workspace_id == workspace_id,
            Application.tenant_id == str(tenant_id),
        ).all()
        app_id_list = [str(a[0]) for a in app_ids]
        if app_id_list:
            filters.append(DetectionResult.application_id.in_(app_id_list))
        else:
            # No apps in workspace, return empty
            filters.append(DetectionResult.id == -1)

    # Risk level filters
    if risk_level:
        if risk_level == "no_risk":
            filters.append(and_(
                DetectionResult.security_risk_level == "no_risk",
                DetectionResult.compliance_risk_level == "no_risk",
                DetectionResult.data_risk_level == "no_risk"
            ))
        elif risk_level == "any_risk":
            filters.append(or_(
                DetectionResult.security_risk_level != "no_risk",
                DetectionResult.compliance_risk_level != "no_risk",
                DetectionResult.data_risk_level != "no_risk"
            ))
        else:
            filters.append(or_(
                DetectionResult.security_risk_level == risk_level,
                DetectionResult.compliance_risk_level == risk_level,
                DetectionResult.data_risk_level == risk_level
            ))

    if security_risk_level:
        if security_risk_level == "any_risk":
            filters.append(DetectionResult.security_risk_level != "no_risk")
        else:
            filters.append(DetectionResult.security_risk_level == security_risk_level)

    if compliance_risk_level:
        if compliance_risk_level == "any_risk":
            filters.append(DetectionResult.compliance_risk_level != "no_risk")
        else:
            filters.append(DetectionResult.compliance_risk_level == compliance_risk_level)

    if data_risk_level:
        if data_risk_level == "any_risk":
            filters.append(DetectionResult.data_risk_level != "no_risk")
        else:
            filters.append(DetectionResult.data_risk_level == data_risk_level)

    if category:
        filters.append(or_(
            cast(DetectionResult.security_categories, JSONB).contains([category]),
            cast(DetectionResult.compliance_categories, JSONB).contains([category]),
            cast(DetectionResult.data_categories, JSONB).contains([category])
        ))

    if data_entity_type:
        filters.append(cast(DetectionResult.data_categories, JSONB).contains([data_entity_type]))

    if start_date:
        filters.append(DetectionResult.created_at >= start_date + ' 00:00:00')

    if end_date:
        filters.append(DetectionResult.created_at <= end_date + ' 23:59:59')

    if content_search:
        filters.append(DetectionResult.content.like(f'%{content_search}%'))

    if request_id_search:
        filters.append(DetectionResult.request_id.like(f'%{request_id_search}%'))

    return filters


@router.get("/results")
async def get_detection_results(
    request: Request,
    db: Session = Depends(get_admin_db),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    application_id: Optional[str] = Query(None, description="Filter by application ID"),
    workspace_id: Optional[str] = Query(None, description="Filter by workspace ID"),
    risk_level: Optional[str] = Query(None),
    security_risk_level: Optional[str] = Query(None),
    compliance_risk_level: Optional[str] = Query(None),
    data_risk_level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    data_entity_type: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    content_search: Optional[str] = Query(None),
    request_id_search: Optional[str] = Query(None),
):
    """Get detection results (global view - all applications for current tenant)"""
    try:
        current_user = get_current_tenant(request, db)

        filters = _build_common_filters(
            tenant_id=current_user.id,
            application_id=application_id,
            workspace_id=workspace_id,
            risk_level=risk_level,
            security_risk_level=security_risk_level,
            compliance_risk_level=compliance_risk_level,
            data_risk_level=data_risk_level,
            category=category,
            data_entity_type=data_entity_type,
            start_date=start_date,
            end_date=end_date,
            content_search=content_search,
            request_id_search=request_id_search,
            db=db,
        )

        base_query = db.query(DetectionResult).filter(and_(*filters))
        total = base_query.count()

        offset = (page - 1) * per_page
        results = base_query.order_by(
            DetectionResult.created_at.desc()
        ).offset(offset).limit(per_page).all()

        # Build app/workspace lookup cache
        app_map = _build_app_workspace_cache(db, current_user.id)

        items = []
        for result in results:
            image_urls = _generate_image_urls(result)
            items.append(_enrich_result(result, app_map, image_urls, truncate_content=True))

        pages = (total + per_page - 1) // per_page

        return PaginatedResponse(
            items=items,
            total=total,
            page=page,
            per_page=per_page,
            pages=pages
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get detection results error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get detection results")

@router.get("/results/export")
async def export_detection_results(
    request: Request,
    db: Session = Depends(get_admin_db),
    application_id: Optional[str] = Query(None, description="Filter by application ID"),
    workspace_id: Optional[str] = Query(None, description="Filter by workspace ID"),
    risk_level: Optional[str] = Query(None),
    security_risk_level: Optional[str] = Query(None),
    compliance_risk_level: Optional[str] = Query(None),
    data_risk_level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    data_entity_type: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    content_search: Optional[str] = Query(None),
    request_id_search: Optional[str] = Query(None),
):
    """Export detection results to Excel"""
    try:
        current_user = get_current_tenant(request, db)

        filters = _build_common_filters(
            tenant_id=current_user.id,
            application_id=application_id,
            workspace_id=workspace_id,
            risk_level=risk_level,
            security_risk_level=security_risk_level,
            compliance_risk_level=compliance_risk_level,
            data_risk_level=data_risk_level,
            category=category,
            data_entity_type=data_entity_type,
            start_date=start_date,
            end_date=end_date,
            content_search=content_search,
            request_id_search=request_id_search,
            db=db,
        )

        base_query = db.query(DetectionResult).filter(and_(*filters))
        results = base_query.order_by(
            DetectionResult.created_at.desc()
        ).limit(10000).all()

        # Build app/workspace lookup cache
        app_map = _build_app_workspace_cache(db, current_user.id)

        # Create Excel workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Detection Results"

        headers = [
            "Request ID",
            "Application",
            "Workspace",
            "Detection Content",
            "Prompt Attack Risk",
            "Prompt Attack Categories",
            "Content Compliance Risk",
            "Content Compliance Categories",
            "Data Leak Risk",
            "Data Leak Categories",
            "Suggested Action",
            "Suggested Answer",
            "Hit Keywords",
            "Has Image",
            "Image Count",
            "IP Address",
            "Detection Time"
        ]

        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True)

        for col_num, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_num, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        for row_num, result in enumerate(results, 2):
            app_id_str = str(result.application_id) if result.application_id else None
            app_info = app_map.get(app_id_str, {}) if app_id_str else {}

            ws.cell(row=row_num, column=1, value=result.request_id)
            ws.cell(row=row_num, column=2, value=app_info.get("application_name", ""))
            ws.cell(row=row_num, column=3, value=app_info.get("workspace_name", ""))
            ws.cell(row=row_num, column=4, value=result.content)
            ws.cell(row=row_num, column=5, value=result.security_risk_level or "no_risk")
            ws.cell(row=row_num, column=6, value=", ".join(result.security_categories or []))
            ws.cell(row=row_num, column=7, value=result.compliance_risk_level or "no_risk")
            ws.cell(row=row_num, column=8, value=", ".join(result.compliance_categories or []))
            ws.cell(row=row_num, column=9, value=result.data_risk_level or "no_risk")
            ws.cell(row=row_num, column=10, value=", ".join(result.data_categories or []))
            ws.cell(row=row_num, column=11, value=result.suggest_action)
            ws.cell(row=row_num, column=12, value=result.suggest_answer or "")
            ws.cell(row=row_num, column=13, value=", ".join(result.hit_keywords or []))
            ws.cell(row=row_num, column=14, value="Yes" if (hasattr(result, 'has_image') and result.has_image) else "No")
            ws.cell(row=row_num, column=15, value=result.image_count if hasattr(result, 'image_count') else 0)
            ws.cell(row=row_num, column=16, value=result.ip_address or "")
            ws.cell(row=row_num, column=17, value=result.created_at.strftime('%Y-%m-%d %H:%M:%S') if result.created_at else "")

        column_widths = [30, 20, 20, 50, 20, 30, 20, 30, 20, 30, 15, 50, 30, 12, 12, 15, 20]
        for col_num, width in enumerate(column_widths, 1):
            ws.column_dimensions[ws.cell(row=1, column=col_num).column_letter].width = width

        excel_file = BytesIO()
        wb.save(excel_file)
        excel_file.seek(0)

        filename = f"detection_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

        return StreamingResponse(
            excel_file,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Export detection results error: {e}")
        raise HTTPException(status_code=500, detail="Failed to export detection results")

@router.get("/results/{result_id}", response_model=DetectionResultResponse)
async def get_detection_result(result_id: int, request: Request, db: Session = Depends(get_admin_db)):
    """Get single detection result detail (tenant-scoped)"""
    try:
        current_user = get_current_tenant(request, db)

        result = db.query(DetectionResult).filter_by(id=result_id).first()
        if not result:
            raise HTTPException(status_code=404, detail="Detection result not found")

        # Permission check: must belong to current tenant
        if str(result.tenant_id) != str(current_user.id):
            raise HTTPException(status_code=403, detail="Forbidden")

        app_map = _build_app_workspace_cache(db, current_user.id)
        image_urls = _generate_image_urls(result)

        return _enrich_result(result, app_map, image_urls, truncate_content=False)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get detection result error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get detection result")
