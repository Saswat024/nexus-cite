"""
MongoDB Atlas and GridFS storage support in Python.
"""

from __future__ import annotations

import os
import io
from typing import Optional, Any
from bson import ObjectId
from pymongo import MongoClient
import gridfs

DEFAULT_DB_NAME = "nexus_cite"


def get_mongo_uri() -> str:
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise ValueError("Missing MONGODB_URI in environment. Provide your MongoDB Atlas URI in .env")
    return uri


def get_mongo_client() -> MongoClient:
    uri = get_mongo_uri()
    return MongoClient(uri, tls=True, tlsAllowInvalidCertificates=True)


def get_mongo_db(db_name: Optional[str] = None):
    client = get_mongo_client()
    return client[db_name or os.environ.get("MONGODB_DB_NAME", DEFAULT_DB_NAME)]


def get_gridfs(db_name: Optional[str] = None) -> gridfs.GridFS:
    db = get_mongo_db(db_name)
    return gridfs.GridFS(db, collection="documents_fs")


def upload_to_gridfs(filename: str, data: bytes, metadata: Optional[dict[str, Any]] = None) -> str:
    """Upload document bytes to MongoDB GridFS. Returns string ObjectId."""
    fs = get_gridfs()
    file_id = fs.put(data, filename=filename, metadata=metadata or {})
    return str(file_id)


def download_from_gridfs(file_id: str) -> bytes:
    """Download document bytes from MongoDB GridFS by file_id string."""
    fs = get_gridfs()
    grid_out = fs.get(ObjectId(file_id))
    return grid_out.read()


def delete_from_gridfs(file_id: str) -> None:
    """Delete a document from MongoDB GridFS by file_id string."""
    fs = get_gridfs()
    try:
        fs.delete(ObjectId(file_id))
    except Exception:
        pass
