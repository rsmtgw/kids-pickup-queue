"""
Kids Pickup Queue - REST API backend
Run:  uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import random, string, datetime, logging, os, json, math, threading, time
from collections import deque
import requests
import httpx
from typing import Dict
from dotenv import load_dotenv

# Load .env from the backend folder (if present) so get_config_key() can read values
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ── In-memory log buffer (most recent 500 entries) ───────────────────────────
_log_buffer: deque = deque(maxlen=500)

class _BufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord):
        _log_buffer.append({
            "ts":    datetime.datetime.utcnow().strftime("%H:%M:%S.%f")[:-3],
            "level": record.levelname,
            "msg":   self.format(record),
        })

_logger = logging.getLogger("pickup")
_logger.setLevel(logging.DEBUG)
_handler = _BufferHandler()
_handler.setFormatter(logging.Formatter("%(message)s"))
_logger.addHandler(_handler)
# also print to console (uvicorn captures this)
_console = logging.StreamHandler()
_console.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
_logger.addHandler(_console)
# also write to file for guaranteed visibility
_file_handler = logging.FileHandler("logs.txt", mode="a", encoding="utf-8")
_file_handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s"))
_logger.addHandler(_file_handler)

# Silence uvicorn access log (per-request GET/POST lines)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

app = FastAPI(title="Kids Pickup Queue API")


# Simple developer key persistence (backend/dev_keys.json)
_DEV_KEYS_FILE = os.path.join(os.path.dirname(__file__), "dev_keys.json")

def _load_dev_keys() -> Dict[str, str]:
    try:
        with open(_DEV_KEYS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _save_dev_keys(d: Dict[str, str]):
    try:
        with open(_DEV_KEYS_FILE, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=2)
    except Exception as e:
        _logger.error(f"DEV-KEYS  could not save dev keys: {e}")

def get_config_key(name: str) -> str:
    # Priority: process env -> persisted dev keys -> empty
    v = os.environ.get(name)
    if v:
        return v
    keys = _load_dev_keys()
    return keys.get(name, "")


def get_gemini_model() -> str:
    """Return configured Gemini model id (without leading 'models/') or sensible default.

    Normalizes values so callers can store either 'models/...'
    or the bare model name in `GOOGLE_GEMINI_MODEL`.
    """
    model = get_config_key("GOOGLE_GEMINI_MODEL")
    if not model:
        model = "gemini-2.5-pro"
    # If user stored full resource name 'models/gemini-2.5-pro', strip the prefix.
    if model.startswith("models/"):
        return model.split("/", 1)[1]
    return model


def _mask_key(key: str) -> str:
    """Mask an API key for safe logging: show first 4 and last 4 chars."""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "..." + key[-4:]


def _call_gemini(payload: dict, api_key: str, model: str, timeout: int | None = None, retries: int = 2) -> dict:
    """Call Google Generative Language API with simple retry/backoff logic.

    Default timeout is 5 minutes (configurable via `GEMINI_TIMEOUT` env var).
    Returns the parsed JSON response on success or raises the last exception.
    """
    # default timeout (seconds)
    default_timeout = int(os.getenv("GEMINI_TIMEOUT", "300"))
    if timeout is None:
        timeout = default_timeout
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"Content-Type": "application/json"}
    params = {"key": api_key}
    last_exc = None
    for attempt in range(1, retries + 1):
        _logger.debug(json.dumps({"type": "genie_request_attempt", "model": model, "masked_key": _mask_key(api_key), "attempt": attempt, "payload_len": len(json.dumps(payload)), "timeout": timeout}))
        try:
            resp = requests.post(url, headers=headers, params=params, json=payload, timeout=timeout)
            _logger.debug(json.dumps({"type": "genie_response", "attempt": attempt, "status": resp.status_code, "body_len": len(resp.text)}))
            if resp.status_code == 200:
                data = resp.json()
                try:
                    reply_text = data["candidates"][0]["content"]["parts"][0]["text"]
                    _logger.info(f"GEMINI-RESPONSE  model={model} text={reply_text!r}")
                except (KeyError, IndexError):
                    _logger.info(f"GEMINI-RESPONSE  model={model} raw={json.dumps(data)}")
                return data
            # Retry on server errors
            if 500 <= resp.status_code < 600:
                _logger.warning(f"GENIE-API server error {resp.status_code} on attempt {attempt}")
                last_exc = Exception(f"Server error {resp.status_code}")
            else:
                _logger.error(f"GENIE-API status={resp.status_code} body={resp.text}")
                resp.raise_for_status()
        except requests.exceptions.ReadTimeout as e:
            _logger.warning(f"GENIE-API read timeout on attempt {attempt} (timeout={timeout})")
            last_exc = e
        except requests.exceptions.RequestException as e:
            _logger.warning(f"GENIE-API request failed on attempt {attempt}: {e}")
            last_exc = e

        if attempt < retries:
            backoff = 2 ** attempt
            time.sleep(backoff)

    # exhausted retries
    if last_exc:
        raise last_exc
    raise Exception("GENIE-API request failed after retries")


@app.get("/api/dev/keys")
def dev_get_keys():
    """Return developer keys (masked) for UI display."""
    keys = _load_dev_keys()
    masked = {}
    for k, v in keys.items():
        if not v:
            masked[k] = ""
        else:
            masked[k] = v[:4] + "..." + v[-4:]
    return {"keys": masked}


@app.get("/api/dev/maps-key")
def dev_get_maps_key():
    """Return the actual (unmasked) Google Maps API key for client-side Places/Geocoding use."""
    key = get_config_key("GOOGLE_MAPS_API_KEY")
    return {"key": key or ""}


class DevKeysPayload(BaseModel):
    GOOGLE_MAPS_API_KEY: Optional[str] = None
    GOOGLE_GEMINI_API_KEY: Optional[str] = None
    GOOGLE_GEMINI_MODEL: Optional[str] = None
    JWT_SECRET: Optional[str] = None
    NUM_PARENTS: Optional[int] = None
    TRAVEL_TIME_CACHE_TTL: Optional[int] = None


@app.post("/api/dev/keys")
def dev_save_keys(payload: DevKeysPayload):
    """Save developer keys to backend/dev_keys.json and update process env for current run."""
    keys = _load_dev_keys()
    for field in ("GOOGLE_MAPS_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_GEMINI_MODEL", "JWT_SECRET", "NUM_PARENTS", "TRAVEL_TIME_CACHE_TTL"):
        val = getattr(payload, field)
        if val is not None:
            # store as string in dev keys / env to keep uniform types
            keys[field] = str(val)
            # update runtime env so immediate requests can use them
            os.environ[field] = str(val)
    _save_dev_keys(keys)
    return {"saved": True}


@app.post("/api/dev/reseed")
def dev_reseed():
    """Clear current in-memory parents/kids and reseed using current NUM_PARENTS."""
    global _kids, _parents, _next_id, _next_parent_id
    _kids = []
    _parents = []
    _next_id = 1
    _next_parent_id = 1
    try:
        _seed()
        return {"reseeded": True, "num_parents": len(_parents)}
    except Exception as e:
        _logger.error(f"DEV-RESEED error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory store (replace with a real DB later) ──────────────────────────
_kids: list[dict] = []
_next_id = 1

_parents: list[dict] = []
_next_parent_id = 1

# ── Server-Side Arrivals (Autonomous Loop) ──────────────────────────────────
# Dictionary mapping arrival_time (ISO string) to list of kid IDs
# e.g. {"2023-10-27T15:00:05": [1, 2], "2023-10-27T15:00:45": [5]}
_SCHEDULED_ARRIVALS: Dict[str, List[int]] = {}
_arrivals_lock = threading.Lock()

# ── Scan records ─────────────────────────────────────────────────────────────
PILLAR_COUNT  = 5
# Number of parents to seed for testing (defaults to 20; can be set in backend/.env)
NUM_PARENTS = int(os.getenv("NUM_PARENTS", "20"))
_scans: list[dict] = []
_next_scan_id       = 1
_next_seq           = 1
_pillar_assign_seq  = 1   # incremented only when a car reaches the scanner point (TURN_X)
# pillar assignment: nearest pillar (P5) for seq#1 so first car arrives first
# formula: PILLAR_COUNT - ((seq-1) % PILLAR_COUNT) → 1→P5, 2→P4, 3→P3, 4→P2, 5→P1, 6→P5, …
_scan_lock = threading.Lock()   # protects _next_seq, _next_scan_id, _scans mutations
_pickup_started  = False
_pickup_started_at: str | None = None   # ISO timestamp when "Start Pickup" was pressed
PICKUP_QUEUE_SIZE = PILLAR_COUNT   # active-pickup window size (one per pillar)

# ── Pickup lane physical parameters (from .env) ──────────────────────────────
# Total ramp + pickup road length in metres
PICKUP_ROAD_LENGTH_M    = float(os.getenv("PICKUP_ROAD_LENGTH_M",    "200"))
# Speed limit inside the pickup zone in km/h
PICKUP_SPEED_LIMIT_KMH  = float(os.getenv("PICKUP_SPEED_LIMIT_KMH",  "10"))
# Time (seconds) for one child to get picked up at the pillar
CHILD_PICKUP_TIME_S     = float(os.getenv("CHILD_PICKUP_TIME_S",     "10"))
# Minimum dwell time (seconds) each car must spend at the destination/pillar before moving off.
# Gemini uses this to space arrival recommendations so cars never leave sooner than this.
PICKUP_DWELL_SEC        = float(os.getenv("PICKUP_DWELL_SEC",        "40"))
# Minimum gap (seconds) between consecutive car arrivals at the destination.
# Smart-schedule floors arrival_spacing at this value so cars never arrive closer together.
ARRIVAL_GAP_SEC         = float(os.getenv("ARRIVAL_GAP_SEC",         "10"))
# Derived: time a single car occupies one pillar (drive-through + pickup)
_ROAD_TRAVERSE_S        = PICKUP_ROAD_LENGTH_M / (PICKUP_SPEED_LIMIT_KMH * 1000.0 / 3600.0)
_SECONDS_PER_CAR        = _ROAD_TRAVERSE_S + CHILD_PICKUP_TIME_S
# Theoretical max throughput for all pillars in cars per minute
THEORETICAL_THROUGHPUT_PER_MIN = round(PILLAR_COUNT * (60.0 / _SECONDS_PER_CAR), 4)
# Maximum allowed session duration in minutes (first car arrival → last car departure).
# The scheduler uses this as a deadline: arrival_spacing is tightened so that
# all N parents arrive within (PICKUP_PERIOD_MIN - wave_drain_min) minutes.
# Set to 0 to disable the period constraint.
PICKUP_PERIOD_MIN = float(os.getenv("PICKUP_PERIOD_MIN", "15"))
# Simulation speed override: when > 0, forces the inter-car arrival spacing to exactly
# this many seconds (ignores lane-physics floor).  Useful for demos/testing where you
# want cars to arrive every 1 s instead of the physics-dictated ~16 s.
# Set to 0 (default) to use the throughput-based spacing.
SIM_ARRIVAL_SPACING_S = float(os.getenv("SIM_ARRIVAL_SPACING_S", "0"))

# School location (default: a school somewhere in the US)
SCHOOL_LAT  = float(os.getenv("SCHOOL_LAT", "33.4484"))
SCHOOL_LNG  = float(os.getenv("SCHOOL_LNG", "-112.0740"))
# Maximum parent distance from school when seeding (km)
MAX_PARENT_DISTANCE_KM = float(os.getenv("MAX_PARENT_DISTANCE_KM", "3.0"))

# Seeding geometry — parents are placed at a realistic residential ring distance
# such that their *road* distance ≈ SEED_TARGET_ROUTE_KM from the school.
# Tortuosity converts road distance → straight-line: sl_radius = route_km / tortuosity
SEED_TARGET_ROUTE_KM   = float(os.getenv("SEED_TARGET_ROUTE_KM",   "2.5"))
SEED_ROUTE_TORTUOSITY  = float(os.getenv("SEED_ROUTE_TORTUOSITY",   "1.3"))
SEED_ROUTE_SPREAD_KM   = float(os.getenv("SEED_ROUTE_SPREAD_KM",    "0.2"))
# Equivalent straight-line radius for the target route distance
_SEED_SL_RADIUS_KM     = SEED_TARGET_ROUTE_KM / SEED_ROUTE_TORTUOSITY

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance between two lat/lng points in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Google Maps Travel Time Service ─────────────────────────────────────────

# Cache travel times to avoid excessive API calls (key: "lat,lng" → result)
_travel_time_cache: dict[str, dict] = {}
# TTL for cached travel times (read from .env for testing; default 1h)
_travel_time_cache_ttl = int(os.getenv("TRAVEL_TIME_CACHE_TTL", "3600"))  # seconds

# Cache AI results to avoid burning Gemini quota on repeated calls
# Key: endpoint name → {"result": …, "expires_at": float}
_ai_result_cache: dict[str, dict] = {}
_AI_CACHE_TTL = int(os.getenv("AI_CACHE_TTL", "60"))  # seconds (default 60 s)

def _cache_key(lat: float, lng: float) -> str:
    return f"{lat:.5f},{lng:.5f}"

def _get_google_maps_travel_time(
    origin_lat: float, origin_lng: float,
    dest_lat: float = SCHOOL_LAT, dest_lng: float = SCHOOL_LNG,
    departure_time: str = "now",
) -> dict:
    """
    Call Google Maps Distance Matrix API to get real-time travel time with traffic.
    Returns dict with:
      - travel_time_sec: duration in seconds (no traffic)
      - travel_time_traffic_sec: duration in seconds (with current traffic)
      - travel_time_min: duration in minutes (no traffic)
      - travel_time_traffic_min: duration in minutes (with traffic)
      - distance_m: distance in meters
      - distance_km: distance in km
      - traffic_condition: 'light' | 'moderate' | 'heavy'
      - source: 'google_maps' | 'haversine_estimate'
    """
    api_key = get_config_key("GOOGLE_MAPS_API_KEY")

    # Honour the GOOGLE_MAPS_TRAFFIC_ENABLED flag — skip the API call when false.
    traffic_enabled = os.getenv("GOOGLE_MAPS_TRAFFIC_ENABLED", "true").strip().lower() not in ("false", "0", "no")

    # Check cache first (TTL can be changed at runtime via TRAVEL_TIME_CACHE_TTL env)
    ttl = int(os.getenv("TRAVEL_TIME_CACHE_TTL", str(_travel_time_cache_ttl)))
    ck = _cache_key(origin_lat, origin_lng)
    cached = _travel_time_cache.get(ck)
    if cached and (time.time() - cached.get("_cached_at", 0)) < ttl:
        _logger.debug(f"TRAVEL-TIME  cache hit for {ck}")
        return {k: v for k, v in cached.items() if not k.startswith("_")}

    if not traffic_enabled:
        # Google Maps traffic disabled via GOOGLE_MAPS_TRAFFIC_ENABLED=false.
        # Return a haversine estimate with no traffic surcharge.
        dist_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
        est_min = round(dist_km / 30 * 60, 1)
        result = {
            "travel_time_sec": round(est_min * 60),
            "travel_time_traffic_sec": round(est_min * 60),
            "travel_time_min": est_min,
            "travel_time_traffic_min": est_min,
            "distance_m": round(dist_km * 1000),
            "distance_km": round(dist_km, 2),
            "traffic_condition": "disabled",
            "source": "haversine_disabled",
        }
        _travel_time_cache[ck] = {**result, "_cached_at": time.time()}
        _logger.debug(json.dumps({"type": "travel_time", "source": "haversine_disabled", "lat": round(origin_lat, 4), "lng": round(origin_lng, 4), "travel_time_min": est_min}))
        return result

    if not api_key:
        # Fallback: estimate from haversine distance at ~30 km/h (city driving)
        dist_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
        est_min = round(dist_km / 30 * 60, 1)
        # Add random traffic variation for simulation (±30%)
        traffic_factor = random.uniform(1.0, 1.6)
        traffic_min = round(est_min * traffic_factor, 1)
        traffic_cond = "light" if traffic_factor < 1.2 else ("moderate" if traffic_factor < 1.4 else "heavy")
        result = {
            "travel_time_sec": round(est_min * 60),
            "travel_time_traffic_sec": round(traffic_min * 60),
            "travel_time_min": est_min,
            "travel_time_traffic_min": traffic_min,
            "distance_m": round(dist_km * 1000),
            "distance_km": round(dist_km, 2),
            "traffic_condition": traffic_cond,
            "source": "haversine_estimate",
        }
        _travel_time_cache[ck] = {**result, "_cached_at": time.time()}
        return result

    # Real Google Maps Distance Matrix API call
    try:
        url = "https://maps.googleapis.com/maps/api/distancematrix/json"
        params = {
            "origins": f"{origin_lat},{origin_lng}",
            "destinations": f"{dest_lat},{dest_lng}",
            "mode": "driving",
            "departure_time": departure_time,
            "traffic_model": "best_guess",
            # key intentionally omitted from structured log
        }
        # Structured log for request (exclude API key)
        _logger.debug(json.dumps({"type": "maps_request", "origins": params["origins"], "destinations": params["destinations"], "mode": params["mode"]}))
        with httpx.Client(timeout=20) as client:
            resp = client.get(url, params={**params, "key": api_key})
            # Structured log for response summary (body length only)
            _logger.debug(json.dumps({"type": "maps_response", "status": resp.status_code, "body_len": len(resp.text)}))
            resp.raise_for_status()
            data = resp.json()

        if data.get("status") != "OK":
            raise ValueError(f"Google Maps API error: {data.get('status')}")

        element = data["rows"][0]["elements"][0]
        if element.get("status") != "OK":
            raise ValueError(f"Route not found: {element.get('status')}")

        duration_sec = element["duration"]["value"]
        duration_traffic_sec = element.get("duration_in_traffic", element["duration"])["value"]
        distance_m = element["distance"]["value"]

        traffic_ratio = duration_traffic_sec / max(duration_sec, 1)
        traffic_cond = "light" if traffic_ratio < 1.15 else ("moderate" if traffic_ratio < 1.4 else "heavy")

        result = {
            "travel_time_sec": duration_sec,
            "travel_time_traffic_sec": duration_traffic_sec,
            "travel_time_min": round(duration_sec / 60, 1),
            "travel_time_traffic_min": round(duration_traffic_sec / 60, 1),
            "distance_m": distance_m,
            "distance_km": round(distance_m / 1000, 2),
            "traffic_condition": traffic_cond,
            "source": "google_maps",
        }
        _travel_time_cache[ck] = {**result, "_cached_at": time.time()}
        _logger.debug(json.dumps({
            "type": "travel_time",
            "source": "google_maps",
            "lat": round(origin_lat, 4),
            "lng": round(origin_lng, 4),
            "travel_time_min": result['travel_time_min'],
            "travel_time_traffic_min": result['travel_time_traffic_min'],
            "condition": traffic_cond
        }))
        return result

    except Exception as e:
        _logger.warning(f"TRAVEL-TIME  Google Maps API failed: {e}, falling back to haversine")
        dist_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
        est_min = round(dist_km / 30 * 60, 1)
        return {
            "travel_time_sec": round(est_min * 60),
            "travel_time_traffic_sec": round(est_min * 60),
            "travel_time_min": est_min,
            "travel_time_traffic_min": est_min,
            "distance_m": round(dist_km * 1000),
            "distance_km": round(dist_km, 2),
            "traffic_condition": "unknown",
            "source": "haversine_fallback",
        }

def _arrival_heartbeat_thread():
    """
    Background thread that runs once per second.
    Checks if current UTC time matches any entry in _SCHEDULED_ARRIVALS.
    If match, performs an internal scan for the kid (equivalent to /api/scan POST).
    This runs entirely server-side so the simulation continues even when the frontend
    is backgrounded, the device screen is locked, or the browser tab is suspended.
    """
    _logger.debug("HEARTBEAT started: Autonomous arrival loop is active")
    while True:
        try:
            now_iso = datetime.datetime.utcnow().isoformat(timespec='seconds')

            with _arrivals_lock:
                keys_to_process = [t for t in _SCHEDULED_ARRIVALS.keys() if t <= now_iso]

            for t in sorted(keys_to_process):
                with _arrivals_lock:
                    kid_ids = _SCHEDULED_ARRIVALS.pop(t, [])

                for kid_id in kid_ids:
                    kid = next((k for k in _kids if k["id"] == kid_id), None)
                    if not kid:
                        _logger.warning(f"HEARTBEAT  Scheduled arrival for kid_id {kid_id} not found — skipping")
                        continue

                    # Check if already scanned
                    existing = next((s for s in _scans if s["kid_id"] == kid_id), None)
                    if existing:
                        _logger.debug(f"HEARTBEAT  kid_id={kid_id} ({kid['name']}) already scanned — skipping")
                        continue

                    # Perform internal scan — identical logic to scan_kid() route
                    global _next_scan_id, _next_seq, _pickup_started
                    with _scan_lock:
                        # pillar is 0 here — assigned later when car reaches the scanner point
                        record = {
                            "id":               _next_scan_id,
                            "kid_id":           kid_id,
                            "name":             kid["name"],
                            "pillar":           0,
                            "seq":              _next_seq,
                            "scanned_at":       datetime.datetime.utcnow().isoformat(),
                            "pickup_started_at": _pickup_started_at,
                            "car_arrived":      False,
                            "picked_up":        False,
                            "picked_up_at":     None,
                            "queue_status":     "waiting",
                        }
                        _scans.append(record)
                        _logger.debug(f"HEARTBEAT  AUTO-SCAN seq={_next_seq} kid_id={kid_id} name='{kid['name']}' pillar=unassigned (scheduled {t})")
                        _next_scan_id += 1
                        _next_seq     += 1

                        # Promote into pickup lane if pickup is running and slots are available
                        if _pickup_started:
                            current_pickup = len([s for s in _scans if s["queue_status"] == "pickup"])
                            if current_pickup < PICKUP_QUEUE_SIZE:
                                _advance_queue(PICKUP_QUEUE_SIZE - current_pickup)

            time.sleep(1.0)
        except Exception as e:
            _logger.error(f"HEARTBEAT  error in background thread: {e}")
            time.sleep(5.0)

# NOTE: The daemon thread is started at the BOTTOM of this file (after all helpers/routes
# are defined) to avoid forward-reference issues at import time.


def _get_all_parent_travel_times() -> list[dict]:
    """Get travel times for all parents (uses cache heavily)."""
    results = []
    for parent in _parents:
        tt = _get_google_maps_travel_time(parent["location_lat"], parent["location_lng"])
        results.append({
            "parent_id": parent["id"],
            "parent_name": parent["name"],
            **tt,
        })
    return results

def _seed():
    global _next_id, _next_parent_id
    first_names = [
        "Emma","Liam","Olivia","Noah","Ava","Ethan","Sophia","Mason","Isabella","William",
        "Mia","James","Charlotte","Benjamin","Amelia","Lucas","Harper","Henry","Evelyn","Alexander",
        "Abigail","Michael","Emily","Daniel","Elizabeth","Jacob","Sofia","Logan","Avery","Jackson",
        "Ella","Sebastian","Scarlett","Jack","Grace","Aiden","Chloe","Owen","Victoria","Samuel",
        "Riley","Matthew","Aria","Joseph","Lily","Levi","Aubrey","David","Zoey","John",
        "Penelope","Carter","Layla","Dylan","Nora","Luke","Camila","Gabriel","Hannah","Julian",
        "Addison","Isaac","Ellie","Lincoln","Stella","Joshua","Hazel","Caleb","Paisley","Nathan",
        "Savannah","Adrian","Aurora","Leo","Brooklyn","Eli","Bella","Landon","Claire","Jaxon",
        "Skylar","Asher","Violet","Ryan","Lucy","Miles","Anna","Ezra","Samantha","Grayson",
        "Caroline","Connor","Genesis","Cooper","Madelyn","Jeremiah","Aaliyah","Roman","Ivy","Hunter",
    ]
    last_names = [
        "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
        "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
        "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
        "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
        "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
        "Phillips","Evans","Turner","Diaz","Parker","Cruz","Edwards","Collins","Reyes","Stewart",
        "Morris","Morales","Murphy","Cook","Rogers","Gutierrez","Ortiz","Morgan","Cooper","Peterson",
        "Bailey","Reed","Kelly","Howard","Ramos","Kim","Cox","Ward","Richardson","Watson",
        "Brooks","Chavez","Wood","Bennett","Gray","Mendez","Ruiz","Hughes","Price","Alvarez",
        "Castillo","Sanders","Patel","Myers","Long","Ross","Foster","Jimenez","Powell","Jenkins",
    ]
    grades = ["Kindergarten","1st Grade","2nd Grade","3rd Grade","4th Grade","5th Grade",
              "6th Grade","7th Grade","8th Grade"]
    # One parent per kid (1:1 relationship) — 100 parents for 100 kids
    parent_first = [
        "Robert","Jennifer","David","Sarah","Michael","Jessica","John","Amanda","Chris","Michelle",
        "Brian","Lisa","Steven","Karen","Mark","Angela","Scott","Nancy","Paul","Laura",
        "Kevin","Sharon","Jason","Donna","Tom","Carol","Jeff","Teresa","Greg","Diane",
        "Andrew","Rachel","Patrick","Linda","Larry","Sandra","Dennis","Helen","George","Betty",
        "Frank","Anne","Raymond","Marie","Douglas","Julie","Carl","Dorothy","Roger","Martha",
        "Walter","Gloria","Arthur","Brenda","Lawrence","Pamela","Eric","Janet","Gerald","Robin",
        "Ralph","Debra","Albert","Tammy","Willie","Irene","Russell","Janice","Jose","Kelly",
        "Roy","Tina","Eugene","Christine","Randy","Theresa","Harry","Beverly","Philip","Denise",
        "Howard","Marilyn","Carlos","Amber","Bruce","Danielle","Terry","Natalie","Louis","Brittany",
        "Wayne","Diana","Joe","Cindy","Alan","Regina","Harold","Wendy","Peter","Sylvia",
    ]

    n_parents = int(os.getenv("NUM_PARENTS", str(NUM_PARENTS)))
    for i in range(n_parents):
        fn = first_names[i % len(first_names)]
        ln = last_names[i % len(last_names)]
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

        # One parent per kid (1:1)
        pfn = parent_first[i % len(parent_first)]
        # Tight-cluster coordinates entirely inside Cumbres 1er Sector, same road-accessible
        # grid as the school. All stay within lng -100.448 … -100.472 (west of Av. Lázaro
        # Cárdenas) and lat 25.751 … 25.777, so Google Maps never needs to cross a major
        # arterial. Max straight-line ≈ 1.5 km → road distance ≤ ~2.5 km.
        # School anchor: (25.763762, -100.457603)
        _SEED_LOCATIONS = [
            # ── very close (< 0.5 km) ────────────────────────────────────────
            (25.7650, -100.4576, "Cumbres 1er Sector – Calle Pinos A",            0.1),
            (25.7625, -100.4576, "Cumbres 1er Sector – Calle Pinos B",            0.2),
            (25.7650, -100.4600, "Cumbres 1er Sector – Calle Cedros A",           0.3),
            (25.7625, -100.4555, "Cumbres 1er Sector – Calle Cedros B",           0.3),
            (25.7660, -100.4554, "Cumbres 1er Sector – Calle Robles A",           0.4),
            (25.7615, -100.4598, "Cumbres 1er Sector – Calle Robles B",           0.4),
            (25.7672, -100.4576, "Cumbres 1er Sector – Av. Álamos N",             0.5),
            (25.7605, -100.4576, "Cumbres 1er Sector – Av. Álamos S",             0.5),
            # ── 0.5–0.9 km ───────────────────────────────────────────────────
            (25.7650, -100.4620, "Cumbres 1er Sector – Cerrada Fresnos A",        0.6),
            (25.7680, -100.4555, "Cumbres 1er Sector – Privada Encinos A",        0.6),
            (25.7600, -100.4555, "Cumbres 1er Sector – Privada Encinos B",        0.6),
            (25.7638, -100.4620, "Cumbres 1er Sector – Calle Magnolias A",        0.7),
            (25.7690, -100.4576, "Cumbres 1erEctor – Calle Magnolias B",        0.7),
            (25.7595, -100.4620, "Cumbres 1er Sector – Calle Magnolias C",        0.7),
            (25.7665, -100.4620, "Cumbres 1er Sector – Privada Laureles A",       0.8),
            (25.7580, -100.4576, "Cumbres 1er Sector – Privada Laureles B",       0.8),
            (25.7700, -100.4555, "Cumbres 1er Sector – Cerrada Nogales A",        0.9),
            (25.7580, -100.4555, "Cumbres 1er Sector – Cerrada Nogales B",        0.9),
            (25.7650, -100.4640, "Cumbres 1er Sector – Av. Arcos A",              0.9),
            (25.7615, -100.4640, "Cumbres 1er Sector – Av. Arcos B",              0.9),
            # ── 0.9–1.3 km ───────────────────────────────────────────────────
            (25.7710, -100.4576, "Cumbres 1er Sector – Calle del Bosque A",       1.0),
            (25.7567, -100.4576, "Cumbres 1er Sector – Calle del Bosque B",       1.0),
            (25.7680, -100.4620, "Cumbres 1er Sector – Calle Cipreses A",         1.0),
            (25.7600, -100.4640, "Cumbres 1er Sector – Calle Cipreses B",         1.0),
            (25.7720, -100.4555, "Cumbres 1er Sector – Privada Pinos N",          1.1),
            (25.7558, -100.4596, "Cumbres 1er Sector – Privada Pinos S",          1.1),
            (25.7695, -100.4640, "Cumbres 1er Sector – Cerrada Álamos A",         1.1),
            (25.7583, -100.4640, "Cumbres 1er Sector – Cerrada Álamos B",         1.1),
            (25.7730, -100.4576, "Cumbres 1er Sector – Av. Norte A",              1.2),
            (25.7550, -100.4576, "Cumbres 1er Sector – Av. Sur A",                1.2),
            (25.7712, -100.4620, "Cumbres 1er Sector – Calle Eucaliptos A",       1.2),
            (25.7570, -100.4640, "Cumbres 1er Sector – Calle Eucaliptos B",       1.2),
            (25.7650, -100.4655, "Cumbres 1er Sector – Cerrada del Roble A",      1.3),
            (25.7720, -100.4595, "Cumbres 1er Sector – Cerrada del Roble B",      1.3),
            (25.7556, -100.4555, "Cumbres 1er Sector – Cerrada del Roble C",      1.3),
            # ── 1.3–1.7 km ───────────────────────────────────────────────────
            (25.7740, -100.4555, "Cumbres 1er Sector – Calle Fresnos Norte A",    1.4),
            (25.7542, -100.4555, "Cumbres 1er Sector – Calle Fresnos Sur A",      1.4),
            (25.7725, -100.4620, "Cumbres 1er Sector – Privada Nogales N",        1.4),
            (25.7558, -100.4655, "Cumbres 1er Sector – Privada Nogales S",        1.4),
            (25.7665, -100.4658, "Cumbres 1er Sector – Cerrada Magnolias A",      1.5),
            (25.7748, -100.4576, "Cumbres 1er Sector – Av. Principal N",          1.5),
            (25.7533, -100.4576, "Cumbres 1er Sector – Av. Principal S",          1.5),
            (25.7638, -100.4658, "Cumbres 1er Sector – Cerrada Encinos A",        1.5),
            (25.7737, -100.4620, "Cumbres 1er Sector – Calle Laureles Norte A",   1.6),
            (25.7546, -100.4640, "Cumbres 1er Sector – Calle Laureles Sur A",     1.6),
            (25.7757, -100.4555, "Cumbres 1er Sector – Privada del Norte A",      1.6),
            (25.7525, -100.4596, "Cumbres 1er Sector – Privada del Sur A",        1.6),
            (25.7690, -100.4658, "Cumbres 1er Sector – Privada Arcos A",          1.7),
            (25.7750, -100.4600, "Cumbres 1er Sector – Privada Arcos B",          1.7),
            (25.7525, -100.4555, "Cumbres 1er Sector – Privada Arcos C",          1.7),
            (25.7615, -100.4658, "Cumbres 1er Sector – Cerrada Pinos SO",         1.7),
            # ── 1.7–2.1 km ───────────────────────────────────────────────────
            (25.7760, -100.4620, "Cumbres 1er Sector – Calle Cedros Norte A",     1.8),
            (25.7515, -100.4640, "Cumbres 1er Sector – Calle Cedros Sur A",       1.8),
            (25.7766, -100.4576, "Cumbres 1er Sector – Cerrada Norte A",          1.8),
            (25.7513, -100.4576, "Cumbres 1er Sector – Cerrada Sur A",            1.8),
            (25.7760, -100.4555, "Cumbres 1er Sector – Privada Cipreses N",       1.9),
            (25.7512, -100.4555, "Cumbres 1er Sector – Privada Cipreses S",       1.9),
            (25.7715, -100.4658, "Cumbres 1er Sector – Cerrada Robles NO",        1.9),
            (25.7598, -100.4660, "Cumbres 1er Sector – Cerrada Robles SO",        1.9),
            (25.7773, -100.4600, "Cumbres 1er Sector – Av. Norte II A",           2.0),
            (25.7507, -100.4600, "Cumbres 1er Sector – Av. Sur II A",             2.0),
            (25.7773, -100.4555, "Cumbres 1er Sector – Privada Norte II",         2.0),
            (25.7508, -100.4555, "Cumbres 1er Sector – Privada Sur II",           2.0),
            (25.7730, -100.4658, "Cumbres 1er Sector – Calle Álamos NO",          2.1),
            (25.7583, -100.4660, "Cumbres 1er Sector – Calle Álamos SO",          2.1),
            (25.7776, -100.4640, "Cumbres 1er Sector – Cerrada Fresnos N",        2.1),
            (25.7505, -100.4640, "Cumbres 1er Sector – Cerrada Fresnos S",        2.1),
            # ── 2.1–2.5 km ───────────────────────────────────────────────────
            (25.7776, -100.4576, "Cumbres 1er Sector – Calle Encinos N",          2.2),
            (25.7502, -100.4576, "Cumbres 1er Sector – Calle Encinos S",          2.2),
            (25.7744, -100.4660, "Cumbres 1er Sector – Privada Eucaliptos NO",    2.2),
            (25.7567, -100.4662, "Cumbres 1er Sector – Privada Eucaliptos SO",    2.2),
            (25.7778, -100.4620, "Cumbres 1er Sector – Av. Laureles N",           2.3),
            (25.7500, -100.4620, "Cumbres 1er Sector – Av. Laureles S",           2.3),
            (25.7758, -100.4660, "Cumbres 1er Sector – Cerrada Nogales NO",       2.3),
            (25.7553, -100.4662, "Cumbres 1er Sector – Cerrada Nogales SO",       2.3),
            (25.7779, -100.4555, "Cumbres 1er Sector – Cerrada Norte III",        2.4),
            (25.7498, -100.4555, "Cumbres 1er Sector – Cerrada Sur III",          2.4),
            (25.7772, -100.4660, "Cumbres 1er Sector – Privada del Río N",        2.4),
            (25.7540, -100.4662, "Cumbres 1er Sector – Privada del Río S",        2.4),
            (25.7779, -100.4600, "Cumbres 1er Sector – Calle Pinos Ext N",        2.5),
            (25.7496, -100.4600, "Cumbres 1er Sector – Calle Pinos Ext S",        2.5),
            # ── 2.5–3.0 km (boundary ring, still inside Cumbres 1er Sector) ──
            (25.7779, -100.4640, "Cumbres 1er Sector – Av. Los Leones NE",        2.6),
            (25.7494, -100.4640, "Cumbres 1er Sector – Av. Los Leones SE",        2.6),
            (25.7780, -100.4660, "Cumbres 1er Sector – Cerrada Bosques N",        2.7),
            (25.7527, -100.4662, "Cumbres 1er Sector – Cerrada Bosques S",        2.7),
            (25.7775, -100.4680, "Cumbres 1er Sector – Privada Vals Norte",       2.7),
            (25.7515, -100.4680, "Cumbres 1er Sector – Privada Vals Sur",         2.8),
            (25.7493, -100.4580, "Cumbres 1er Sector – Cerrada Sur IV",           2.8),
            (25.7778, -100.4680, "Cumbres 1er Sector – Calle del Bosque N",       2.9),
            (25.7504, -100.4662, "Cumbres 1er Sector – Calle del Bosque S",       2.9),
            (25.7490, -100.4600, "Cumbres 1er Sector – Cerrada Sur V",            2.9),
            (25.7776, -100.4700, "Cumbres 1er Sector – Privada Poniente N",       3.0),
            (25.7492, -100.4680, "Cumbres 1er Sector – Privada Poniente S",       3.0),
        ]
        loc = _SEED_LOCATIONS[i % len(_SEED_LOCATIONS)]
        plat, plng, ploc_name, _route_km_approx = loc
        parent = {
            "id": _next_parent_id,
            "name": f"{pfn} {ln}",
            "phone": f"(555) {100+_next_parent_id:03d}-0000",
            "email": f"{pfn.lower()}.{ln.lower()}@example.com",
            "location_lat": plat,
            "location_lng": plng,
            "location_address": ploc_name,
            "distance_km": 0.0,  # will be computed
            "travel_time_min": 0.0,          # baseline (no traffic)
            "travel_time_traffic_min": 0.0,   # with traffic
            "traffic_condition": "unknown",   # light | moderate | heavy
            "travel_source": "pending",       # google_maps | haversine_estimate
            "kid_id": _next_id,  # 1:1 — single kid
            "logged_in": False,
        }
        parent["distance_km"] = round(_haversine_km(plat, plng, SCHOOL_LAT, SCHOOL_LNG), 2)
        # Initial travel time estimate (will be updated via Google Maps when available)
        tt = _get_google_maps_travel_time(plat, plng)
        parent["travel_time_min"] = tt["travel_time_min"]
        parent["travel_time_traffic_min"] = tt["travel_time_traffic_min"]
        parent["traffic_condition"] = tt["traffic_condition"]
        parent["travel_source"] = tt["source"]
        # Use road distance from Google Maps when available (more accurate than straight-line)
        if tt["source"] == "google_maps":
            parent["distance_km"] = tt["distance_km"]
        _parents.append(parent)
        pid = _next_parent_id
        _next_parent_id += 1

        _kids.append({
            "id": _next_id,
            "name": f"{fn} {ln}",
            "grade": grades[i % len(grades)],
            "parent_id": pid,
            "parent_name": parent["name"],
            "parent_phone": parent["phone"],
            "parent_email": parent["email"],
            "pickup_code": code,
            "created_at": datetime.datetime.utcnow().isoformat(),
        })
        _next_id += 1

_seed()

def _advance_queue(n: int):
    """Move up to n records (lowest seq) from waiting → pickup queue.
    Never exceeds PILLAR_COUNT total items in 'pickup' state — this prevents the
    over-promotion race that occurs when start_parent / start_pickup / start_all_parents
    are all called concurrently during an AI-scheduled wave."""
    current_pickup = len([s for s in _scans if s["queue_status"] == "pickup"])
    effective_n = min(n, max(0, PILLAR_COUNT - current_pickup))
    if effective_n <= 0:
        return
    waiting = sorted([s for s in _scans if s["queue_status"] == "waiting"], key=lambda s: s["seq"])
    for record in waiting[:effective_n]:
        record["queue_status"] = "pickup"

# ── Models ───────────────────────────────────────────────────────────────────
class KidIn(BaseModel):
    name: str
    grade: str
    parent_name: str
    parent_phone: str
    parent_email: Optional[str] = None
    pickup_code: str

class ScanIn(BaseModel):
    kid_id: int
    name:   str
    pillar: Optional[int] = None   # if omitted the server auto-assigns using its own cycle

class KidUpdate(BaseModel):
    name: Optional[str] = None
    grade: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[str] = None
    pickup_code: Optional[str] = None

# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/api/kids")
def list_kids():
    return _kids

@app.get("/api/kids/{kid_id}")
def get_kid(kid_id: int):
    kid = next((k for k in _kids if k["id"] == kid_id), None)
    if not kid:
        raise HTTPException(status_code=404, detail="Kid not found")
    return kid

@app.post("/api/kids", status_code=201)
def create_kid(kid: KidIn):
    global _next_id
    new_kid = {**kid.model_dump(), "id": _next_id, "created_at": datetime.datetime.utcnow().isoformat()}
    _kids.append(new_kid)
    _next_id += 1
    return new_kid

@app.put("/api/kids/{kid_id}")
def update_kid(kid_id: int, updates: KidUpdate):
    kid = next((k for k in _kids if k["id"] == kid_id), None)
    if not kid:
        raise HTTPException(status_code=404, detail="Kid not found")
    kid.update({k: v for k, v in updates.model_dump().items() if v is not None})
    return kid

@app.delete("/api/kids/{kid_id}", status_code=204)
def delete_kid(kid_id: int):
    global _kids
    before = len(_kids)
    _kids = [k for k in _kids if k["id"] != kid_id]
    if len(_kids) == before:
        raise HTTPException(status_code=404, detail="Kid not found")

@app.get("/api/kids/by-code/{code}")
def get_kid_by_code(code: str):
    """Look up a kid by their pickup_code (case-insensitive). Used by parent barcode scan."""
    match = next((k for k in _kids if k.get("pickup_code", "").upper() == code.upper()), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"No kid found with code '{code}'")
    parent = next((p for p in _parents if p["id"] == match.get("parent_id")), None)
    scan   = next((s for s in _scans if s["kid_id"] == match["id"]), None)
    return {
        "kid":    match,
        "parent": parent,
        "scan":   scan,  # null if not yet scanned
    }

# ── Scan endpoints ────────────────────────────────────────────────────────────
@app.post("/api/scan", status_code=201)
def scan_kid(data: ScanIn):
    """Record a scanned kid. Server assigns seq; pillar is 0 (unassigned) until car reaches the scanner."""
    global _next_scan_id, _next_seq
    with _scan_lock:
        # Pillar is NOT assigned here — it is assigned dynamically when the car
        # physically reaches the scanner point (POST /api/scan/{kid_id}/assign-pillar).
        record = {
            "id":               _next_scan_id,
            "kid_id":           data.kid_id,
            "name":             data.name,
            "pillar":           0,
            "seq":              _next_seq,
            "scanned_at":       datetime.datetime.utcnow().isoformat(),
            "pickup_started_at": _pickup_started_at,  # None if pickup not yet started
            "car_arrived":      False,
            "picked_up":        False,
            "picked_up_at":     None,
            "queue_status":     "waiting",   # waiting | pickup | done
        }
        _scans.append(record)
        _logger.debug(f"SCAN  seq={_next_seq} kid_id={data.kid_id} name='{data.name}' pillar=unassigned status=waiting")
        _next_scan_id += 1
        _next_seq     += 1
        # Promote into pickup lane immediately if pickup is already running and slots are free.
        # Mirrors the same logic in the heartbeat auto-scan so manually scanned cars
        # are never left stranded in "waiting" when the school lane has open pillars.
        if _pickup_started:
            current_pickup = len([s for s in _scans if s["queue_status"] == "pickup"])
            if current_pickup < PICKUP_QUEUE_SIZE:
                _advance_queue(PICKUP_QUEUE_SIZE - current_pickup)
                _logger.debug(f"SCAN  auto-promoted to pickup (pickup_count now {len([s for s in _scans if s['queue_status'] == 'pickup'])})")
    return record

@app.post("/api/scan/{kid_id}/assign-pillar")
def assign_pillar_at_scanner(kid_id: int):
    """Assign the next pillar in the rotation to a car that has reached the scanner point.
    Called by the visualization when a car arrives at TURN_X and enters the pickup gate.
    Idempotent: if the pillar was already assigned, returns the existing record unchanged."""
    global _pillar_assign_seq
    with _scan_lock:
        record = next((s for s in _scans if s["kid_id"] == kid_id), None)
        if not record:
            raise HTTPException(status_code=404, detail="Scan record not found")
        if record["pillar"] != 0:
            # Already assigned — return current assignment (idempotent)
            return record
        pillar = PILLAR_COUNT - ((_pillar_assign_seq - 1) % PILLAR_COUNT)
        record["pillar"] = pillar
        _pillar_assign_seq += 1
        _logger.debug(f"PILLAR-ASSIGN  seq={record['seq']} kid_id={kid_id} name='{record['name']}' → P{pillar} (at scanner)")
        return record


@app.get("/api/scan")
def list_scans():
    """Return all scan assignments (ordered by seq)."""
    return sorted(_scans, key=lambda s: s["seq"])

@app.get("/api/scan/{kid_id}")
def get_scan_by_kid(kid_id: int):
    """Return the scan assignment for a specific kid."""
    record = next((s for s in _scans if s["kid_id"] == kid_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Scan record not found")
    return record

@app.post("/api/scan/{kid_id}/car-arrived")
def car_arrived(kid_id: int):
    """Called by visualization when a car reaches the pickup spot at a pillar."""
    with _scan_lock:
        record = next((s for s in _scans if s["kid_id"] == kid_id), None)
        if not record:
            _logger.warning(f"CAR-ARRIVED  kid_id={kid_id} NOT FOUND in scans")
            raise HTTPException(status_code=404, detail="Scan record not found")
        record["car_arrived"] = True
        _logger.debug(f"CAR-ARRIVED  seq={record['seq']} kid_id={kid_id} name='{record['name']}' pillar={record['pillar']}")
        return record

@app.post("/api/scan/{kid_id}/pickup")
def confirm_pickup(kid_id: int):
    """Called by pillar manager to confirm the kid has entered the car."""
    with _scan_lock:
        record = next((s for s in _scans if s["kid_id"] == kid_id), None)
        if not record:
            _logger.warning(f"CONFIRM-PICKUP  kid_id={kid_id} NOT FOUND in scans")
            raise HTTPException(status_code=404, detail="Scan record not found")
        record["picked_up"]    = True
        record["picked_up_at"] = datetime.datetime.utcnow().isoformat()
        record["queue_status"] = "done"
        _logger.debug(f"PICKUP-CONFIRMED  seq={record['seq']} kid_id={kid_id} name='{record['name']}' pillar={record['pillar']}")
        # Auto-advance: top up the pickup queue back to PILLAR_COUNT capacity.
        # Lock ensures concurrent confirms serialize, preventing double-counting.
        if _pickup_started:
            current_pickup = len([s for s in _scans if s["queue_status"] == "pickup"])
            slots_to_fill  = max(0, PILLAR_COUNT - current_pickup)
            if slots_to_fill > 0:
                _advance_queue(slots_to_fill)
                advanced = sorted([s for s in _scans if s["queue_status"] == "pickup"], key=lambda s: s["seq"])
                newly    = advanced[-slots_to_fill:] if slots_to_fill <= len(advanced) else advanced
                names    = [f"seq={s['seq']} '{s['name']}'" for s in newly]
                _logger.debug(f"QUEUE-ADVANCE  filled {slots_to_fill} slot(s): {', '.join(names) or 'none'}")
            else:
                _logger.debug("QUEUE-ADVANCE  pickup queue already full, no promotion needed")
        return record

# ── Car queue management endpoints ──────────────────────────────────────────

@app.post("/api/queue/start")
def start_pickup():
    """Start pickup: promote scans from waiting → pickup up to PILLAR_COUNT total.
    Safe to call even if start_parent has already promoted some items."""
    global _pickup_started, _pickup_started_at
    with _scan_lock:
        _pickup_started = True
        if _pickup_started_at is None:
            _pickup_started_at = datetime.datetime.utcnow().isoformat()
        # Stamp every waiting record with the pickup start time
        for s in _scans:
            if s.get("pickup_started_at") is None:
                s["pickup_started_at"] = _pickup_started_at
        # Only fill the remaining slots — _advance_queue also caps internally, but
        # we compute slots_to_fill here so the log reflects what was *newly* promoted.
        before_pickup_ids = {s["id"] for s in _scans if s["queue_status"] == "pickup"}
        _advance_queue(PICKUP_QUEUE_SIZE)  # capped internally at PILLAR_COUNT total
        after_pickup = sorted([s for s in _scans if s["queue_status"] == "pickup"], key=lambda s: s["seq"])
        newly_promoted = [s for s in after_pickup if s["id"] not in before_pickup_ids]
        names = [f"seq={s['seq']} '{s['name']}'" for s in newly_promoted]
        _logger.debug(f"PICKUP-STARTED  newly_promoted={len(newly_promoted)} total_in_pickup={len(after_pickup)} records: {', '.join(names) or 'none'}")
        total_waiting = len([s for s in _scans if s["queue_status"] == "waiting"])
        _logger.debug(f"PICKUP-STARTED  still waiting={total_waiting}  total_scans={len(_scans)}")
    return {
            "started": True,
            "pickup": after_pickup,
        }

@app.get("/api/queue/waiting")
def get_waiting_queue():
    """All scan records still waiting on main road (not yet active)."""
    return sorted([s for s in _scans if s["queue_status"] == "waiting"], key=lambda s: s["seq"])

@app.get("/api/queue/pickup")
def get_pickup_queue():
    """Scan records currently active in the pickup lane."""
    return sorted([s for s in _scans if s["queue_status"] == "pickup"], key=lambda s: s["seq"])

@app.get("/api/queue/status")
def queue_status_endpoint():
    """Summary counts for dashboard display."""
    return {
        "started":            _pickup_started,
        "pickup_started_at":  _pickup_started_at,
        "waiting": len([s for s in _scans if s["queue_status"] == "waiting"]),
        "pickup":  len([s for s in _scans if s["queue_status"] == "pickup"]),
        "done":    len([s for s in _scans if s["queue_status"] == "done"]),
    }

@app.get("/api/pillar/{pillar_num}")
def list_scans_by_pillar(pillar_num: int):
    """Return all scan records assigned to a specific pillar, ordered by seq."""
    return sorted([s for s in _scans if s["pillar"] == pillar_num], key=lambda s: s["seq"])

@app.delete("/api/scan", status_code=204)
def reset_scans():
    """Clear all scan records, reset counters, and cancel pending autonomous arrivals."""
    global _scans, _next_scan_id, _next_seq, _pillar_assign_seq, _pickup_started, _pickup_started_at
    _logger.debug(f"RESET  clearing {len(_scans)} scan records")
    _scans              = []
    _next_scan_id       = 1
    _next_seq           = 1
    _pillar_assign_seq  = 1
    _pickup_started     = False
    _pickup_started_at  = None
    # Also clear any pending autonomous arrivals so a fresh schedule can be applied
    with _arrivals_lock:
        count = sum(len(v) for v in _SCHEDULED_ARRIVALS.values())
        _SCHEDULED_ARRIVALS.clear()
        if count:
            _logger.debug(f"RESET  cancelled {count} pending autonomous arrivals")


# ── Log endpoint ─────────────────────────────────────────────────────────────
@app.get("/api/logs")
def get_logs(limit: int = 200):
    """Return the most recent backend log entries (newest last)."""
    entries = list(_log_buffer)
    return entries[-limit:]


# ── Server-Side Arrival Management (AI Scheduling) ───────────────────────────

class ScheduleItem(BaseModel):
    kid_id: int
    name: str
    arrival_time_iso: str

@app.post("/api/parent-admin/apply-schedule")
def apply_schedule(items: List[ScheduleItem]):
    """
    Called by AI (frontend) to hand over an optimized pickup schedule to the backend.
    Clears existing scheduled arrivals and sets new ones.
    """
    global _SCHEDULED_ARRIVALS
    with _arrivals_lock:
        _SCHEDULED_ARRIVALS.clear()
        for item in items:
            t = item.arrival_time_iso
            # Ensure the ISO string is normalized/truncated for dictionary keys
            # (assuming precision to the second is fine for the heartbeat)
            if t not in _SCHEDULED_ARRIVALS:
                _SCHEDULED_ARRIVALS[t] = []
            _SCHEDULED_ARRIVALS[t].append(item.kid_id)
        
        _logger.debug(f"SCHEDULE  applied {len(items)} arrivals for autonomous pickup")
    return {"status": "ok", "count": len(items)}

@app.get("/api/parent-admin/scheduled-arrivals")
def list_scheduled_arrivals():
    """Return the current list of pending server-side arrivals."""
    with _arrivals_lock:
        return _SCHEDULED_ARRIVALS


# ── Parent endpoints ─────────────────────────────────────────────────────────

class ParentLoginIn(BaseModel):
    kid_name: str

class ParentLocationUpdate(BaseModel):
    lat: float
    lng: float
    address: Optional[str] = None

@app.post("/api/parent/login")
def parent_login(data: ParentLoginIn):
    """Login by kid name → returns the parent record + their kids."""
    kid_name_lower = data.kid_name.strip().lower()
    # Find kid(s) matching the name (partial match supported)
    matched_kids = [k for k in _kids if kid_name_lower in k["name"].lower()]
    if not matched_kids:
        raise HTTPException(status_code=404, detail="No kid found with that name")
    # Take the first match's parent
    kid = matched_kids[0]
    parent = next((p for p in _parents if p["id"] == kid.get("parent_id")), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent record not found")
    parent["logged_in"] = True
    # Return parent + their single kid (1:1)
    kid = next((k for k in _kids if k["id"] == parent["kid_id"]), None)
    _logger.debug(f"PARENT-LOGIN  parent_id={parent['id']} name='{parent['name']}' kid={kid['name'] if kid else 'N/A'}")
    return {"parent": parent, "kid": kid}

@app.get("/api/parents")
def list_parents():
    """Return all parents."""
    return _parents

@app.get("/api/parent/{parent_id}")
def get_parent(parent_id: int):
    """Get a single parent with their kid (1:1)."""
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    kid = next((k for k in _kids if k["id"] == parent["kid_id"]), None)
    return {"parent": parent, "kid": kid}

@app.put("/api/parent/{parent_id}/location")
def update_parent_location(parent_id: int, data: ParentLocationUpdate):
    """Update parent's GPS location (called from browser geolocation)."""
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    parent["location_lat"] = data.lat
    parent["location_lng"] = data.lng
    if data.address:
        parent["location_address"] = data.address
    parent["distance_km"] = round(_haversine_km(data.lat, data.lng, SCHOOL_LAT, SCHOOL_LNG), 2)
    # Refresh travel time with real-time traffic
    tt = _get_google_maps_travel_time(data.lat, data.lng)
    parent["travel_time_min"] = tt["travel_time_min"]
    parent["travel_time_traffic_min"] = tt["travel_time_traffic_min"]
    parent["traffic_condition"] = tt["traffic_condition"]
    parent["travel_source"] = tt["source"]
    # Use road distance from Google Maps when available (more accurate than straight-line)
    if tt["source"] == "google_maps":
        parent["distance_km"] = tt["distance_km"]
    _logger.debug(f"PARENT-LOCATION  id={parent_id} lat={data.lat:.4f} lng={data.lng:.4f} "
                 f"dist={parent['distance_km']}km travel={tt['travel_time_traffic_min']}min "
                 f"traffic={tt['traffic_condition']} src={tt['source']}")
    return parent


