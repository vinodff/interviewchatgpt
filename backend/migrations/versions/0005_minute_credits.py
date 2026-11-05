"""Keep purchased minute credits separate from recurring monthly allowances."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("credit_seconds", sa.Integer(), nullable=False, server_default="0"))
        batch.create_check_constraint("ck_users_credit_seconds_nonnegative", "credit_seconds >= 0")
    # Revision0004 created a non-unique index beside its unique constraint, while
    # the mapped schema declares a unique index. Keep fresh and upgraded schemas aligned.
    op.drop_index("ix_payment_orders_order_id", table_name="payment_orders")
    op.create_index("ix_payment_orders_order_id", "payment_orders", ["order_id"], unique=True)


def downgrade():
    op.drop_index("ix_payment_orders_order_id", table_name="payment_orders")
    op.create_index("ix_payment_orders_order_id", "payment_orders", ["order_id"])
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("ck_users_credit_seconds_nonnegative", type_="check")
        batch.drop_column("credit_seconds")
