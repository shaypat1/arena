# CV Pipeline Handoff

Status at the time of this commit: **the full loop works end-to-end but the
count is visibly undercounting.** On a busy Van Wyck morning we see ~15
vehicles pass a reasonable gate in 15 seconds, but the counter reports 2–8.
Detection is fine (YOLO finds cars on every frame); the failure is in
**ByteTrack track continuity**, which causes gate crossings to be split
across multiple track IDs and therefore never counted as a single A→B or
A↔B event.

This doc is for Shay's agent to pick up and push accuracy forward without
reading the full commit history.

---

## What's already in place

### Architecture
```
HLS stream → ffmpeg (10-15 FPS, scale 960×540)
           → YOLOv8s (imgsz=960, MPS)
           → ByteTrack (persist=True)
           → LineCrossingCounter (gate mode: two lines, sign-state)
           → Redis publish to `settlement` (final count)
           → Redis publish to `cv_tracks` (per-frame bboxes + running count)
```

### ROI geometry format — **gate, not rectangle**
We replaced the old rotating rectangle with a two-line gate. Stored in
`cameras.roi_geometry` as JSONB:

```json
{
  "type": "gate",
  "line_a": [[0.15, 0.38], [0.52, 0.52]],
  "line_b": [[0.05, 0.62], [0.62, 0.88]],
  "direction": "bidirectional" | "a_to_b" | "b_to_a"
}
```

Coordinates are **normalized 0..1** of the source frame. Each line is two
`[x, y]` endpoints. A vehicle must cross BOTH lines (sign-state transition
with a 4 px buffer on each side) to be counted once. `a_to_b` and `b_to_a`
enforce crossing order; `bidirectional` accepts either order.

**Legacy box format** (`{box, count_edge, direction}`) is still supported
for backward compat — see `_parse_single_box` in `counter.py`.

### Admin editor
`/admin/cameras/[id]` — canvas UI for drawing the two-line gate. Drag
endpoint handles, drag midpoint handles to slide a whole line, pick
direction. Snapshots fetched via `GET /api/admin/cameras/:id/snapshot`
(ffmpeg-based).

### Live debug stream
cv-counter publishes every processed frame to Redis channel `cv_tracks`
with this payload:

```json
{
  "round_id": "...",
  "feed_id": "...",
  "frame_w": 960,
  "frame_h": 540,
  "counting": true,
  "count": 5,
  "tracks": [
    {
      "id": 1675,
      "cx": 0.434, "cy": 0.694,
      "x1": 0.41, "y1": 0.66,
      "x2": 0.46, "y2": 0.72,
      "cls": 2,
      "crossed": [0],
      "counted": false
    }
  ]
}
```

The API's `redis-bridge.js` forwards `cv_tracks` → Socket.IO room
`feed:{feed_id}` as event `cv:tracks`. `useSocket` exposes it as
`cvTracks`. `FeedPlayer.jsx` renders:
- Live bounding boxes over each tracked vehicle, colour-coded by crossing state
  (grey → green (crossed A) → amber (crossed B) → red (counted))
- Running count badge top-right with "LIVE COUNT" / "LAST ROUND" / "WARMING UP" / "WAITING FOR CV"
- The "LAST ROUND" badge persists the previous round's final count during the
  gap before the next round starts counting, so the user can see what they won

### Current config (cv-counter)
- `services/cv-counter/pipeline.py`:
  - `CV_FRAME_FPS=15` (was 10 — bumped this commit for tracker stability)
  - `CV_IMGSZ=960`
  - `CV_CONF_THRESHOLD=0.35`
  - `CV_IOU_THRESHOLD=0.5`
  - `CV_DEVICE=mps`
  - Model: `yolov8s.pt`
  - Classes: `[2, 5, 7]` (car, bus, truck — no motorcycles, no other COCO)
- `services/cv-counter/bytetrack.yaml`:
  - `match_thresh: 0.9` (max COST — cost=1-IoU, so this is lenient matching)
  - `track_buffer: 60` (keep lost tracks alive 60 frames ~= 4s at 15 FPS)
  - `new_track_thresh: 0.5`
  - `track_high_thresh: 0.4`, `track_low_thresh: 0.1`

### Gates in counter.py
Every track must pass ALL of these to be counted:
- `CV_MIN_TRACK_AGE=5` frames observed
- `CV_MIN_TRACK_DISTANCE_PX=30` pixels travelled since first sighting
- `CV_MIN_VELOCITY=1.5` recent velocity (last few frames)
- Sign-state transition on both lines with `CV_CROSS_BUFFER_PX=4` buffer
- (For ordered gates) cross in the right sequence