# ── Travel Time Endpoints ────────────────────────────────────────────────────

@app.get("/api/parent/{parent_id}/travel-time")
def get_parent_travel_time(parent_id: int):
    """Get real-time travel time for a parent (uses Google Maps with traffic data)."""
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    tt = _get_google_maps_travel_time(parent["location_lat"], parent["location_lng"])
    # Update the parent record too
    parent["travel_time_min"] = tt["travel_time_min"]
    parent["travel_time_traffic_min"] = tt["travel_time_traffic_min"]
    parent["traffic_condition"] = tt["traffic_condition"]
    parent["travel_source"] = tt["source"]
    if tt["source"] == "google_maps":
        parent["distance_km"] = tt["distance_km"]
    return {
        "parent_id": parent["id"],
        "parent_name": parent["name"],
        "origin": {"lat": parent["location_lat"], "lng": parent["location_lng"]},
        "destination": {"lat": SCHOOL_LAT, "lng": SCHOOL_LNG},
        **tt,
    }

@app.post("/api/travel-time/refresh-all")
def refresh_all_travel_times():
    """Refresh travel times for ALL parents (batch update). Useful before starting pickup."""
    # Invalidate cache so we get fresh data
    _travel_time_cache.clear()
    results = []
    for parent in _parents:
        tt = _get_google_maps_travel_time(parent["location_lat"], parent["location_lng"])
        parent["travel_time_min"] = tt["travel_time_min"]
        parent["travel_time_traffic_min"] = tt["travel_time_traffic_min"]
        parent["traffic_condition"] = tt["traffic_condition"]
        parent["travel_source"] = tt["source"]
        if tt["source"] == "google_maps":
            parent["distance_km"] = tt["distance_km"]
        results.append({
            "parent_id": parent["id"],
            "parent_name": parent["name"],
            "travel_time_traffic_min": tt["travel_time_traffic_min"],
            "traffic_condition": tt["traffic_condition"],
            "source": tt["source"],
        })
    traffic_summary = {
        "light": len([r for r in results if r["traffic_condition"] == "light"]),
        "moderate": len([r for r in results if r["traffic_condition"] == "moderate"]),
        "heavy": len([r for r in results if r["traffic_condition"] == "heavy"]),
    }
    _logger.info(f"TRAVEL-TIME-REFRESH  {len(results)} parents refreshed. "
                 f"Traffic: light={traffic_summary['light']} moderate={traffic_summary['moderate']} heavy={traffic_summary['heavy']}")
    return {"parents": results, "traffic_summary": traffic_summary}

