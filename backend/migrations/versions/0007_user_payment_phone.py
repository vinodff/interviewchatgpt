"""Add phone column to payment_orders and users.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    if "phone" not in user_cols:
        op.add_column("users", sa.Column("phone", sa.String(20), nullable=True))

    if inspector.has_table("payment_orders"):
        order_cols = {c["name"] for c in inspector.get_columns("payment_orders")}
        if "phone" not in order_cols:
            op.add_column("payment_orders", sa.Column("phone", sa.String(20), nullable=True))


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("payment_orders"):
        order_cols = {c["name"] for c in inspector.get_columns("payment_orders")}
        if "phone" in order_cols:
            op.drop_column("payment_orders", "phone")

    user_cols = {c["name"] for c in inspector.get_columns("users")}
    if "phone" in user_cols:
        op.drop_column("users", "phone")
