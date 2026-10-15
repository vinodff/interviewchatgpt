"""Idempotent live usage accounting."""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("usage_connections"):
        op.create_table("usage_connections", sa.Column("id", sa.String(36), primary_key=True), sa.Column("session_id", sa.String(36), sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False), sa.Column("charged_seconds", sa.Integer(), nullable=False))
        op.create_index("ix_usage_connections_session_id", "usage_connections", ["session_id"])


def downgrade():
    op.drop_table("usage_connections")
