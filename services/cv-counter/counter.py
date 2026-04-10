"""
LineCrossingCounter — counts tracked objects that cross a counting zone.

Supports two ROI geometry formats:

  1) Single-line (box format, legacy):
     {
       "box":        { "x": 0.15, "y": 0.55, "w": 0.70, "h": 0.15, "rotation": 0 },
       "count_edge": "bottom" | "top" | "left" | "right",
       "direction":  "down" | "up" | "left" | "right" | "bidirectional"
     }
     A line is derived from the chosen edge of the (rotated) box, and a
     track is counted when it crosses the line (in the configured
     direction, or either way if bidirectional).

  2) Gate format (two-line entry+exit gate):
     {
       "type":      "gate",
       "line_a":    [[x1, y1], [x2, y2]],   # endpoints, normalized 0..1
       "line_b":    [[x1, y1], [x2, y2]],
       "direction": "bidirectional" | "a_to_b" | "b_to_a"
     }
     A track is counted when it crosses BOTH lines. For `a_to_b`, line A
     must be crossed first, then line B. For `b_to_a`, line B first.
     For `bidirectional`, either order is accepted.

Layered accuracy gates (applied in both modes):
  1. min_track_age         — track must be observed for N frames
  2. min_track_distance    — track must have moved M pixels since first seen
  3. min_velocity          — recent velocity must exceed a threshold
  4. buffered sign-state   — each line transition requires the track to be
                              at least `cross_buffer_px` on each side
  5. one count per track   — a track can only be counted once

All thresholds are env-overridable:
  CV_MIN_TRACK_AGE
  CV_MIN_TRACK_DISTANCE_PX
  CV_MIN_VELOCITY
  CV_CROSS_BUFFER_PX
"""

from __future__ import annotations

import logging
import math
import os
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("cv-counter.counter")


def _env_float(name: str, default: float) -> float:
    v = os.environ.get(name)
    try:
        return float(v) if v else default
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    v = os.environ.get(name)
    try:
        return int(v) if v else default
    except ValueError:
        return default


@dataclass
class TrackHistory:
    first_seen_frame: int
    last_seen_frame: int
    positions: deque = field(default_factory=lambda: deque(maxlen=10))
    class_votes: Counter = field(default_factory=Counter)
    counted: bool = False
    # Per-line sign state: +1, -1, or 0 (not yet confirmed on either side).
    # Index matches self.lines.
    confirmed_sides: List[int] = field(default_factory=list)
    # Ordered list of line indices that have been crossed by this track.
    # For single-line mode this has at most 1 element; for gate mode it
    # records the sequence so we can enforce ordering.
    cross_sequence: List[int] = field(default_factory=list)


@dataclass
class LineSpec:
    """One counting line in pixel coordinates."""
    a: Tuple[float, float]
    b: Tuple[float, float]
    # Unit normal pointing toward the "positive" side of this line. For the
    # single-line directional mode we require crossings in the +normal
    # direction; gate mode ignores this.
    normal: Tuple[float, float]