@app.get("/api/travel-time/summary")
def travel_time_summary():
    """Get a summary of all parents' travel times and traffic conditions."""
    results = []
    for parent in _parents:
        results.append({
            "parent_id": parent["id"],
            "parent_name": parent["name"],
            "distance_km": parent.get("distance_km", 0),
            "travel_time_min": parent.get("travel_time_min", 0),
            "travel_time_traffic_min": parent.get("travel_time_traffic_min", 0),
            "traffic_condition": parent.get("traffic_condition", "unknown"),
            "travel_source": parent.get("travel_source", "pending"),
            "location": {"lat": parent["location_lat"], "lng": parent["location_lng"]},
        })
    traffic_summary = {
        "light": len([r for r in results if r["traffic_condition"] == "light"]),
        "moderate": len([r for r in results if r["traffic_condition"] == "moderate"]),
        "heavy": len([r for r in results if r["traffic_condition"] == "heavy"]),
        "unknown": len([r for r in results if r["traffic_condition"] not in ("light", "moderate", "heavy")]),
    }
    avg_travel = sum(r["travel_time_traffic_min"] for r in results) / max(len(results), 1)
    max_travel = max((r["travel_time_traffic_min"] for r in results), default=0)
    return {
        "parents": results,
        "traffic_summary": traffic_summary,
        "avg_travel_time_min": round(avg_travel, 1),
        "max_travel_time_min": round(max_travel, 1),
        "school_location": {"lat": SCHOOL_LAT, "lng": SCHOOL_LNG},
    }