All env-overridable — tune without a rebuild.

---

## The actual problem — ByteTrack ID flipping

On every round we see ~15–25 unique track IDs created by ByteTrack over a
15-second counting window, but only a handful of them transition from one
side of a line to the other. The logs show a high "sided" rate (tracks that
reach the `confirmed_side=±1` state) but a low "crossed" rate.

Root cause: when a fast highway car moves more than ~30–50 pixels between
frames, its bbox IoU with the previous frame drops below the match
threshold, and ByteTrack issues a **new track ID**. The old ID is on the
"above line" side, the new ID is on the "below line" side. Neither
transitions — our counter sees "two different cars, both on one side of
the line" and counts nothing.

Evidence:
- Live `cv_tracks` stream shows track IDs incrementing fast (1675, 1693,
  1695, 1700 in a ~1 second window — most of those are probably the same
  2–3 cars respawning under new IDs)
- YOLO detection stats are healthy: 600+ detections over 15s, 85% of
  frames have vehicles
- Centroid positions look correct when drawn on the video (small render
  lag because of 10 Hz publish rate vs 60 Hz display, but directionally
  right)

---

## What to try next — priority order

### 1. ✅ **Already done in this commit**: bump `CV_FRAME_FPS` 10 → 15
Cuts per-frame motion by ~33%, which should bring ByteTrack's match rate
way up. Expected improvement: **+30–50% counts**. Run a calibration
harness clip before/after to quantify.

### 2. Bigger tracker window / Kalman filter
Ultralytics ByteTrack uses IoU matching. If a car moves too much between
frames for IoU to match, we miss it. **Try switching tracker to BoT-SORT**
(`bot_sort.yaml`), which does Kalman-predicted motion compensation before
IoU matching. This is a one-line change: replace `BYTETRACK_CFG` with a
`botsort.yaml` path in `pipeline.py`. BoT-SORT is also in ultralytics, no
extra install needed. Expected improvement: **significant** for fast
objects.

### 3. Try yolov8**m** @ 640 (same FPS budget)
Benchmark said yolov8m@640 ≈ 173ms on MPS (that's predict(), track() is
probably ~100ms). Still fits at 10 FPS, maybe 12 FPS. Slightly higher
detection quality, marginal effect on tracking. Not worth the swap unless
BoT-SORT + 15 FPS isn't enough.

### 4. Frame cropping to ROI with upscale
This is the **biggest potential win** on a Mac because it lets us "zoom
in" on the counting zone before inference:
- Compute a bounding box around `line_a` + `line_b` with 20% padding
- ffmpeg `-vf crop=w:h:x:y,scale=960:540` to crop AND upscale the ROI
  region to our inference resolution
- Cars in the gate become 2–3x larger in pixels → YOLO confidence goes up
  → small/distant cars get detected earlier
