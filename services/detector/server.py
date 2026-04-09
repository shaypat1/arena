"""
Local YOLOv8 detection server.
Reads frames from a live HLS stream, runs YOLOv8, serves results via HTTP.

GET /detections  → latest detection results
GET /health      → server status
"""

import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

import cv2
from ultralytics import YOLO

STREAM_URL = "https://gieat.viewsurf.com?id=2756&action=mediaRedirect"
PORT = 3002
DETECT_INTERVAL = 2.0

VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

latest_detections = {"cars": 0, "detections": [], "timestamp": 0}
lock = threading.Lock()


def fetch_frame(url):
    """Fetch the latest frame — works for both HLS streams and MP4 redirect URLs."""
    try:
        cap = cv2.VideoCapture(url)
        if not cap.isOpened():
            return None
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total > 1:
            # MP4 clip — seek to middle for a representative frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(1, total // 2))
        ret, frame = cap.read()
        cap.release()
        return frame if ret else None
    except Exception as e:
        print(f"[detector] Frame fetch error: {e}")
        return None


def detection_loop(model):
    """Background thread: fetch frames and run YOLOv8."""
    global latest_detections
    print(f"[detector] Monitoring: {STREAM_URL}")

    while True:
        try:
            frame = fetch_frame(STREAM_URL)
            if frame is None:
                print("[detector] No frame, retrying...")
                time.sleep(5)
                continue

            results = model(frame, verbose=False, conf=0.2)
            r = results[0]

            vehicles = []
            for box in r.boxes:
                cls_id = int(box.cls[0])
                if cls_id not in VEHICLE_CLASSES:
                    continue
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                vehicles.append({
                    "class": VEHICLE_CLASSES[cls_id],
                    "classId": cls_id,
                    "score": round(conf, 3),
                    "bbox": [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],
                })

            with lock:
                latest_detections = {
                    "cars": len(vehicles),
                    "detections": vehicles,
                    "timestamp": time.time(),
                    "frame_width": frame.shape[1],
                    "frame_height": frame.shape[0],
                }

            print(f"[detector] {len(vehicles)} vehicles detected")

        except Exception as e:
            print(f"[detector] Error: {e}")

        time.sleep(DETECT_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/detections"):
            with lock:
                data = json.dumps(latest_detections)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data.encode())
        elif self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "model": "yolov8s"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.end_headers()

    def log_message(self, format, *args):
        pass


def main():
    print("[detector] Loading YOLOv8s...")
    model = YOLO("yolov8s.pt")
    print("[detector] Model loaded")

    t = threading.Thread(target=detection_loop, args=(model,), daemon=True)
    t.start()

    print(f"[detector] Server on port {PORT}")
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[detector] Shut down")
        server.shutdown()


if __name__ == "__main__":
    main()