@app.get("/api/parent/{parent_id}/queue-status")
def parent_queue_status(parent_id: int):
    """Get queue status for this parent's kids — are they scanned? Position?"""
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    kid_id = parent["kid_id"]
    kid = next((k for k in _kids if k["id"] == kid_id), None)
    scan = next((s for s in _scans if s["kid_id"] == kid_id), None)
    kid_status = {
        "kid_id": kid_id,
        "kid_name": kid["name"] if kid else "Unknown",
        "scanned": scan is not None,
        "scan": scan,
    }
    return {"parent": parent, "kid_status": kid_status}


# ── AI Departure-Time Recommendation (Traffic-Aware) ────────────────────────

@app.get("/api/parent/{parent_id}/when-to-leave")
def when_to_leave(parent_id: int):
    """AI-powered recommendation: when should this parent leave home so queue is never empty.
    Uses real-time traffic data from Google Maps to predict travel time."""
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    api_key = get_config_key("GOOGLE_GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_GEMINI_API_KEY not set")

    # ── Return cached result if still fresh (per parent) ────────────────────────
    _cache_key_wtl = f"when_to_leave_{parent_id}"
    _cached = _ai_result_cache.get(_cache_key_wtl)
    if _cached and _cached["expires_at"] > time.time():
        _logger.debug(f"WHEN-TO-LEAVE  serving cached result for parent_id={parent_id} (expires in {round(_cached['expires_at']-time.time(),0)}s)")
        return _cached["result"]

    metrics = _compute_queue_metrics()
    distance_km = parent.get("distance_km", 5)

    # Get real-time travel time (Google Maps or fallback)
    tt = _get_google_maps_travel_time(parent["location_lat"], parent["location_lng"])
    travel_time_min = tt["travel_time_min"]
    travel_time_traffic_min = tt["travel_time_traffic_min"]
    traffic_condition = tt["traffic_condition"]
    travel_source = tt["source"]

    # Update parent record with latest travel info
    parent["travel_time_min"] = travel_time_min
    parent["travel_time_traffic_min"] = travel_time_traffic_min
    parent["traffic_condition"] = traffic_condition
    parent["travel_source"] = travel_source

    # Find kid's scan record (1:1)
    kid_id = parent["kid_id"]
    kid = next((k for k in _kids if k["id"] == kid_id), None)
    kid_name = kid["name"] if kid else "Unknown"
    scan = next((s for s in _scans if s["kid_id"] == kid_id), None)

    # Position in queue
    all_waiting = sorted([s for s in _scans if s["queue_status"] in ("waiting", "pickup")], key=lambda s: s["seq"])
    kid_position = None
    if scan:
        kid_position = next((i+1 for i, s in enumerate(all_waiting) if s["kid_id"] == kid_id), None)

    # Compute queue prediction: how long until this kid's position is reached
    avg_pickup_sec = max(metrics["avg_pickup_time_sec"], PICKUP_DWELL_SEC)
    throughput = max(metrics["throughput_per_min"], 0.5)
    if kid_position:
        # Time until this kid's turn = (position - active slots) / throughput
        positions_ahead = max(0, kid_position - metrics["in_pickup"])
        est_wait_min = round(positions_ahead / throughput, 1) if throughput > 0 else 0
    else:
        est_wait_min = 0

    # Current queue pressure (how crowded is the destination)
    queue_pressure = "low"
    if metrics["waiting"] > PILLAR_COUNT * 3:
        queue_pressure = "high"
    elif metrics["waiting"] > PILLAR_COUNT:
        queue_pressure = "medium"

    prompt = f"""You are an AI smart scheduling agent for a school pickup queue system.
Your job is to tell this parent EXACTLY when to leave home, using REAL traffic data.

PARENT INFO:
- Name: {parent['name']}
- Location: ({parent['location_lat']:.4f}, {parent['location_lng']:.4f})
- Distance from school: {distance_km} km
- Travel time (no traffic): {travel_time_min} minutes
- Travel time (WITH current traffic): {travel_time_traffic_min} minutes
- Current traffic: {traffic_condition.upper()}
- Traffic data source: {travel_source}
- Kid: {kid_name}
- Kid queue position: {kid_position} (null = not scanned yet)

CURRENT QUEUE METRICS:
- Queue started: {metrics['pickup_started']}
- Total scanned kids: {metrics['total_scanned']}
- Waiting on road (queue size at destination): {metrics['waiting']}
- In pickup lane (being served): {metrics['in_pickup']}
- Completed: {metrics['done']}
- Avg pickup time: {avg_pickup_sec}s per kid
- Throughput: {throughput} pickups/min
- {PILLAR_COUNT} pillars, each handles 1 car at a time
- MANDATORY DWELL TIME: each car must stay at the pillar for at least {int(PICKUP_DWELL_SEC)}s before leaving
- Queue pressure: {queue_pressure} (low=few waiting, medium=steady, high=crowded)
- Estimated wait for kid's position: {est_wait_min} min

SMART SCHEDULING RULES:
1. Use the TRAFFIC travel time ({travel_time_traffic_min} min), not the base time
2. CRITICAL: Each car occupies a pillar slot for a minimum of {int(PICKUP_DWELL_SEC)} seconds — use this as the floor for avg_pickup_sec when spacing arrivals
3. Space parent departure times so no car arrives before the previous car has completed its {int(PICKUP_DWELL_SEC)}s dwell
4. If queue pressure is HIGH, delay departure so queue doesn't grow further
5. If queue pressure is LOW, urge departure so queue isn't empty  
6. Parent should arrive ~2-3 min before their kid's estimated pickup slot
7. Account for traffic getting worse during rush hours (currently {traffic_condition})
8. If traffic is HEAVY, factor in extra buffer time
9. The queue at destination should ideally have {PILLAR_COUNT} to {PILLAR_COUNT * 2} cars waiting — not more

RESPOND WITH VALID JSON ONLY:
{{
  "should_leave_now": true/false,
  "leave_in_minutes": <number, 0 means now>,
  "estimated_arrival_min": <actual travel time with traffic>,
  "estimated_wait_at_school_min": <number>,
  "queue_position_when_arrive": <estimated position>,
  "message": "<friendly 1-2 sentence message including traffic info>",
  "reasoning": "<explain how traffic condition affects the recommendation>",
  "teacher_prep_time_min": <minutes teachers need to bring kid to pickup area>,
  "traffic_condition": "{traffic_condition}",
  "travel_time_with_traffic_min": {travel_time_traffic_min},
  "queue_pressure": "{queue_pressure}",
  "optimal_departure_window_min": <ideal window: leave between now and this many minutes>
}}"""

    try:
        # Gemini API call
        model = get_gemini_model()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        _logger.info(f"GENIE-API using key={_mask_key(api_key)} model={model}")
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        data = _call_gemini(payload, api_key, model, retries=2)
        # Extract response text
        response_text = data["candidates"][0]["content"]["parts"][0]["text"]
        try:
            result = json.loads(response_text)
        except json.JSONDecodeError:
            start = response_text.find('{')
            end = response_text.rfind('}') + 1
            if start >= 0 and end > start:
                result = json.loads(response_text[start:end])
            else:
                result = {"error": "Could not parse AI response", "raw": response_text}
        result["parent"] = {
            "id": parent["id"],
            "name": parent["name"],
            "distance_km": distance_km,
            "location": {"lat": parent["location_lat"], "lng": parent["location_lng"]},
        }
        result["travel_info"] = tt
        result["metrics"] = metrics
        _ai_result_cache[_cache_key_wtl] = {"result": result, "expires_at": time.time() + _AI_CACHE_TTL}
        _logger.info(f"WHEN-TO-LEAVE  parent={parent['name']} leave_now={result.get('should_leave_now')} "
                     f"in={result.get('leave_in_minutes')}min traffic={traffic_condition} "
                     f"travel={travel_time_traffic_min}min queue_pressure={queue_pressure}")
        return result
    except Exception as e:
        _logger.error(f"WHEN-TO-LEAVE  error: {e}")
        raise HTTPException(status_code=502, detail=f"AI error: {str(e)}")