class LineCrossingCounter:
    def __init__(
        self,
        roi_geometry: dict,
        frame_w: int,
        frame_h: int,
        *,
        min_track_age: Optional[int] = None,
        min_track_distance_px: Optional[float] = None,
        min_velocity: Optional[float] = None,
        cross_buffer_px: Optional[float] = None,
    ):
        self.roi_geometry = roi_geometry
        self.frame_w = frame_w
        self.frame_h = frame_h

        # Config (env-overridable)
        self.min_track_age = (
            min_track_age if min_track_age is not None else _env_int("CV_MIN_TRACK_AGE", 5)
        )
        self.min_track_distance_px = (
            min_track_distance_px
            if min_track_distance_px is not None
            else _env_float("CV_MIN_TRACK_DISTANCE_PX", 30.0)
        )
        self.min_velocity = (
            min_velocity if min_velocity is not None else _env_float("CV_MIN_VELOCITY", 1.5)
        )
        self.cross_buffer_px = (
            cross_buffer_px
            if cross_buffer_px is not None
            else _env_float("CV_CROSS_BUFFER_PX", 4.0)
        )

        # Detect format and build self.lines + mode flags.
        # Mode flags:
        #   self.mode ∈ {"single", "gate"}
        #   self.single_bidirectional: only used in "single" mode
        #   self.gate_direction: only used in "gate" mode
        #       ∈ {"bidirectional", "a_to_b", "b_to_a"}
        self.lines: List[LineSpec] = []
        self.mode: str = "single"
        self.single_bidirectional: bool = True
        self.gate_direction: str = "bidirectional"

        if roi_geometry.get("type") == "gate" or (
            "line_a" in roi_geometry and "line_b" in roi_geometry
        ):
            self._parse_gate(roi_geometry)
            self.mode = "gate"
        else:
            self._parse_single_box(roi_geometry)
            self.mode = "single"

        self.tracks: Dict[int, TrackHistory] = {}
        self.frame_idx = 0
        self._count = 0
        self.counting_enabled = False
        self._count_events: list = []

        if self.mode == "gate":
            logger.info(
                "LineCrossingCounter initialized: mode=gate direction=%s "
                "lineA=%s→%s lineB=%s→%s "
                "gates(age=%d dist=%.1f vel=%.2f buf=%.1f)",
                self.gate_direction,
                self.lines[0].a,
                self.lines[0].b,
                self.lines[1].a,
                self.lines[1].b,
                self.min_track_age,
                self.min_track_distance_px,
                self.min_velocity,
                self.cross_buffer_px,
            )
        else:
            logger.info(
                "LineCrossingCounter initialized: mode=single bidirectional=%s "
                "line=%s→%s normal=%s "
                "gates(age=%d dist=%.1f vel=%.2f buf=%.1f)",
                self.single_bidirectional,
                self.lines[0].a,
                self.lines[0].b,
                self.lines[0].normal,
                self.min_track_age,
                self.min_track_distance_px,
                self.min_velocity,
                self.cross_buffer_px,
            )

    # ── ROI parsers ────────────────────────────────────────────────────
    def _parse_gate(self, roi: dict) -> None:
        for key in ("line_a", "line_b"):
            if key not in roi:
                raise ValueError(f"gate roi missing {key}")
            endpoints = roi[key]
            if len(endpoints) != 2:
                raise ValueError(f"gate {key} must have 2 endpoints")
            p1 = (float(endpoints[0][0]) * self.frame_w, float(endpoints[0][1]) * self.frame_h)
            p2 = (float(endpoints[1][0]) * self.frame_w, float(endpoints[1][1]) * self.frame_h)
            # Normal: rotate the line direction 90° counter-clockwise
            lx, ly = p2[0] - p1[0], p2[1] - p1[1]
            length = (lx * lx + ly * ly) ** 0.5
            if length == 0:
                raise ValueError(f"gate {key} has zero length")
            # (-ly, lx)/length is perpendicular; this is the "left" side of
            # the line when walking from a to b. Gate mode doesn't use the
            # normal for direction checks anyway (ordering is enforced via
            # cross sequence), but we still store it for logging/debugging.
            self.lines.append(LineSpec(a=p1, b=p2, normal=(-ly / length, lx / length)))
        direction = roi.get("direction", "bidirectional")
        if direction not in ("bidirectional", "a_to_b", "b_to_a"):
            raise ValueError(f"gate direction must be bidirectional|a_to_b|b_to_a, got {direction}")
        self.gate_direction = direction

    def _parse_single_box(self, roi: dict) -> None:
        box = roi["box"]
        bx = box["x"] * self.frame_w
        by = box["y"] * self.frame_h
        bw = box["w"] * self.frame_w
        bh = box["h"] * self.frame_h
        rotation_deg = float(box.get("rotation", 0.0) or 0.0)
        theta = math.radians(rotation_deg)
        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        cx_b = bx + bw / 2.0
        cy_b = by + bh / 2.0

        def _rot(p):
            dx = p[0] - cx_b
            dy = p[1] - cy_b
            return (cx_b + dx * cos_t - dy * sin_t, cy_b + dx * sin_t + dy * cos_t)

        count_edge = roi["count_edge"]
        if count_edge == "bottom":
            la_aa = (bx, by + bh)
            lb_aa = (bx + bw, by + bh)
        elif count_edge == "top":
            la_aa = (bx, by)
            lb_aa = (bx + bw, by)
        elif count_edge == "left":
            la_aa = (bx, by)
            lb_aa = (bx, by + bh)
        elif count_edge == "right":
            la_aa = (bx + bw, by)
            lb_aa = (bx + bw, by + bh)
        else:
            raise ValueError(f"invalid count_edge: {count_edge}")

        direction = roi["direction"]
        self.single_bidirectional = direction == "bidirectional"
        local_normal_map = {
            "down": (0.0, 1.0),
            "up": (0.0, -1.0),
            "right": (1.0, 0.0),
            "left": (-1.0, 0.0),
            "bidirectional": (0.0, 1.0),
        }
        if direction not in local_normal_map:
            raise ValueError(f"invalid direction: {direction}")
        lnx, lny = local_normal_map[direction]
        normal = (lnx * cos_t - lny * sin_t, lnx * sin_t + lny * cos_t)
        self.lines.append(LineSpec(a=_rot(la_aa), b=_rot(lb_aa), normal=normal))

    # ── Geometry helpers ───────────────────────────────────────────────
    def _signed_distance(self, line: LineSpec, px: float, py: float) -> float:
        """Signed distance from (px,py) to `line`, positive on the normal side."""
        x1, y1 = line.a
        x2, y2 = line.b
        lx, ly = (x2 - x1), (y2 - y1)
        length = (lx * lx + ly * ly) ** 0.5
        if length == 0:
            return 0.0
        dx, dy = (px - x1), (py - y1)
        raw = (lx * dy - ly * dx) / length  # cross product / length
        # Align raw's sign with line.normal: the "left of a→b" normal is
        # (-ly, lx)/length. If the configured normal points the opposite
        # way, flip the sign.
        left_nx, left_ny = (-ly / length, lx / length)
        if left_nx * line.normal[0] + left_ny * line.normal[1] < 0:
            raw = -raw
        return raw

    # ── Counting public API ────────────────────────────────────────────
    def observe(self, track_id: int, cls: int, cx: float, cy: float) -> None:
        track_id = int(track_id)
        cls = int(cls)
        cx = float(cx)
        cy = float(cy)
        self.frame_idx += 1
        hist = self.tracks.get(track_id)
        if hist is None:
            hist = TrackHistory(
                first_seen_frame=self.frame_idx,
                last_seen_frame=self.frame_idx,
                confirmed_sides=[0] * len(self.lines),
            )
            self.tracks[track_id] = hist

        hist.last_seen_frame = self.frame_idx
        hist.positions.append((cx, cy))
        hist.class_votes[cls] += 1

        if not self.counting_enabled or hist.counted:
            return

        # Basic gates (track quality)
        age = self.frame_idx - hist.first_seen_frame + 1
        if age < self.min_track_age:
            return
        first = hist.positions[0]
        dx = cx - first[0]
        dy = cy - first[1]
        dist = (dx * dx + dy * dy) ** 0.5
        if dist < self.min_track_distance_px:
            return
        vel = self._recent_velocity(hist)
        if vel < self.min_velocity:
            return

        # Update sign state for every configured line
        for i, line in enumerate(self.lines):
            sd = self._signed_distance(line, cx, cy)
            curr_side = 0
            if sd >= self.cross_buffer_px:
                curr_side = 1
            elif sd <= -self.cross_buffer_px:
                curr_side = -1
            if curr_side == 0:
                continue
            prev_side = hist.confirmed_sides[i]
            if prev_side == 0:
                hist.confirmed_sides[i] = curr_side
                continue
            if prev_side == curr_side:
                continue
            # This track just crossed line `i`.
            hist.confirmed_sides[i] = curr_side
            if i not in hist.cross_sequence:
                hist.cross_sequence.append(i)
            # For single-line directional mode, also record the sign of
            # the crossing so we can reject wrong-direction crossings.
            if self.mode == "single" and not self.single_bidirectional:
                # We require crossings going from -1 to +1 (the direction
                # aligned with `line.normal`). If this is +1→-1, revert
                # the sequence so the track can try again next frame.
                if prev_side != -1 or curr_side != 1:
                    if i in hist.cross_sequence:
                        hist.cross_sequence.remove(i)
                    continue

        # Decide whether this track qualifies to be counted
        if not self._track_should_count(hist):
            return

        hist.counted = True
        self._count += 1
        majority_cls = int(hist.class_votes.most_common(1)[0][0])
        event = {
            "frame": int(self.frame_idx),
            "track_id": track_id,
            "majority_class": majority_cls,
            "cx": round(cx, 1),
            "cy": round(cy, 1),
            "velocity": round(float(vel), 2),
            "cross_sequence": list(hist.cross_sequence),
        }
        self._count_events.append(event)
        logger.info("COUNT %d: %s", self._count, event)

    def _track_should_count(self, hist: TrackHistory) -> bool:
        if self.mode == "single":
            # Need the one line crossed (with direction already enforced
            # above when not bidirectional).
            return len(hist.cross_sequence) >= 1
        # Gate mode: both lines must be crossed
        if not (0 in hist.cross_sequence and 1 in hist.cross_sequence):
            return False
        if self.gate_direction == "bidirectional":
            return True
        if self.gate_direction == "a_to_b":
            return hist.cross_sequence[0] == 0 and hist.cross_sequence[1] == 1
        if self.gate_direction == "b_to_a":
            return hist.cross_sequence[0] == 1 and hist.cross_sequence[1] == 0
        return False

    def _recent_velocity(self, hist: TrackHistory) -> float:
        pts = list(hist.positions)
        if len(pts) < 2:
            return 0.0
        sample = pts[-4:] if len(pts) >= 4 else pts
        total = 0.0
        segments = 0
        for i in range(1, len(sample)):
            ax, ay = sample[i - 1]
            bx, by = sample[i]
            total += ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
            segments += 1
        return total / max(1, segments)

    def enable_counting(self) -> None:
        self.counting_enabled = True
        logger.info("Counting enabled at frame_idx=%d", self.frame_idx)

    def disable_counting(self) -> None:
        self.counting_enabled = False

    def total(self) -> int:
        return self._count

    def events(self) -> list:
        return list(self._count_events)
