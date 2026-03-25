import time
import asyncio
from typing import List, Tuple, Optional, Dict, Set
from sqlalchemy.orm import Session
from database.models import Blacklist, Whitelist, Application
from database.connection import get_db_session
from utils.logger import setup_logger

logger = setup_logger()

class KeywordCache:
    """High-performance keyword cache service (application + workspace scoped)"""

    def __init__(self, cache_ttl: int = 300):  # 5 minutes cache
        # Multi-application cache structure:
        # Blacklist: {application_id: {list_name: {keyword1, keyword2, ...}}}
        # Whitelist: {application_id: {list_name: {keyword1, keyword2, ...}}}
        self._blacklist_cache: Dict[str, Dict[str, Set[str]]] = {}
        self._whitelist_cache: Dict[str, Dict[str, Set[str]]] = {}
        # Workspace-level caches: {workspace_id: {list_name: {keyword1, keyword2, ...}}}
        self._workspace_blacklist_cache: Dict[str, Dict[str, Set[str]]] = {}
        self._workspace_whitelist_cache: Dict[str, Dict[str, Set[str]]] = {}
        # App → workspace mapping: {application_id: workspace_id}
        self._app_workspace_map: Dict[str, str] = {}
        self._cache_timestamp = 0
        self._cache_ttl = cache_ttl
        self._lock = asyncio.Lock()

    def _get_merged_lists(self, app_cache: Dict[str, Dict[str, Set[str]]], ws_cache: Dict[str, Dict[str, Set[str]]], cache_key: str) -> Dict[str, Set[str]]:
        """Merge application-level and workspace-level keyword lists"""
        merged: Dict[str, Set[str]] = {}
        # Add workspace-level lists first
        workspace_id = self._app_workspace_map.get(str(cache_key))
        if workspace_id:
            ws_lists = ws_cache.get(workspace_id, {})
            for name, keywords in ws_lists.items():
                merged[f"[ws]{name}"] = keywords
        # Add app-level lists (these take precedence in iteration order)
        app_lists = app_cache.get(str(cache_key), {})
        merged.update(app_lists)
        return merged

    async def check_blacklist(self, content: str, tenant_id: Optional[str] = None, application_id: Optional[str] = None) -> Tuple[bool, Optional[str], List[str]]:
        """
        Check blacklist (memory cache version, includes workspace-level lists)

        Args:
            content: Content to check
            tenant_id: DEPRECATED - kept for backward compatibility
            application_id: Application ID to check keywords for
        """
        await self._ensure_cache_fresh()

        cache_key = application_id if application_id else tenant_id
        if not cache_key:
            return False, None, []

        content_lower = content.lower()

        # Merge app-level and workspace-level blacklists
        all_blacklists = self._get_merged_lists(self._blacklist_cache, self._workspace_blacklist_cache, cache_key)
        for list_name, keywords in all_blacklists.items():
            matched_keywords = []
            for keyword in keywords:
                if keyword in content_lower:
                    matched_keywords.append(keyword)
            if matched_keywords:
                display_name = list_name.replace("[ws]", "") if list_name.startswith("[ws]") else list_name
                logger.info(f"Blacklist hit: {display_name}, keywords: {matched_keywords}, application_id: {cache_key}")
                return True, display_name, matched_keywords

        return False, None, []

    async def check_whitelist(self, content: str, tenant_id: Optional[str] = None, application_id: Optional[str] = None) -> Tuple[bool, Optional[str], List[str]]:
        """
        Check whitelist (memory cache version, includes workspace-level lists)

        Args:
            content: Content to check
            tenant_id: DEPRECATED - kept for backward compatibility
            application_id: Application ID to check keywords for
        """
        await self._ensure_cache_fresh()

        cache_key = application_id if application_id else tenant_id
        if not cache_key:
            return False, None, []

        content_lower = content.lower()

        # Merge app-level and workspace-level whitelists
        all_whitelists = self._get_merged_lists(self._whitelist_cache, self._workspace_whitelist_cache, cache_key)
        for list_name, keywords in all_whitelists.items():
            matched_keywords = []
            for keyword in keywords:
                if keyword in content_lower:
                    matched_keywords.append(keyword)
            if matched_keywords:
                display_name = list_name.replace("[ws]", "") if list_name.startswith("[ws]") else list_name
                logger.info(f"Whitelist hit: {display_name}, keywords: {matched_keywords}, application_id: {cache_key}")
                return True, display_name, matched_keywords

        return False, None, []
    
    async def _ensure_cache_fresh(self):
        """Ensure cache is fresh"""
        current_time = time.time()
        
        if current_time - self._cache_timestamp > self._cache_ttl:
            async with self._lock:
                # Double check lock
                if current_time - self._cache_timestamp > self._cache_ttl:
                    await self._refresh_cache()
    
    async def _refresh_cache(self):
        """Refresh cache (application + workspace scoped)"""
        try:
            db = get_db_session()
            try:
                # Load app → workspace mapping
                new_app_ws_map: Dict[str, str] = {}
                apps = db.query(Application.id, Application.workspace_id).filter(
                    Application.workspace_id.isnot(None)
                ).all()
                for app in apps:
                    new_app_ws_map[str(app.id)] = str(app.workspace_id)

                # Load blacklist (grouped by application_id or workspace_id)
                blacklists = db.query(Blacklist).filter_by(is_active=True).all()
                new_blacklist_cache: Dict[str, Dict[str, Set[str]]] = {}
                new_ws_blacklist_cache: Dict[str, Dict[str, Set[str]]] = {}
                for blacklist in blacklists:
                    keywords = blacklist.keywords if isinstance(blacklist.keywords, list) else []
                    keyword_set = {keyword.lower() for keyword in keywords if keyword}
                    if not keyword_set:
                        continue

                    if blacklist.application_id:
                        app_id_str = str(blacklist.application_id)
                        if app_id_str not in new_blacklist_cache:
                            new_blacklist_cache[app_id_str] = {}
                        new_blacklist_cache[app_id_str][blacklist.name] = keyword_set
                    elif blacklist.workspace_id:
                        ws_id_str = str(blacklist.workspace_id)
                        if ws_id_str not in new_ws_blacklist_cache:
                            new_ws_blacklist_cache[ws_id_str] = {}
                        new_ws_blacklist_cache[ws_id_str][blacklist.name] = keyword_set
                    else:
                        logger.warning(f"Blacklist {blacklist.id} has no application_id or workspace_id, skipping")

                # Load whitelist (grouped by application_id or workspace_id)
                whitelists = db.query(Whitelist).filter_by(is_active=True).all()
                new_whitelist_cache: Dict[str, Dict[str, Set[str]]] = {}
                new_ws_whitelist_cache: Dict[str, Dict[str, Set[str]]] = {}
                for whitelist in whitelists:
                    keywords = whitelist.keywords if isinstance(whitelist.keywords, list) else []
                    keyword_set = {keyword.lower() for keyword in keywords if keyword}
                    if not keyword_set:
                        continue

                    if whitelist.application_id:
                        app_id_str = str(whitelist.application_id)
                        if app_id_str not in new_whitelist_cache:
                            new_whitelist_cache[app_id_str] = {}
                        new_whitelist_cache[app_id_str][whitelist.name] = keyword_set
                    elif whitelist.workspace_id:
                        ws_id_str = str(whitelist.workspace_id)
                        if ws_id_str not in new_ws_whitelist_cache:
                            new_ws_whitelist_cache[ws_id_str] = {}
                        new_ws_whitelist_cache[ws_id_str][whitelist.name] = keyword_set
                    else:
                        logger.warning(f"Whitelist {whitelist.id} has no application_id or workspace_id, skipping")

                # Atomic update all caches
                self._blacklist_cache = new_blacklist_cache
                self._whitelist_cache = new_whitelist_cache
                self._workspace_blacklist_cache = new_ws_blacklist_cache
                self._workspace_whitelist_cache = new_ws_whitelist_cache
                self._app_workspace_map = new_app_ws_map
                self._cache_timestamp = time.time()

                blacklist_list_count = sum(len(lists) for lists in new_blacklist_cache.values())
                whitelist_list_count = sum(len(lists) for lists in new_whitelist_cache.values())
                ws_bl_count = sum(len(lists) for lists in new_ws_blacklist_cache.values())
                ws_wl_count = sum(len(lists) for lists in new_ws_whitelist_cache.values())
                blacklist_keyword_count = sum(
                    sum(len(keywords) for keywords in lists.values()) for lists in new_blacklist_cache.values()
                )
                whitelist_keyword_count = sum(
                    sum(len(keywords) for keywords in lists.values()) for lists in new_whitelist_cache.values()
                )
                logger.debug(
                    f"Keyword cache refreshed - Apps: BL {len(new_blacklist_cache)}, WL {len(new_whitelist_cache)}; "
                    f"Workspaces: BL {len(new_ws_blacklist_cache)}, WL {len(new_ws_whitelist_cache)}; "
                    f"Lists: BL {blacklist_list_count + ws_bl_count}, WL {whitelist_list_count + ws_wl_count}; "
                    f"Keywords: BL {blacklist_keyword_count}, WL {whitelist_keyword_count}"
                )

            finally:
                db.close()

        except Exception as e:
            logger.error(f"Failed to refresh keyword cache: {e}")
    
    async def invalidate_cache(self):
        """Immediately invalidate cache"""
        async with self._lock:
            self._cache_timestamp = 0
            logger.info("Keyword cache invalidated")
    
    def get_cache_info(self) -> dict:
        """Get cache statistics"""
        blacklist_list_count = sum(len(lists) for lists in self._blacklist_cache.values())
        whitelist_list_count = sum(len(lists) for lists in self._whitelist_cache.values())
        blacklist_keyword_count = sum(
            sum(len(keywords) for keywords in lists.values()) for lists in self._blacklist_cache.values()
        )
        whitelist_keyword_count = sum(
            sum(len(keywords) for keywords in lists.values()) for lists in self._whitelist_cache.values()
        )

        return {
            "applications_with_blacklists": len(self._blacklist_cache),
            "applications_with_whitelists": len(self._whitelist_cache),
            "blacklist_lists": blacklist_list_count,
            "blacklist_keywords": blacklist_keyword_count,
            "whitelist_lists": whitelist_list_count,
            "whitelist_keywords": whitelist_keyword_count,
            "last_refresh": self._cache_timestamp,
            "cache_age_seconds": time.time() - self._cache_timestamp if self._cache_timestamp > 0 else 0
        }

# Global keyword cache instance
keyword_cache = KeywordCache(cache_ttl=300)  # 5 minutes cache