# ── Teacher Pickup Sequence ──────────────────────────────────────────────────

@app.get("/api/teacher/sequence")
def teacher_pickup_sequence():
    """Return the ordered sequence of kids teachers need to bring to the pickup area.
    Based on scan order, teachers know which kids to prepare next."""
    # Kids currently being picked up (at pillars)
    in_pickup = sorted([s for s in _scans if s["queue_status"] == "pickup"], key=lambda s: s["seq"])
    # Next batch waiting (teachers should prepare these)
    waiting = sorted([s for s in _scans if s["queue_status"] == "waiting"], key=lambda s: s["seq"])
    # Recently completed
    done = sorted([s for s in _scans if s["queue_status"] == "done"], key=lambda s: s["seq"])[-10:]

    def _enrich(scan_record):
        kid = next((k for k in _kids if k["id"] == scan_record["kid_id"]), None)
        return {
            **scan_record,
            "grade": kid["grade"] if kid else "Unknown",
            "parent_name": kid.get("parent_name", "Unknown") if kid else "Unknown",
            "parent_id": kid.get("parent_id") if kid else None,
        }

    # Estimate time until each waiting kid is called
    avg_pickup = max(_compute_queue_metrics()["avg_pickup_time_sec"], 15)
    prepare_list = []
    for i, w in enumerate(waiting[:15]):  # show next 15
        est_min = round((i * avg_pickup / PILLAR_COUNT) / 60, 1)
        enriched = _enrich(w)
        enriched["est_minutes_until_called"] = est_min
        enriched["teacher_action"] = "PREPARE NOW" if est_min < 3 else ("GET READY" if est_min < 6 else "UPCOMING")
        prepare_list.append(enriched)

    return {
        "current_at_pillars": [_enrich(s) for s in in_pickup],
        "prepare_next": prepare_list,
        "recently_completed": [_enrich(s) for s in done],
        "avg_pickup_time_sec": avg_pickup,
    }


# ── Parent Admin: bulk overview + AI recommendations ─────────────────────────

@app.get("/api/parent-admin/overview")
def parent_admin_overview():
    """Return every parent with kids, distance, travel time (with traffic), and departure estimate."""
    metrics = _compute_queue_metrics()
    avg_pickup = max(metrics["avg_pickup_time_sec"], 15)

    results = []
    for parent in _parents:
        kid = next((k for k in _kids if k["id"] == parent["kid_id"]), None)
        scan = next((s for s in _scans if s["kid_id"] == parent["kid_id"]), None) if kid else None
        kid_info = {"kid_id": kid["id"], "kid_name": kid["name"], "grade": kid["grade"], "scan": scan} if kid else None

        # Use traffic-aware travel time
        distance_km = parent.get("distance_km", 5)
        travel_traffic_min = parent.get("travel_time_traffic_min", 0)
        if travel_traffic_min <= 0:
            travel_traffic_min = round(distance_km / 30 * 60, 1)

        results.append({
            "parent": parent,
            "kid": kid_info,
            "est_drive_min": travel_traffic_min,
            "travel_time_min": parent.get("travel_time_min", 0),
            "travel_time_traffic_min": travel_traffic_min,
            "traffic_condition": parent.get("traffic_condition", "unknown"),
            "travel_source": parent.get("travel_source", "pending"),
        })

    traffic_summary = {
        "light": len([r for r in results if r["traffic_condition"] == "light"]),
        "moderate": len([r for r in results if r["traffic_condition"] == "moderate"]),
        "heavy": len([r for r in results if r["traffic_condition"] == "heavy"]),
    }
    return {"parents": results, "metrics": metrics, "traffic_summary": traffic_summary}


@app.post("/api/parent-admin/start-parent/{parent_id}")
def start_parent(parent_id: int, auto_start_pickup: bool = True):
    """Instantly scan a parent's kid into the queue — skips driving time for testing.
    If auto_start_pickup is True and pickup hasn't started yet, it also starts the pickup queue.
    Pass auto_start_pickup=false when using timed Start All to control pickup start separately."""
    global _pickup_started, _pickup_started_at
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    kid_id = parent["kid_id"]
    kid = next((k for k in _kids if k["id"] == kid_id), None)
    if not kid:
        raise HTTPException(status_code=404, detail="Kid not found for this parent")

    # Check if already scanned
    existing = next((s for s in _scans if s["kid_id"] == kid_id), None)
    if existing:
        return {"already_scanned": True, "scan": existing, "message": f"{kid['name']} is already in the queue"}

    # Auto-scan the kid (lock protects seq/id counters AND queue advancement from concurrent requests)
    global _next_scan_id, _next_seq
    with _scan_lock:
        pillar = PILLAR_COUNT - ((_next_seq - 1) % PILLAR_COUNT)
        record = {
            "id":               _next_scan_id,
            "kid_id":           kid_id,
            "name":             kid["name"],
            "pillar":           pillar,
            "seq":              _next_seq,
            "scanned_at":       datetime.datetime.utcnow().isoformat(),
            "pickup_started_at": _pickup_started_at,
            "car_arrived":      False,
            "picked_up":        False,
            "picked_up_at":     None,
            "queue_status":     "waiting",
        }
        _scans.append(record)
        _logger.debug(f"ADMIN-START  parent={parent['name']} kid={kid['name']} seq={_next_seq} pillar={pillar}")
        _next_scan_id += 1
        _next_seq     += 1

        if auto_start_pickup:
            # Auto-start pickup if not started yet
            if not _pickup_started:
                _pickup_started = True
                if _pickup_started_at is None:
                    _pickup_started_at = datetime.datetime.utcnow().isoformat()
                for s in _scans:
                    if s.get("pickup_started_at") is None:
                        s["pickup_started_at"] = _pickup_started_at
                _advance_queue(PICKUP_QUEUE_SIZE)
                _logger.debug("ADMIN-START  auto-started pickup queue")
            else:
                # If pickup is running, check if we should promote this kid immediately
                current_pickup = len([s for s in _scans if s["queue_status"] == "pickup"])
                if current_pickup < PICKUP_QUEUE_SIZE:
                    _advance_queue(PICKUP_QUEUE_SIZE - current_pickup)
        else:
            # Just scan, don't start pickup — caller will start it explicitly
            if _pickup_started:
                # Pickup already running, promote if slots available
                current_pickup = len([s for s in _scans if s["queue_status"] == "pickup"])
                if current_pickup < PICKUP_QUEUE_SIZE:
                    _advance_queue(PICKUP_QUEUE_SIZE - current_pickup)

        # Refresh the record status (may have been promoted to "pickup")
        record = next((s for s in _scans if s["kid_id"] == kid_id), record)

    return {"already_scanned": False, "scan": record, "message": f"{kid['name']} scanned into queue!"}


@app.post("/api/parent-admin/start-all-parents")
def start_all_parents():
    """Instantly scan ALL parents' kids into the queue — bulk testing helper."""
    global _pickup_started
    results = []
    with _scan_lock:
        for parent in _parents:
            kid_id = parent["kid_id"]
            kid = next((k for k in _kids if k["id"] == kid_id), None)
            if not kid:
                continue
            existing = next((s for s in _scans if s["kid_id"] == kid_id), None)
            if existing:
                results.append({"parent_id": parent["id"], "kid_name": kid["name"], "status": "already_scanned"})
                continue

            global _next_scan_id, _next_seq
            pillar = PILLAR_COUNT - ((_next_seq - 1) % PILLAR_COUNT)
            record = {
                "id":               _next_scan_id,
                "kid_id":           kid_id,
                "name":             kid["name"],
                "pillar":           pillar,
                "seq":              _next_seq,
                "scanned_at":       datetime.datetime.utcnow().isoformat(),
                "pickup_started_at": _pickup_started_at,
                "car_arrived":      False,
                "picked_up":        False,
                "picked_up_at":     None,
                "queue_status":     "waiting",
            }
            _scans.append(record)
            _next_scan_id += 1
            _next_seq     += 1
            results.append({"parent_id": parent["id"], "kid_name": kid["name"], "status": "scanned"})

    # Auto-start pickup — inside the lock so _advance_queue sees the full updated _scans
    with _scan_lock:
        if not _pickup_started:
            _pickup_started = True
            if _pickup_started_at is None:
                _pickup_started_at = datetime.datetime.utcnow().isoformat()
            for s in _scans:
                if s.get("pickup_started_at") is None:
                    s["pickup_started_at"] = _pickup_started_at
        # _advance_queue caps at PILLAR_COUNT internally
        _advance_queue(PICKUP_QUEUE_SIZE)
    _logger.debug(f"ADMIN-START-ALL  scanned {len([r for r in results if r['status'] == 'scanned'])} kids")

    return {"results": results, "total_scanned": len([r for r in results if r['status'] == 'scanned'])}


@app.post("/api/dev/prune-far-parents")
def prune_far_parents(max_minutes: float = 5.0):
    """Remove all parents (and their kids) whose traffic-aware travel time exceeds max_minutes.
    Useful after seeding to discard outliers that Google Maps routes as unexpectedly long."""
    global _parents, _kids
    before = len(_parents)
    kept_parents = []
    removed_kid_ids: list[int] = []
    for p in _parents:
        tt = p.get("travel_time_traffic_min", 0)
        if tt <= 0:
            # Estimate from haversine if not yet fetched
            tt = round(p.get("distance_km", 0) / 30 * 60, 1)
        if tt <= max_minutes:
            kept_parents.append(p)
        else:
            removed_kid_ids.append(p["kid_id"])
    _kids    = [k for k in _kids    if k["id"] not in removed_kid_ids]
    _parents = kept_parents
    removed  = before - len(_parents)
    _logger.debug(f"PRUNE-FAR-PARENTS  max={max_minutes}min removed={removed} kept={len(_parents)}")
    return {"removed": removed, "kept": len(_parents), "max_minutes": max_minutes}


