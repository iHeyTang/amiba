"""Hermes Kanban HTTP adapter.

The board and task lifecycle stay owned by ``hermes_cli.kanban_db``.  This
lane exposes compact read models plus task creation for Amiba's global board
and per-session workbench.
"""

from .routes import register

__all__ = ["register"]