- Transform detection coordinates back to full-frame normalized space
  before publishing to `cv_tracks` (so the frontend still renders in the
  full frame's coordinate system)

The crop must be STABLE for the entire round so ByteTrack's tracker state
is coherent across frames. Compute it once in `Pipeline.__init__` from the
gate geometry.

**File-level plan:**
1. In `pipeline.py _parse_gate_crop(roi_geometry) -> (crop_x, crop_y, crop_w, crop_h)`
   that returns the pixel bounds of the gate's bounding box expanded by 20%
2. Update ffmpeg command to `-vf "fps=15,crop=w:h:x:y,scale=960:540"`
3. After YOLO detection, remap coordinates:
   `cx_full = crop_x + cx_cropped * (crop_w / 960)`
   `cy_full = crop_y + cy_cropped * (crop_h / 540)`
4. counter.observe() and _publish_tracks() both use the full-frame coords
5. Bytetrack continues to see a 960×540 input so tracker state is unchanged

Expected improvement: **+20–40% on top of FPS bump**, because distant cars
that currently enter the counting zone undetected will be caught 1–2
frames earlier.

### 5. Calibration harness integration
`services/cv-counter/calibrate.py` already exists and captures 15-second
clips from a live HLS URL. Use it to A/B test changes:

```bash
cd services/cv-counter
./venv/bin/python calibrate.py capture "https://s53.nysdot.skyvdn.com:443/rtplive/R11_173/playlist.m3u8" 10
# Watch each clip, fill in ground_truth.json with manual counts
./venv/bin/python calibrate.py run
```

Reports MAE and per-clip error. Don't ship a tuning change without
running this first.

### 6. Switch to yolov8**m** + crop-and-upsample (combined)
Cropping frees up compute headroom. Specifically, a smaller effective
region means we can run yolov8m @ 640 without dropping below 10 FPS. Best
model + best input resolution trick + stable FPS = highest achievable
accuracy on this hardware.

### 7. Longer term — NVIDIA inference
If accuracy is still insufficient after all of the above, the hardware is
the limit. On an L4 or T4 instance (~$0.20/hr on-demand) yolov8l @ 960
hits 40+ FPS and DeepStream's NvDCF tracker is designed exactly for this
problem. But that's only worth it after we've exhausted Mac-local options.

---

## Things that are NOT the problem (don't chase these)

- **YOLO detection**: logs consistently show 4+ vehicles detected per
  frame, class IDs 2/5/7 all present. The model is fine.
- **Frame ingestion**: ffmpeg first-frame latency is ~800ms, we get 100+
  counting frames per 15s window reliably. No dropped frames.
- **Settlement pipeline**: the Redis → API → DB path works perfectly. The
  number you see in `rounds.settlement_data->car_count` is exactly what
  `counter.total()` returned. If the counter is low, the root cause is
  before `counter.observe()`, not after.
- **Coordinate systems**: frame is 960×540, source is 1920×1080 (both
  16:9), browser video is native 1920×1080. Aspect ratios line up. The
  `cx/cy` normalized coords render correctly on the browser canvas (the
  gate overlay draws in the right place, which is the same code path).
- **ROI geometry parsing**: the gate parser has been tested with rotated,
  off-angle, bidirectional gates. The math is sound (see `_signed_distance`
  which uses 2D cross product — works for any line angle).

---

## Getting started

```bash
make stop            # stop any running services
make migrate         # idempotent, applies 006_car_count_and_roi.sql
make install         # creates venvs for feed-simulator + cv-counter
make start           # runs API + frontend + simulator + cv-counter
```

Then:
- **Game**: http://localhost:3000/feed/traffic-cameras
- **Admin ROI editor**: http://localhost:3000/admin/cameras
- **Live track visualisation** appears on the video during counting phase
  (during the 15s reveal phase, you'll see bounding boxes + a running
  count badge top-right)

Set `window.__DEBUG_CV__ = true` in the browser devtools console to log
every `cv:tracks` event as it arrives.

To watch Redis directly:
```bash
redis-cli subscribe cv_tracks     # live tracking stream
redis-cli subscribe settlement    # final settlement per round
redis-cli subscribe round_state   # round:opened / round:locked events
```

---

## Key file locations

| What | Where |
|---|---|
| CV pipeline core | `services/cv-counter/pipeline.py` |
| Counter / gate math | `services/cv-counter/counter.py` |
| ByteTrack config | `services/cv-counter/bytetrack.yaml` |
| Main service loop | `services/cv-counter/main.py` |
| Calibration harness | `services/cv-counter/calibrate.py` |
| Admin ROI API | `services/api/routes/admin.js` |
| Redis → Socket.IO bridge | `services/realtime/redis-bridge.js` |
| Admin ROI editor UI | `frontend/app/admin/cameras/[id]/page.jsx` |
| Live video + overlays | `frontend/components/FeedPlayer.jsx` |
| Socket hook (track stream) | `frontend/hooks/useSocket.js` |
| Migration | `db/migrations/006_car_count_and_roi.sql` |

---

## If you only do ONE thing

**Switch ByteTrack to BoT-SORT** (#2 above). It's a one-line config swap
and BoT-SORT's motion prediction is specifically designed to survive
high-velocity objects on low-FPS streams. No other change needed.

```yaml
# services/cv-counter/bytetrack.yaml → make it botsort.yaml
tracker_type: botsort
track_high_thresh: 0.4
track_low_thresh: 0.1
new_track_thresh: 0.5
track_buffer: 60
match_thresh: 0.9
fuse_score: true
gmc_method: sparseOptFlow    # BoT-SORT's camera motion compensation
proximity_thresh: 0.5
appearance_thresh: 0.25
with_reid: false
```

Then in `pipeline.py` change the `BYTETRACK_CFG` constant to point at
`botsort.yaml` (or rename — just make sure `model.track(tracker=...)` uses
the new file).