def _local_schedule_fallback() -> dict:
    """Compute a traffic-aware departure schedule locally (no AI needed).
    Uses real travel times from Google Maps when available, falls back to haversine estimate."""
    parent_map = {p["id"]: p["name"] for p in _parents}
    metrics = _compute_queue_metrics()
    
    # Build list with real travel times
    entries = []
    for parent in _parents:
        distance_km = parent.get("distance_km", 5)
        # Use traffic-aware travel time if available
        travel_traffic_min = parent.get("travel_time_traffic_min", 0)
        if travel_traffic_min <= 0:
            travel_traffic_min = round(distance_km / 30 * 60, 1)
        traffic_cond = parent.get("traffic_condition", "unknown")
        entries.append({
            "parent": parent,
            "drive_min": travel_traffic_min,
            "distance_km": distance_km,
            "traffic_condition": traffic_cond,
        })

    # Sort DESCENDING (farthest first) — mirrors ai-smart-schedule logic.
    # Farthest parents anchor at T=0; closer parents slot in behind them at throughput rate.
    # This minimises total session duration (first arrival → last departure).
    entries.sort(key=lambda e: e["drive_min"], reverse=True)

    # Use THEORETICAL_THROUGHPUT_PER_MIN as floor so arrival_spacing is realistic even
    # when no pickups have completed yet (throughput_per_min would be 0 at session start).
    raw_throughput = metrics.get("throughput_per_min", 0.0)
    throughput = raw_throughput if raw_throughput >= 0.5 else THEORETICAL_THROUGHPUT_PER_MIN
    wave_size = PILLAR_COUNT
    # Wave interval = time for one full wave of PILLAR_COUNT cars to clear the lane.
    wave_drain_min = round(PILLAR_COUNT / throughput, 2)
    wave_interval = round(wave_drain_min * 0.85, 2)  # 15 % safety margin

    # ── Period-constrained arrival spacing ──────────────────────────────────
    # Throughput-based floor: minimum safe gap so pillars are never overwhelmed.
    min_safe_spacing = round(1.0 / THEORETICAL_THROUGHPUT_PER_MIN, 3)
    # Default: pack car at the fastest sustainable rate.
    arrival_spacing = round(1.0 / throughput, 2)
    # If PICKUP_PERIOD_MIN is set, derive the maximum spacing that fits all
    # parents into the period window and tighten if needed.
    n_to_schedule = len(entries)
    if PICKUP_PERIOD_MIN > 0 and n_to_schedule > 1:
        period_budget = PICKUP_PERIOD_MIN - wave_drain_min
        period_max_spacing = period_budget / (n_to_schedule - 1) if period_budget > 0 else min_safe_spacing
        if period_max_spacing >= min_safe_spacing:
            # Period is feasible — tighten spacing to hit the deadline.
            arrival_spacing = round(max(min_safe_spacing, min(arrival_spacing, period_max_spacing)), 3)
            _logger.debug(
                f"FALLBACK-SPACING  period={PICKUP_PERIOD_MIN}min  n={n_to_schedule}"
                f"  period_max={round(period_max_spacing,3)}  chosen={arrival_spacing}"
            )
        else:
            # Period is physically infeasible for N parents — ignore SLA and run
            # at natural throughput pace.  Queue drains at its own speed.
            _logger.debug(
                f"FALLBACK-SPACING  period={PICKUP_PERIOD_MIN}min INFEASIBLE for n={n_to_schedule}"
                f" (need {round((n_to_schedule-1)*min_safe_spacing+wave_drain_min,1)}min)"
                f" — ignoring period constraint, using throughput spacing={arrival_spacing}min"
            )

    # ── Simulation speed override ────────────────────────────────────────────
    # SIM_ARRIVAL_SPACING_S > 0 bypasses the physics-based floor entirely so
    # cars arrive at the scanner every N seconds (good for demos / fast testing).
    if SIM_ARRIVAL_SPACING_S > 0:
        arrival_spacing = round(SIM_ARRIVAL_SPACING_S / 60.0, 4)
        _logger.debug(
            f"FALLBACK-SPACING  SIM_ARRIVAL_SPACING_S={SIM_ARRIVAL_SPACING_S}s override → "
            f"arrival_spacing={arrival_spacing}min (physics floor was {min_safe_spacing}min)"
        )

    # If queue already has a backlog, push first arrival later so we don't flood it
    current_waiting = metrics.get("waiting", 0)
    if current_waiting >= wave_size * 2:
        initial_delay = round((current_waiting - wave_size) / throughput, 1)
    elif current_waiting >= wave_size:
        initial_delay = round(1.0 / throughput, 1)
    else:
        initial_delay = 0.0

    # last_actual_arrival tracks the post-clamp arrival of the previous parent so that
    # each new slot spaces correctly from the *real* (not desired) previous arrival.
    last_actual_arrival = initial_delay
    schedule = []

    for i, entry in enumerate(entries):
        wave = (i // wave_size) + 1
        drive = float(entry["drive_min"])

        # Desired arrival: spacing after last actual arrival (i=0 → initial_delay)
        desired_arrival = last_actual_arrival if i == 0 else last_actual_arrival + arrival_spacing
        leave_in = max(0.0, round(desired_arrival - drive, 1))
        actual_arrival = leave_in + drive
        last_actual_arrival = actual_arrival  # anchor for next parent

        if entry["traffic_condition"] == "heavy":
            reason = "heavy traffic — leave early"
        elif entry["traffic_condition"] == "moderate":
            reason = "moderate traffic"
        elif leave_in == 0:
            reason = "leave now — farthest in queue"
        else:
            reason = f"slot {i+1} — arrive in {round(actual_arrival,1)}min"

        schedule.append({
            "parent_id": entry["parent"]["id"],
            "parent_name": parent_map.get(entry["parent"]["id"], "Unknown"),
            "leave_in_minutes": round(leave_in, 1),
            "wave": wave,
            "reason": reason,
            "travel_time_traffic_min": drive,
            "traffic_condition": entry["traffic_condition"],
        })

    total_waves = (len(entries) + wave_size - 1) // wave_size
    traffic_counts = {
        "light": len([e for e in entries if e["traffic_condition"] == "light"]),
        "moderate": len([e for e in entries if e["traffic_condition"] == "moderate"]),
        "heavy": len([e for e in entries if e["traffic_condition"] == "heavy"]),
    }
    return {
        "schedule": schedule,
        "total_waves": total_waves,
        "wave_interval_min": wave_interval,
        "arrival_spacing_min": arrival_spacing,
        "theoretical_session_floor_min": round(len(entries) / throughput, 1) if throughput > 0 else None,
        "traffic_summary": traffic_counts,
        "summary": (f"Traffic-aware schedule: {len(entries)} parents in {total_waves} waves, "
                    f"{wave_interval} min apart. "
                    f"Session floor ≈{round(len(entries)/throughput, 1)}min. "
                    f"Traffic: {traffic_counts['light']} light, {traffic_counts['moderate']} moderate, {traffic_counts['heavy']} heavy."),
        "fallback": True,
    }


@app.get("/api/dev/preview-prompt")
def dev_preview_prompt(parent_id: Optional[int] = None):
    """Return the sanitized prompt that would be sent to Gemini for a single parent.

    If `parent_id` is omitted, returns an error. This endpoint does NOT call Gemini.
    """
    if parent_id is None:
        raise HTTPException(status_code=400, detail="parent_id query parameter required")
    parent = next((p for p in _parents if p["id"] == parent_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="parent not found")

    # compute travel time info (may use cached values)
    tt = _get_google_maps_travel_time(parent["location_lat"], parent["location_lng"])
    metrics = _compute_queue_metrics()
    queue_pressure = "low"
    if metrics["waiting"] > PILLAR_COUNT * 3:
        queue_pressure = "high"
    elif metrics["waiting"] > PILLAR_COUNT:
        queue_pressure = "medium"

    prompt = f"""You are an AI smart scheduling agent for a school pickup queue.
Schedule departure times for ONE parent using REAL-TIME TRAFFIC data.

SYSTEM: {PILLAR_COUNT} pillars, mandatory {int(PICKUP_DWELL_SEC)}s dwell per car at destination, ~{metrics['throughput_per_min']} pickups/min. Space arrivals so no car reaches the pillar before the previous car has completed its {int(PICKUP_DWELL_SEC)}s dwell.

PARENT:
{json.dumps({'id': parent['id'], 'name': parent['name'], 'location': {'lat': parent['location_lat'], 'lng': parent['location_lng']}, 'distance_km': parent.get('distance_km',0)})}

TRAFFIC:
- current travel_time_with_traffic_min: {tt['travel_time_traffic_min']}
- traffic_condition: {tt['traffic_condition']}
- queue_pressure: {queue_pressure}

RESPOND WITH VALID JSON ONLY:
{{
  "should_leave_now": true/false,
  "leave_in_minutes": <number>,
  "estimated_arrival_min": <number>,
  "estimated_wait_at_school_min": <number>,
  "queue_position_when_arrive": <number>,
  "message": "<1-2 sentence message>",
  "reasoning": "<brief explanation>",
  "teacher_prep_time_min": <number>,
  "traffic_condition": "{tt['traffic_condition']}",
  "travel_time_with_traffic_min": {tt['travel_time_traffic_min']},
  "queue_pressure": "{queue_pressure}"
}}"""

    # sanitize: do not include any API keys
    return {"prompt": prompt}


def _build_ai_scheduling_prompt(metrics: dict, parent_summaries: list) -> str:
    """Build the Gemini scheduling prompt — shared by the real endpoint and the preview endpoint."""
    raw_throughput = metrics["throughput_per_min"]
    effective_throughput = raw_throughput if raw_throughput >= 0.5 else THEORETICAL_THROUGHPUT_PER_MIN
    wave_drain_min = round(PILLAR_COUNT / effective_throughput, 2)
    max_safe_wave_interval = round(wave_drain_min * 0.85, 2)

    total_active = metrics["waiting"] + metrics["in_pickup"]
    already_scanned = metrics["total_scanned"]
    remaining_parents = len(_parents) - already_scanned
    if total_active == 0:
        queue_urgency = "CRITICAL - queue is completely empty, send cars NOW"
    elif total_active < PILLAR_COUNT:
        queue_urgency = f"URGENT - only {total_active} car(s) active, below {PILLAR_COUNT} pillars capacity"
    elif total_active < PILLAR_COUNT * 2:
        queue_urgency = f"NORMAL - {total_active} cars active, maintain steady flow"
    else:
        queue_urgency = f"FULL - {total_active} cars active, space out next waves"

    traffic_counts = {
        "light":    len([p for p in parent_summaries if p["tc"] == "light"]),
        "moderate": len([p for p in parent_summaries if p["tc"] == "moderate"]),
        "heavy":    len([p for p in parent_summaries if p["tc"] == "heavy"]),
    }
    t_min = min((p["t"] for p in parent_summaries), default=1)
    t_max = max((p["t"] for p in parent_summaries), default=10)

    example = '{"parent_id": 1, "leave_in_minutes": 3.5, "wave": 1, "reason": "farthest first", "travel_time_traffic_min": 8.5, "traffic_condition": "light"}'
    theoretical_session_floor = round(len(parent_summaries) / effective_throughput, 1) if effective_throughput > 0 else 0
    return f"""You are an AI smart scheduling agent for a school pickup queue system.
PRIMARY OBJECTIVE: minimise total session duration = time from first car ARRIVAL to last car DEPARTURE.
  Theoretical minimum for {len(parent_summaries)} parents at {effective_throughput:.2f} cars/min = {theoretical_session_floor} min.
  Achieve this by packing arrivals at maximum throughput rate with ZERO idle gaps at the pillars.

═══════════════════════════════════════════════════════
SYSTEM FACTS
═══════════════════════════════════════════════════════
- Pillars: {PILLAR_COUNT}  (each handles 1 car at a time, {CHILD_PICKUP_TIME_S:.0f}s child pickup)
- Road: {PICKUP_ROAD_LENGTH_M:.0f}m @ {PICKUP_SPEED_LIMIT_KMH:.0f} km/h → {_ROAD_TRAVERSE_S:.0f}s traverse + {CHILD_PICKUP_TIME_S:.0f}s pickup = {_SECONDS_PER_CAR:.0f}s/car/pillar
- Theoretical max throughput: {THEORETICAL_THROUGHPUT_PER_MIN:.2f} cars/min ({PILLAR_COUNT} pillars × {60.0/_SECONDS_PER_CAR:.3f}/min each)
- Effective throughput now: {effective_throughput:.2f} cars/min
- Time to drain one full wave of {PILLAR_COUNT} cars: {wave_drain_min} min
- MAX safe wave interval to never empty queue: {max_safe_wave_interval} min
  (if wave_interval_min > {max_safe_wave_interval}, the queue WILL go empty between waves)
- Pickup period deadline: {PICKUP_PERIOD_MIN:.0f} min (all pickups must finish within this window)

═══════════════════════════════════════════════════════
QUEUE STATE RIGHT NOW
═══════════════════════════════════════════════════════
- Already scanned / in queue: {already_scanned}
- Waiting on main road: {metrics['waiting']}
- In pickup lane (being served): {metrics['in_pickup']}
- Done: {metrics['done']}
- Total active (waiting + in_pickup): {total_active}
- Parents NOT yet scheduled: {remaining_parents}
- Queue urgency: {queue_urgency}

═══════════════════════════════════════════════════════
TRAFFIC SUMMARY
═══════════════════════════════════════════════════════
- {traffic_counts['light']} parents: light traffic
- {traffic_counts['moderate']} parents: moderate traffic
- {traffic_counts['heavy']} parents: heavy traffic
- Travel times range: {t_min}–{t_max} min

═══════════════════════════════════════════════════════
PARENTS TO SCHEDULE (id, distance_km=d, travel_min=t, traffic=tc)
═══════════════════════════════════════════════════════
{json.dumps(parent_summaries)}

═══════════════════════════════════════════════════════
CRITICAL RULES — READ CAREFULLY
═══════════════════════════════════════════════════════
RULE 1 — WAVES BATCH ARRIVALS, NOT DEPARTURES.
  Parents in the same wave should ARRIVE at the school at the same time.
  Therefore: leave_in_minutes[parent] = target_arrival_time_for_wave - t[parent]
  Example: Wave 1 targets arrival at t=8 min from now.
    Parent A (t=8 min) → leave_in_minutes = 8 - 8 = 0  (leave NOW)
    Parent B (t=3 min) → leave_in_minutes = 8 - 3 = 5  (leave in 5 min)
    Parent C (t=12 min) → leave_in_minutes = max(0, 8 - 12) = 0  (already late, also leave now)

RULE 2 — NEVER EMPTY THE QUEUE.
  wave_interval_min MUST be ≤ {max_safe_wave_interval} min.
  If you space waves further apart the queue drains to zero and the system stalls.

RULE 3 — QUEUE IS {queue_urgency.split(' -')[0]}.
  Current total_active = {total_active}.
  {"→ SEND THE FIRST WAVE IMMEDIATELY (leave_in_minutes = 0 for farthest parents)." if total_active < PILLAR_COUNT else f"→ Maintain current pace; next wave arrival in {max_safe_wave_interval} min."}

RULE 4 — USE TRAFFIC travel time "t" for all departure calculations.

RULE 5 — FARTHEST FIRST: assign parents with the LONGEST travel time "t" to the earliest waves.
  Reason: nearest-first spreads arrivals over the full travel-time range (e.g. 2–12 min = 10 min session).
  With FARTHEST FIRST the farthest parent leaves NOW arriving at T=t_max; each subsequent parent
  departs slightly later so arrivals form a tight continuous stream at the throughput rate, achieving
  the theoretical session floor of {theoretical_session_floor} min.
  Formula (0-indexed, sorted by t DESCENDING):
    target_arrival_k = t_max + k * (wave_interval_min / {PILLAR_COUNT})
    leave_in_k = max(0, target_arrival_k - t[k])

RULE 6 — leave_in_minutes must be ≥ 0 (cannot be negative).
RULE 7 - PICKUP PERIOD TARGET (best-effort): aim to complete within {PICKUP_PERIOD_MIN:.0f} minutes.
  FEASIBLE (floor {theoretical_session_floor} min <= {PICKUP_PERIOD_MIN:.0f} min): tighten spacing so all N parents arrive in the window.
  NOT FEASIBLE (floor {theoretical_session_floor} min > {PICKUP_PERIOD_MIN:.0f} min): IGNORE the period target entirely.
    Use throughput-based spacing only (1 / throughput) and let the queue drain at natural pace.
    Missing the SLA is acceptable when N is large - do NOT compress below the physical floor.

═══════════════════════════════════════════════════════
OUTPUT FORMAT — VALID JSON ONLY, NO MARKDOWN
═══════════════════════════════════════════════════════
Example item: {example}
Required keys: schedule (ALL {len(parent_summaries)} parents), total_waves (int), wave_interval_min (float), estimated_session_duration_min (float = wave_interval_min*(total_waves-1)+wave_drain_min), summary (string), traffic_summary ({{light, moderate, heavy counts}}).
Each schedule item: parent_id (int), leave_in_minutes (float ≥ 0), wave (int, 1-based), reason (≤5 words), travel_time_traffic_min (float), traffic_condition (string)."""


@app.get('/api/dev/preview-batch')
def dev_preview_batch():
    """Return the sanitized batch scheduling prompt that would be sent to Gemini for all parents."""
    metrics = _compute_queue_metrics()
    parent_summaries = []
    for parent in _parents:
        travel_traffic_min = parent.get('travel_time_traffic_min', 0)
        if travel_traffic_min <= 0:
            travel_traffic_min = round(parent.get('distance_km', 5) / 30 * 60, 1)
        parent_summaries.append({
            'id': parent['id'],
            'd': round(parent.get('distance_km', 0), 2),
            't': round(travel_traffic_min, 1),
            'tc': parent.get('traffic_condition', 'unknown'),
        })
    return {"prompt": _build_ai_scheduling_prompt(metrics, parent_summaries)}


@app.get("/api/parent-admin/ai-recommendations")
def parent_admin_ai_recommendations():
    """Use AI to give batch departure recommendations for ALL parents at once.
    Falls back to a local distance-based schedule if AI is rate-limited."""

    # ── Return cached result if still fresh ─────────────────────────────────
    _cached = _ai_result_cache.get("parent_admin")
    if _cached and _cached["expires_at"] > time.time():
        _logger.debug(f"PARENT-ADMIN-AI  serving cached result (expires in {round(_cached['expires_at']-time.time(),0)}s)")
        return _cached["result"]

    metrics = _compute_queue_metrics()

    # ── Build parent summaries with real traffic data ────────────────────────
    parent_summaries = []
    for parent in _parents:
        distance_km = parent.get("distance_km", 5)
        travel_traffic_min = parent.get("travel_time_traffic_min", 0)
        if travel_traffic_min <= 0:
            travel_traffic_min = round(distance_km / 30 * 60, 1)
        traffic_cond = parent.get("traffic_condition", "unknown")
        parent_summaries.append({
            "id": parent["id"],
            "d": round(distance_km, 2),
            "t": round(travel_traffic_min, 1),   # traffic-aware travel time in minutes
            "tc": traffic_cond,
        })

    # ── Effective throughput ─────────────────────────────────────────────────
    # If no pickups done yet, use theoretical: PILLAR_COUNT pillars × 1 car/10s = 6/min per pillar.
    # Conservative realistic estimate = PILLAR_COUNT * 3 (accounts for car approach animation).
    raw_throughput = metrics["throughput_per_min"]
    effective_throughput = raw_throughput if raw_throughput >= 0.5 else THEORETICAL_THROUGHPUT_PER_MIN
    # Time (minutes) for one full wave of PILLAR_COUNT cars to clear the pickup lane
    wave_drain_min = round(PILLAR_COUNT / effective_throughput, 2)
    # Max wave interval to guarantee queue never empties:
    # Wave N+1 must START ARRIVING before Wave N finishes draining.
    max_safe_wave_interval = round(wave_drain_min * 0.85, 2)  # 15% safety margin

    # ── Queue urgency (replaces misleading "low/med/high pressure") ──────────
    total_active = metrics["waiting"] + metrics["in_pickup"]
    already_scanned = metrics["total_scanned"]
    remaining_parents = len(_parents) - already_scanned  # parents not yet in queue
    if total_active == 0:
        queue_urgency = "CRITICAL - queue is completely empty, send cars NOW"
    elif total_active < PILLAR_COUNT:
        queue_urgency = f"URGENT - only {total_active} car(s) active, below {PILLAR_COUNT} pillars capacity"
    elif total_active < PILLAR_COUNT * 2:
        queue_urgency = f"NORMAL - {total_active} cars active, maintain steady flow"
    else:
        queue_urgency = f"FULL - {total_active} cars active, space out next waves"

    traffic_counts = {
        "light":    len([p for p in parent_summaries if p["tc"] == "light"]),
        "moderate": len([p for p in parent_summaries if p["tc"] == "moderate"]),
        "heavy":    len([p for p in parent_summaries if p["tc"] == "heavy"]),
    }

    t_min = min((p["t"] for p in parent_summaries), default=1)
    t_max = max((p["t"] for p in parent_summaries), default=10)

    example = '{"parent_id": 1, "leave_in_minutes": 3.5, "wave": 1, "reason": "farthest first", "travel_time_traffic_min": 8.5, "traffic_condition": "light"}'
    theoretical_session_floor = round(len(parent_summaries) / effective_throughput, 1) if effective_throughput > 0 else 0
    prompt = f"""You are an AI smart scheduling agent for a school pickup queue system.
PRIMARY OBJECTIVE: minimise total session duration = time from first car ARRIVAL to last car DEPARTURE.
  Theoretical minimum for {len(parent_summaries)} parents at {effective_throughput:.2f} cars/min = {theoretical_session_floor} min.
  Achieve this by packing arrivals at maximum throughput rate with ZERO idle gaps at the pillars.

═══════════════════════════════════════════════════════
SYSTEM FACTS
═══════════════════════════════════════════════════════
- Pillars: {PILLAR_COUNT}  (each handles 1 car at a time, {CHILD_PICKUP_TIME_S:.0f}s child pickup)
- Road: {PICKUP_ROAD_LENGTH_M:.0f}m @ {PICKUP_SPEED_LIMIT_KMH:.0f} km/h → {_ROAD_TRAVERSE_S:.0f}s traverse + {CHILD_PICKUP_TIME_S:.0f}s pickup = {_SECONDS_PER_CAR:.0f}s/car/pillar
- Theoretical max throughput: {THEORETICAL_THROUGHPUT_PER_MIN:.2f} cars/min ({PILLAR_COUNT} pillars × {60.0/_SECONDS_PER_CAR:.3f}/min each)
- Effective throughput now: {effective_throughput:.2f} cars/min
- Time to drain one full wave of {PILLAR_COUNT} cars: {wave_drain_min} min
- MAX safe wave interval to never empty queue: {max_safe_wave_interval} min
  (if wave_interval_min > {max_safe_wave_interval}, the queue WILL go empty between waves)
- Pickup period deadline: {PICKUP_PERIOD_MIN:.0f} min (all pickups must finish within this window)

═══════════════════════════════════════════════════════
QUEUE STATE RIGHT NOW
═══════════════════════════════════════════════════════
- Already scanned / in queue: {already_scanned}
- Waiting on main road: {metrics['waiting']}
- In pickup lane (being served): {metrics['in_pickup']}
- Done: {metrics['done']}
- Total active (waiting + in_pickup): {total_active}
- Parents NOT yet scheduled: {remaining_parents}
- Queue urgency: {queue_urgency}

═══════════════════════════════════════════════════════
TRAFFIC SUMMARY
═══════════════════════════════════════════════════════
- {traffic_counts['light']} parents: light traffic
- {traffic_counts['moderate']} parents: moderate traffic
- {traffic_counts['heavy']} parents: heavy traffic
- Travel times range: {t_min}–{t_max} min

═══════════════════════════════════════════════════════
PARENTS TO SCHEDULE (id, distance_km=d, travel_min=t, traffic=tc)
═══════════════════════════════════════════════════════
{json.dumps(parent_summaries)}

═══════════════════════════════════════════════════════
CRITICAL RULES — READ CAREFULLY
═══════════════════════════════════════════════════════
RULE 1 — WAVES BATCH ARRIVALS, NOT DEPARTURES.
  Parents in the same wave should ARRIVE at the school at the same time.
  Therefore: leave_in_minutes[parent] = target_arrival_time_for_wave - t[parent]
  Example: Wave 1 targets arrival at t=8 min from now.
    Parent A (t=8 min) → leave_in_minutes = 8 - 8 = 0  (leave NOW)
    Parent B (t=3 min) → leave_in_minutes = 8 - 3 = 5  (leave in 5 min)
    Parent C (t=12 min) → leave_in_minutes = max(0, 8 - 12) = 0  (already late, also leave now)

RULE 2 — NEVER EMPTY THE QUEUE.
  wave_interval_min MUST be ≤ {max_safe_wave_interval} min.
  If you space waves further apart, the queue drains to zero and the system stalls.

RULE 3 — QUEUE IS {queue_urgency.split(' -')[0]}.
  Current total_active = {total_active}.
  {"→ SEND THE FIRST WAVE IMMEDIATELY (leave_in_minutes = 0 for farthest parents)." if total_active < PILLAR_COUNT else f"→ Maintain current pace; next wave arrival in {max_safe_wave_interval} min."}

RULE 4 — USE TRAFFIC travel time "t" for all departure calculations.

RULE 5 — FARTHEST FIRST: assign parents with the LONGEST travel time "t" to the earliest waves.
  Reason: nearest-first spreads arrivals over the full travel-time range (e.g. 2–12 min = 10 min session).
  With FARTHEST FIRST the farthest parent leaves NOW arriving at T=t_max; each subsequent parent
  departs slightly later so arrivals form a tight continuous stream at the throughput rate, achieving
  the theoretical session floor of {theoretical_session_floor} min.
  Formula (0-indexed, sorted by t DESCENDING):
    target_arrival_k = t_max + k * (wave_interval_min / {PILLAR_COUNT})
    leave_in_k = max(0, target_arrival_k - t[k])

RULE 6 — leave_in_minutes must be ≥ 0 (cannot be negative).
RULE 7 - PICKUP PERIOD TARGET (best-effort): aim to complete within {PICKUP_PERIOD_MIN:.0f} minutes.
  FEASIBLE (floor {theoretical_session_floor} min <= {PICKUP_PERIOD_MIN:.0f} min): tighten spacing so all N parents arrive in the window.
  NOT FEASIBLE (floor {theoretical_session_floor} min > {PICKUP_PERIOD_MIN:.0f} min): IGNORE the period target entirely.
    Use throughput-based spacing only (1 / throughput) and let the queue drain at natural pace.
    Missing the SLA is acceptable when N is large - do NOT compress below the physical floor.

═══════════════════════════════════════════════════════
OUTPUT FORMAT — VALID JSON ONLY, NO MARKDOWN
═══════════════════════════════════════════════════════
Example item: {example}
Required keys: schedule (ALL {len(parent_summaries)} parents), total_waves (int), wave_interval_min (float), estimated_session_duration_min (float = wave_interval_min*(total_waves-1)+wave_drain_min), summary (string), traffic_summary ({{light, moderate, heavy counts}}).
Each schedule item: parent_id (int), leave_in_minutes (float ≥ 0), wave (int, 1-based), reason (≤5 words), travel_time_traffic_min (float), traffic_condition (string)."""

    try:
        api_key = get_config_key("GOOGLE_GEMINI_API_KEY")
        if not api_key:
            raise Exception("GOOGLE_GEMINI_API_KEY not set")
        model = get_gemini_model()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        _logger.info(f"GENIE-API using key={_mask_key(api_key)} model={model}")
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        data = _call_gemini(payload, api_key, model, retries=2)
        response_text = data["candidates"][0]["content"]["parts"][0]["text"]
        try:
            result = json.loads(response_text)
        except json.JSONDecodeError:
            start = response_text.find('{')
            end = response_text.rfind('}') + 1
            if start >= 0 and end > start:
                result = json.loads(response_text[start:end])
            else:
                result = {"error": "Could not parse AI response", "raw": response_text}
        result["metrics"] = metrics
        parent_map = {p["id"]: p["name"] for p in _parents}
        for item in result.get("schedule", []):
            if "parent_name" not in item:
                item["parent_name"] = parent_map.get(item.get("parent_id"), "Unknown")
        _logger.info(f"PARENT-ADMIN-AI  waves={result.get('total_waves')} parents={len(result.get('schedule', []))}")
        _ai_result_cache["parent_admin"] = {"result": result, "expires_at": time.time() + _AI_CACHE_TTL}
        return result
    except Exception as e:
        error_str = str(e)
        _logger.warning(f"PARENT-ADMIN-AI  AI error: {error_str}")
        if "rate_limit" in error_str.lower() or "429" in error_str or "quota" in error_str.lower():
            _logger.info("PARENT-ADMIN-AI  rate-limited, using local fallback scheduler")
        else:
            _logger.info("PARENT-ADMIN-AI  AI unavailable, using local fallback scheduler")
        result = _local_schedule_fallback()
        result["metrics"] = metrics
        result["ai_error"] = error_str
        return result


# ── AI Queue Analysis (Anthropic Claude) ─────────────────────────────────────

def _compute_queue_metrics() -> dict:
    """Compute real-time queue metrics for AI analysis."""
    now = datetime.datetime.utcnow()
    
    total_scanned = len(_scans)
    waiting = [s for s in _scans if s["queue_status"] == "waiting"]
    in_pickup = [s for s in _scans if s["queue_status"] == "pickup"]
    done = [s for s in _scans if s["queue_status"] == "done"]
    
    # Compute average pickup time for completed pickups
    pickup_times = []
    for s in done:
        if s["picked_up_at"] and s["scanned_at"]:
            scan_t = datetime.datetime.fromisoformat(s["scanned_at"])
            pick_t = datetime.datetime.fromisoformat(s["picked_up_at"])
            pickup_times.append((pick_t - scan_t).total_seconds())
    
    avg_pickup_time = sum(pickup_times) / len(pickup_times) if pickup_times else 0
    max_pickup_time = max(pickup_times) if pickup_times else 0
    min_pickup_time = min(pickup_times) if pickup_times else 0
    
    # Current wait time for kids still in queue
    current_waits = []
    for s in waiting + in_pickup:
        scan_t = datetime.datetime.fromisoformat(s["scanned_at"])
        current_waits.append((now - scan_t).total_seconds())
    
    avg_current_wait = sum(current_waits) / len(current_waits) if current_waits else 0
    
    # Throughput: pickups per minute
    if len(done) >= 2:
        first_done = min(datetime.datetime.fromisoformat(s["picked_up_at"]) for s in done if s["picked_up_at"])
        last_done = max(datetime.datetime.fromisoformat(s["picked_up_at"]) for s in done if s["picked_up_at"])
        duration_min = max((last_done - first_done).total_seconds() / 60, 0.1)
        throughput = len(done) / duration_min
    else:
        throughput = 0
    
    # Per-pillar breakdown
    pillar_stats = {}
    for p in range(1, PILLAR_COUNT + 1):
        p_scans = [s for s in _scans if s["pillar"] == p]
        p_done = [s for s in p_scans if s["queue_status"] == "done"]
        p_times = []
        for s in p_done:
            if s["picked_up_at"] and s["scanned_at"]:
                scan_t = datetime.datetime.fromisoformat(s["scanned_at"])
                pick_t = datetime.datetime.fromisoformat(s["picked_up_at"])
                p_times.append((pick_t - scan_t).total_seconds())
        pillar_stats[f"P{p}"] = {
            "total": len(p_scans),
            "done": len(p_done),
            "waiting": len([s for s in p_scans if s["queue_status"] == "waiting"]),
            "avg_pickup_sec": round(sum(p_times) / len(p_times), 1) if p_times else 0,
        }

    return {
        "total_scanned": total_scanned,
        "waiting": len(waiting),
        "in_pickup": len(in_pickup),
        "done": len(done),
        "avg_pickup_time_sec": round(avg_pickup_time, 1),
        "max_pickup_time_sec": round(max_pickup_time, 1),
        "min_pickup_time_sec": round(min_pickup_time, 1),
        "avg_current_wait_sec": round(avg_current_wait, 1),
        "throughput_per_min": round(throughput, 2),
        "pillar_count": PILLAR_COUNT,
        "pillar_stats": pillar_stats,
        "pickup_started": _pickup_started,
    }


@app.get("/api/ai/metrics")
def get_queue_metrics():
    """Return computed queue metrics (no AI needed)."""
    return _compute_queue_metrics()


@app.get("/api/ai/analyze")
def ai_analyze_queue():
    """Use Google Gemini to analyze queue state and recommend optimizations."""
    api_key = get_config_key("GOOGLE_GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_GEMINI_API_KEY not set in environment. Get a free key at https://aistudio.google.com/")

    # ── Return cached result if still fresh ─────────────────────────────────
    _cached = _ai_result_cache.get("ai_analyze")
    if _cached and _cached["expires_at"] > time.time():
        _logger.debug(f"AI-ANALYZE  serving cached result (expires in {round(_cached['expires_at']-time.time(),0)}s)")
        return _cached["result"]

    metrics = _compute_queue_metrics()
    
    prompt = f"""You are an AI queue optimization expert for a kids pickup system at a school.

CURRENT QUEUE METRICS:
- Total scanned: {metrics['total_scanned']}
- Currently waiting (main road): {metrics['waiting']}
- Currently in pickup lane: {metrics['in_pickup']}
- Completed pickups: {metrics['done']}
- Average pickup time: {metrics['avg_pickup_time_sec']}s
- Max pickup time: {metrics['max_pickup_time_sec']}s
- Min pickup time: {metrics['min_pickup_time_sec']}s
- Average current wait: {metrics['avg_current_wait_sec']}s
- Throughput: {metrics['throughput_per_min']} pickups/min
- Pillar count: {metrics['pillar_count']}
- Pillar stats: {json.dumps(metrics['pillar_stats'])}

SYSTEM CONSTRAINTS:
- {PILLAR_COUNT} pillars (P1-P5), cars are assigned round-robin
- Cars enter a ramp from main road, cruise to their pillar, then lane-change to pickup lane
- Each car must dwell at its pillar for a minimum of {int(PICKUP_DWELL_SEC)} seconds before departure (mandatory dwell time)
- Cars must maintain following distance, batch coordination ensures same-batch cars confirm together

RESPOND WITH VALID JSON ONLY (no markdown, no code fences):
{{
  "optimal_batch_size": <number 1-10>,
  "recommended_countdown_sec": <number 5-30>,
  "queue_health": "green" | "yellow" | "red",
  "estimated_wait_for_new_car_sec": <number>,
  "parent_alert": {{
    "should_alert": true/false,
    "message": "<alert message for parents if queue is long>",
    "severity": "info" | "warning" | "critical"
  }},
  "recommendations": [
    "<actionable recommendation 1>",
    "<actionable recommendation 2>",
    "<actionable recommendation 3>"
  ],
  "bottleneck": "<identified bottleneck or 'none'>",
  "summary": "<1-2 sentence summary of queue health>"
}}"""

    try:
        model = get_gemini_model()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        data = _call_gemini(payload, api_key, model, retries=2)
        response_text = data["candidates"][0]["content"]["parts"][0]["text"]
        try:
            analysis = json.loads(response_text)
        except json.JSONDecodeError:
            start = response_text.find('{')
            end = response_text.rfind('}') + 1
            if start >= 0 and end > start:
                analysis = json.loads(response_text[start:end])
            else:
                analysis = {"error": "Could not parse AI response", "raw": response_text}
        analysis["metrics"] = metrics
        _logger.info(f"AI-ANALYZE  health={analysis.get('queue_health','?')} alert={analysis.get('parent_alert',{}).get('should_alert',False)}")
        _ai_result_cache["ai_analyze"] = {"result": analysis, "expires_at": time.time() + _AI_CACHE_TTL}
        return analysis
    except Exception as e:
        _logger.error(f"AI-ANALYZE  Gemini API error: {e}")
        raise HTTPException(status_code=502, detail=f"Gemini API error: {str(e)}")


# ── AI Chat (free-form questions) ────────────────────────────────────────────

class ChatRequest(BaseModel):
    question: str


@app.post("/api/ai/chat")
def ai_chat(req: ChatRequest):
    """Let users ask free-form questions about the queue, answered by AI with live metrics context."""
    api_key = get_config_key("GOOGLE_GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_GEMINI_API_KEY not set")

    metrics = _compute_queue_metrics()

    system_prompt = f"""You are a helpful AI assistant for a kids pickup queue system at a school.
You have access to real-time queue metrics. Answer the user's question based on this data.
Be concise (2-4 sentences unless they ask for detail). Use plain language a parent or teacher would understand.

QUEUE METRICS:
- Total scanned: {metrics['total_scanned']}
- Waiting: {metrics['waiting']}
- In pickup lane: {metrics['in_pickup']}
- Completed: {metrics['done']}
- Avg pickup time (s): {metrics['avg_pickup_time_sec']}
- Max pickup time (s): {metrics['max_pickup_time_sec']}
- Min pickup time (s): {metrics['min_pickup_time_sec']}
- Avg current wait (s): {metrics['avg_current_wait_sec']}
- Throughput (per min): {metrics['throughput_per_min']}
- Pillars: {metrics['pillar_count']}
"""

    question = req.question.strip()
    prompt = system_prompt + "\nUser: " + question + "\nAssistant:"

    try:
        model = get_gemini_model()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"Content-Type": "application/json"}
        payload = {"contents": [{"parts": [{"text": prompt}]}]}
        data = _call_gemini(payload, api_key, model, retries=2)
        response_text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [""])[0].get("text", "")
        _logger.info(f"AI-CHAT  q={question[:60]}  a={response_text[:80]}")
        return {"answer": response_text, "metrics": metrics}
    except Exception as e:
        _logger.error(f"AI-CHAT  Gemini API error: {e}")
        raise HTTPException(status_code=502, detail=f"Gemini API error: {str(e)}")


