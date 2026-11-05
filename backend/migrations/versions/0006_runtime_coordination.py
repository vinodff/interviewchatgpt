"""Add durable cross-process coordination for hosting without Redis."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("runtime_coordination",
                    sa.Column("key", sa.String(512), primary_key=True),
                    sa.Column("value", sa.Text(), nullable=False),
                    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_runtime_coordination_expires_at", "runtime_coordination", ["expires_at"])
    if op.get_bind().dialect.name == "postgresql":
        # Internal tickets and leases must never be exposed through a public REST schema.
        op.execute("ALTER TABLE runtime_coordination ENABLE ROW LEVEL SECURITY")


def downgrade():
    op.drop_table("runtime_coordination")
