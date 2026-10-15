"""Bind verified public GitHub identity without storing access tokens."""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # Preserve upgrades from early development installs that already contained these fields.
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "github_verified_id" not in columns:
        op.add_column("users", sa.Column("github_verified_id", sa.Integer(), nullable=True))
        op.add_column("users", sa.Column("github_verified_username", sa.String(80), nullable=False, server_default=""))


def downgrade():
    op.drop_column("users", "github_verified_username")
    op.drop_column("users", "github_verified_id")