# ── AI Smart Scheduling Agent ───────────────────────────────────────────────

@app.get("/api/ai/smart-schedule")
def ai_smart_schedule():
    """
    AI agent that combines real-time traffic data with queue analytics to create
    an optimal departure schedule. Ensures queue at school doesn't grow too large
    and predicts exactly when each parent should start driving based on traffic.
    """

    metrics = _compute_queue_metrics()

    # Gather traffic data for all parents
    parent_travel = []
    for parent in _parents:
        distance_km = parent.get("distance_km", 5)
        travel_traffic_min = parent.get("travel_time_traffic_min", 0)
        if travel_traffic_min <= 0:
            travel_traffic_min = round(distance_km / 30 * 60, 1)
        traffic_cond = parent.get("traffic_condition", "unknown")
        kid = next((k for k in _kids if k["id"] == parent["kid_id"]), None)
        scan = next((s for s in _scans if s["kid_id"] == parent["kid_id"]), None)

        parent_travel.append({
            "parent_id": parent["id"],
            "parent_name": parent["name"],
            "distance_km": distance_km,
            "travel_time_min": parent.get("travel_time_min", 0),
            "travel_time_traffic_min": travel_traffic_min,
            "traffic_condition": traffic_cond,
            "kid_name": kid["name"] if kid else "Unknown",
            "scanned": scan is not None,
            "queue_status": scan["queue_status"] if scan else None,
            "location": {"lat": parent["location_lat"], "lng": parent["location_lng"]},
        })

    # Log all input parameters
    _logger.debug(f"AI-SMART-SCHEDULE INPUT: metrics={json.dumps(metrics)} parents={json.dumps(parent_travel)}")

    # Sort by travel time DESCENDING (farthest first) — this minimises total session duration
    # (first arrival → last departure) by targeting the farthest cars at T=0 so they anchor
    # the start of the stream.  Closer cars are staggered at exactly the throughput rate behind
    # them, forming a tight continuous stream.  With ASCENDING sort every parent whose travel
    # time exceeds desired_arrival would clamp to leave_in=0 and arrive at their travel time,
    # spreading arrivals over the full travel-time range (teacher waits much longer).
    parent_travel.sort(key=lambda p: p["travel_time_traffic_min"], reverse=True)

    # Compute scheduling parameters — use THEORETICAL_THROUGHPUT_PER_MIN as floor so we never
    # stall with arrival_spacing=2min when the queue just started and has no pickups yet.
    raw_throughput = metrics.get("throughput_per_min", 0.0)
    throughput = raw_throughput if raw_throughput >= 0.5 else THEORETICAL_THROUGHPUT_PER_MIN
    current_waiting = metrics.get("waiting", 0)
    current_in_pickup = metrics.get("in_pickup", 0)

    # Queue capacity target: PILLAR_COUNT to PILLAR_COUNT*2 cars waiting
    target_queue_min = PILLAR_COUNT
    target_queue_max = PILLAR_COUNT * 2
    wave_size = PILLAR_COUNT

    parents_not_scanned = [p for p in parent_travel if not p["scanned"]]
    parents_scanned = [p for p in parent_travel if p["scanned"]]

    # ── Steady-stream staggering ────────────────────────────────────────────
    # Instead of batching parents into waves (which causes burst→empty cycle),
    # stagger each parent individually so arrivals form a continuous stream at
    # exactly the rate the school can process them.
    #
    #   arrival_spacing  = 1 / throughput  (minutes between consecutive arrivals)
    #   desired_arrival  = delay + i * arrival_spacing
    #   leave_in         = desired_arrival - travel_time - traffic_buffer
    #
    # If the current queue is already backed up, push the first arrival later
    # so we don't flood an already-full lane.
    # ────────────────────────────────────────────────────────────────────────

    # Arrival spacing: how many minutes between each successive parent's arrival
    # Default: throughput-based (pack at max sustainable rate).
    # Hard floor: consecutive cars must be at least ARRIVAL_GAP_SEC apart at the destination.
    _dwell_gap_min = round(ARRIVAL_GAP_SEC / 60.0, 4)   # 10s → 0.1667 min
    _min_safe_spacing = max(round(1.0 / THEORETICAL_THROUGHPUT_PER_MIN, 3), _dwell_gap_min)
    arrival_spacing = max(round(1.0 / throughput, 3), _dwell_gap_min)
    # ── Period constraint ────────────────────────────────────────────────────
    # If PICKUP_PERIOD_MIN is set, tighten arrival_spacing so all N parents
    # arrive within (PICKUP_PERIOD_MIN - wave_drain_min) minutes of the first.
    _wave_drain_for_period = round(PILLAR_COUNT / throughput, 2)
    _n_unscanned = len(parents_not_scanned)
    if PICKUP_PERIOD_MIN > 0 and _n_unscanned > 1:
        _period_budget = PICKUP_PERIOD_MIN - _wave_drain_for_period
        _period_max_spacing = _period_budget / (_n_unscanned - 1) if _period_budget > 0 else _min_safe_spacing
        if _period_max_spacing >= _min_safe_spacing:
            # Period is feasible — tighten spacing to hit the deadline.
            arrival_spacing = round(max(_min_safe_spacing, min(arrival_spacing, _period_max_spacing)), 3)
            _logger.debug(
                f"SMART-SCHED-SPACING  period={PICKUP_PERIOD_MIN}min  n={_n_unscanned}"
                f"  period_max={round(_period_max_spacing,3)}  chosen={arrival_spacing}"
            )
        else:
            # Period is physically infeasible for N parents — ignore SLA and run
            # at natural throughput pace.  Queue drains at its own speed.
            _logger.debug(
                f"SMART-SCHED-SPACING  period={PICKUP_PERIOD_MIN}min INFEASIBLE for n={_n_unscanned}"
                f" (need {round((_n_unscanned-1)*_min_safe_spacing+_wave_drain_for_period,1)}min)"
                f" — ignoring period constraint, using throughput spacing={arrival_spacing}min"
            )

    # Re-apply dwell floor after period constraint may have reduced spacing.
    # This guarantees consecutive arrivals are always >= PICKUP_DWELL_SEC apart regardless
    # of throughput or period settings.
    if arrival_spacing < _dwell_gap_min:
        _logger.debug(
            f"SMART-SCHED-SPACING  arrival gap floor applied: {arrival_spacing}min → {_dwell_gap_min}min"
            f" ({int(ARRIVAL_GAP_SEC)}s arrival gap guarantee)"
        )
        arrival_spacing = _dwell_gap_min

    # If queue is already near-full, hold off until it drains to target_queue_min
    if current_waiting >= target_queue_max:
        queue_backlog_delay = (current_waiting - target_queue_min) / throughput
    elif current_waiting >= target_queue_min:
        # Partially full — wait only until 1 slot opens up
        queue_backlog_delay = (current_waiting - target_queue_min + 1) / throughput
    else:
        queue_backlog_delay = 0  # queue is thin/empty → start filling immediately

    # ── Wave-based scheduling ────────────────────────────────────────────────
    # All PILLAR_COUNT cars in a wave share the same target arrival time so they
    # pull up simultaneously (one per pillar).  Waves are separated by exactly
    # ARRIVAL_GAP_SEC seconds so the previous wave clears before the next arrives.
    #
    #   wave_slot(n) = queue_backlog_delay + (n-1) * _gap_between_waves_min
    #   leave_in     = wave_slot - travel_time_traffic - traffic_buffer
    #
    # Cars with longer travel times leave earlier; everyone in the same wave
    # targets the identical arrival minute.
    # ────────────────────────────────────────────────────────────────────────
    _gap_between_waves_min = round(ARRIVAL_GAP_SEC / 60.0, 4)  # 10s → 0.1667 min
    total_waves = (len(parents_not_scanned) + wave_size - 1) // wave_size if parents_not_scanned else 0

    schedule = []
    for i, pt in enumerate(parents_not_scanned):
        wave_num = (i // wave_size) + 1

        # All cars in this wave aim for the same arrival slot
        wave_slot = queue_backlog_delay + (wave_num - 1) * _gap_between_waves_min

        # Departure = target arrival minus actual (traffic) travel time
        traffic_buffer = {"heavy": 2, "moderate": 1}.get(pt["traffic_condition"], 0)
        departure_delay = wave_slot - pt["travel_time_traffic_min"] - traffic_buffer

        leave_in = max(0, round(departure_delay, 1))
        est_arrival = round(leave_in + pt["travel_time_traffic_min"], 1)

        if pt["traffic_condition"] in ("heavy", "moderate"):
            reason = (f"wave {wave_num} – {pt['traffic_condition']} traffic "
                      f"(+{traffic_buffer}min buffer), target arrival at {round(wave_slot,2)}min")
        elif leave_in == 0:
            reason = f"wave {wave_num} – leave now (travel time exceeds target slot)"
        else:
            reason = (f"wave {wave_num} of {total_waves} – "
                      f"all {wave_size} cars target arrival at {round(wave_slot*60,0):.0f}s from now")

        schedule.append({
            "parent_id": pt["parent_id"],
            "parent_name": pt["parent_name"],
            "leave_in_minutes": leave_in,
            "wave": wave_num,
            "travel_time_traffic_min": pt["travel_time_traffic_min"],
            "traffic_condition": pt["traffic_condition"],
            "estimated_arrival_min": est_arrival,
            "reason": reason,
            "traffic_buffer_min": traffic_buffer,
            "arrival_slot": round(wave_slot, 2),
        })

    traffic_summary = {
        "light": len([p for p in parent_travel if p["traffic_condition"] == "light"]),
        "moderate": len([p for p in parent_travel if p["traffic_condition"] == "moderate"]),
        "heavy": len([p for p in parent_travel if p["traffic_condition"] == "heavy"]),
    }

    avg_travel = sum(p["travel_time_traffic_min"] for p in parent_travel) / max(len(parent_travel), 1)
    max_travel = max((p["travel_time_traffic_min"] for p in parent_travel), default=0)

    queue_pressure = "low"
    if current_waiting > PILLAR_COUNT * 3:
        queue_pressure = "high"
    elif current_waiting > PILLAR_COUNT:
        queue_pressure = "medium"

    result = {
        "schedule": schedule,
        "total_waves": total_waves,
        "wave_size": wave_size,
        "wave_gap_sec": int(ARRIVAL_GAP_SEC),
        "wave_gap_min": round(_gap_between_waves_min, 4),
        "already_scanned": len(parents_scanned),
        "yet_to_schedule": len(parents_not_scanned),
        "traffic_summary": traffic_summary,
        "avg_travel_time_min": round(avg_travel, 1),
        "max_travel_time_min": round(max_travel, 1),
        "queue_pressure": queue_pressure,
        "target_queue_size": {"min": target_queue_min, "max": target_queue_max},
        "throughput_per_min": throughput,
        "dwell_sec": int(PICKUP_DWELL_SEC),
        "theoretical_session_floor_min": round(total_waves * _gap_between_waves_min, 1) if total_waves else None,
        "summary": (f"Wave schedule: {len(schedule)} parents in {total_waves} waves of {wave_size}. "
                    f"Each wave: {wave_size} cars arrive simultaneously (1 per pillar). "
                    f"Gap between waves: {int(ARRIVAL_GAP_SEC)}s. "
                    f"Avg travel: {round(avg_travel,1)}min. "
                    f"Traffic: {traffic_summary['light']}L/{traffic_summary['moderate']}M/{traffic_summary['heavy']}H. "
                    f"Queue pressure: {queue_pressure}."),
        "metrics": metrics,
        "school_location": {"lat": SCHOOL_LAT, "lng": SCHOOL_LNG},
    }

    # Log all output schedule
    _logger.debug(f"AI-SMART-SCHEDULE OUTPUT: {json.dumps(result)}")
    _logger.info(f"AI-SMART-SCHEDULE  waves={total_waves} wave_size={wave_size} gap={int(ARRIVAL_GAP_SEC)}s "
                 f"parents={len(schedule)} queue_pressure={queue_pressure} avg_travel={round(avg_travel,1)}min")
    return result


# ── OSRM route proxy (avoids browser mixed-content / CORS issues) ──────────────
@app.get("/api/osrm-route")
async def osrm_route(origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float):
    """Proxy OSRM driving route request server-side to avoid browser CORS/mixed-content blocks."""
    url = (
        f"http://router.project-osrm.org/route/v1/driving/"
        f"{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
        f"?overview=full&geometries=geojson"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"OSRM error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OSRM unreachable: {str(e)}")


# ── Start autonomous arrival background thread (after all functions are defined) ──
# Daemon thread ensures it exits when the main process exits.
# In a multi-worker production deployment, replace _SCHEDULED_ARRIVALS with Redis.
threading.Thread(target=_arrival_heartbeat_thread, daemon=True, name="arrival-heartbeat").start()
