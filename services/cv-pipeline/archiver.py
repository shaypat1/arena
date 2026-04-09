"""
archiver.py -- S3/MinIO frame and clip archival for the CV pipeline.

Uploads JPEG frames (and optional video clips) to the configured
object-storage bucket and returns the public URL / S3 URI.
"""

import io
import logging
import os
import uuid

import boto3
import cv2
import numpy as np
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger("cv-pipeline.archiver")

S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "http://localhost:9000")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "arena")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "arena_dev_key")
S3_BUCKET = os.environ.get("S3_BUCKET", "arena-frames")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")


def _build_client():
    """Create a boto3 S3 client pointing at MinIO / real S3."""
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=Config(signature_version="s3v4"),
    )


def _ensure_bucket(client):
    """Create the bucket if it does not exist (safe for MinIO)."""
    try:
        client.head_bucket(Bucket=S3_BUCKET)
    except ClientError as exc:
        error_code = int(exc.response["Error"]["Code"])
        if error_code == 404:
            logger.info("Bucket %s not found -- creating", S3_BUCKET)
            client.create_bucket(Bucket=S3_BUCKET)
        else:
            raise


_client = None


def _get_client():
    global _client
    if _client is None:
        _client = _build_client()
        _ensure_bucket(_client)
    return _client


def upload_frame(frame: np.ndarray, feed_id: str, round_id: str) -> str:
    """Encode a BGR numpy frame as JPEG and upload to S3.

    Returns the S3 URI of the uploaded object.
    """
    success, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not success:
        raise RuntimeError("Failed to encode frame as JPEG")

    key = f"frames/{feed_id}/{round_id}/{uuid.uuid4().hex}.jpg"
    try:
        client = _get_client()
        client.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=io.BytesIO(buf.tobytes()),
            ContentType="image/jpeg",
        )
        uri = f"s3://{S3_BUCKET}/{key}"
        logger.debug("Uploaded frame to %s", uri)
        return uri
    except (BotoCoreError, ClientError):
        logger.exception("Failed to upload frame for round %s", round_id)
        # Return a placeholder so settlement can still proceed
        return f"s3://{S3_BUCKET}/{key}?upload_failed=true"


def upload_clip(clip_bytes: bytes, feed_id: str, round_id: str) -> str:
    """Upload a pre-encoded video clip to S3.

    Returns the S3 URI of the uploaded object.
    """
    key = f"clips/{feed_id}/{round_id}/{uuid.uuid4().hex}.mp4"
    try:
        client = _get_client()
        client.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=io.BytesIO(clip_bytes),
            ContentType="video/mp4",
        )
        uri = f"s3://{S3_BUCKET}/{key}"
        logger.debug("Uploaded clip to %s", uri)
        return uri
    except (BotoCoreError, ClientError):
        logger.exception("Failed to upload clip for round %s", round_id)
        return f"s3://{S3_BUCKET}/{key}?upload_failed=true"
