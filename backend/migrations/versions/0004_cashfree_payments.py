"""Cashfree payments and orders."""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "cf_customer_id" not in columns:
        op.add_column("users", sa.Column("cf_customer_id", sa.String(100), nullable=True))

    if not inspector.has_table("payment_orders"):
        op.create_table(
            "payment_orders",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("order_id", sa.String(100), nullable=False, unique=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("plan_id", sa.String(30), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(10), nullable=False, server_default="INR"),
            sa.Column("status", sa.String(30), nullable=False, server_default="ACTIVE"),
            sa.Column("payment_session_id", sa.String(255), nullable=False),
            sa.Column("cf_payment_id", sa.String(100), nullable=True),
            sa.Column("payment_method", sa.String(50), nullable=True),
            sa.Column("minutes_granted", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_payment_orders_order_id", "payment_orders", ["order_id"])
        op.create_index("ix_payment_orders_user_id", "payment_orders", ["user_id"])
        op.create_index("ix_payment_orders_status", "payment_orders", ["status"])


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("payment_orders"):
        op.drop_table("payment_orders")
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "cf_customer_id" in columns:
        op.drop_column("users", "cf_customer_id")
