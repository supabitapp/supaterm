from __future__ import annotations

from dataclasses import dataclass
from typing import TextIO


MAIN_REF = "refs/heads/main"


class PrePushError(ValueError):
  pass


@dataclass(frozen=True)
class PushUpdate:
  local_ref: str
  local_object_name: str
  remote_ref: str
  remote_object_name: str


def parse_push_updates(stream: TextIO) -> list[PushUpdate]:
  updates = []
  for line_number, line in enumerate(stream, start=1):
    fields = line.split()
    if not fields:
      continue
    if len(fields) != 4:
      raise PrePushError(f"invalid pre-push input on line {line_number}")
    updates.append(PushUpdate(*fields))
  return updates


def is_zero_object_name(object_name: str) -> bool:
  return bool(object_name) and not object_name.strip("0")
