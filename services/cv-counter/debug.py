#!/usr/bin/env python3
"""
Raw HLS vs CV Detection — side by side, single stream source.
ESC to quit. Change URL below to switch camera.
"""
import cv2, time, threading
import numpy as np
from ultralytics import YOLO

# ===== CHANGE CAMERA HERE =====
URL = "https://carcctv.daegu.go.kr/live1/_definst_/ch268.stream/playlist.m3u8"
# URL = "https://s53.nysdot.skyvdn.com:443/rtplive/R11_173/playlist.m3u8"  # Van Wyck Queens 1080p
# URL = "https://s53.nysdot.skyvdn.com:443/rtplive/R11_082/playlist.m3u8"  # BQE Brooklyn
# URL = "https://wzmedia.dot.ca.gov/D7/CCTV-340.stream/playlist.m3u8"     # I-405 Carson CA
# ===============================

VEHICLES = {2, 3, 5, 7}
latest_raw = [None]
latest_det = [None]
new_frame = threading.Event()
running = [True]

# Thread: read frames from single source
def reader():
    cap = cv2.VideoCapture(URL)
    while running[0]:
        ret, f = cap.read()
        if not ret:
            time.sleep(0.5); cap.release(); cap = cv2.VideoCapture(URL); continue
        latest_raw[0] = cv2.resize(f, (960, 540))
        new_frame.set()
    cap.release()

# Thread: pick up latest frame, run YOLO
def detector():
    model = YOLO("yolov8n.pt")
    model(np.zeros((540, 960, 3), dtype=np.uint8), verbose=False)
    print("[cv] Model ready")
    while running[0]:
        frame = latest_raw[0]
        if frame is None:
            time.sleep(0.01); continue
        det = frame.copy()
        results = model(det, verbose=False, conf=0.25)
        for box in results[0].boxes:
            if int(box.cls[0]) not in VEHICLES: continue
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            cv2.rectangle(det, (x1, y1), (x2, y2), (52, 211, 153), 2)
            cv2.putText(det, f"{box.conf[0]:.0%}", (x1, y1 - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (52, 211, 153), 1)
        latest_det[0] = det

threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=detector, daemon=True).start()

print("[raw] Connecting...")
while latest_raw[0] is None:
    time.sleep(0.1)
print("[raw] Connected")

cv2.namedWindow("Raw HLS", cv2.WINDOW_NORMAL)
cv2.namedWindow("CV Detection", cv2.WINDOW_NORMAL)
cv2.resizeWindow("Raw HLS", 960, 540)
cv2.resizeWindow("CV Detection", 960, 540)
cv2.moveWindow("Raw HLS", 0, 0)
cv2.moveWindow("CV Detection", 970, 0)

# Main loop: wait for new frames instead of busy-spinning
while True:
    new_frame.wait(timeout=0.1)
    new_frame.clear()

    raw = latest_raw[0]
    det = latest_det[0]
    if raw is not None:
        cv2.imshow("Raw HLS", raw)
    if det is not None:
        cv2.imshow("CV Detection", det)
    if cv2.waitKey(1) & 0xFF == 27:
        break

running[0] = False
cv2.destroyAllWindows()
