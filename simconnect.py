# This script uses the Python-SimConnect library to connect to a flight simulator
# and retrieve various data points in real-time.

# IMPORTANT: Before running this script, you must have Python and the
# Python-SimConnect library installed. You can install the library by running:
# pip install SimConnect
#
# The flight simulator (e.g., Microsoft Flight Simulator, P3D) must also be running.

import time
import asyncio
import threading
import json

try:
    import websockets
except Exception:
    websockets = None

from SimConnect import SimConnect

# Define the data request ID. This is a unique identifier for our request.
# You can define multiple requests with different IDs.
DATA_REQUEST_ID = 0

# Define a simple data structure to hold the requested variables.
# This structure maps a descriptive name to the actual SimVar string.
# SimConnect needs to know what data to send back to us.
class SimData:
    def __init__(self):
        self.plane_latitude = None
        self.plane_longitude = None
        self.indicated_airspeed = None
        self.plane_altitude = None
        self.gear_position = None
        self.flaps_position = None
        self.spoilers_handle_position = None
        self.aircraft_title = None
        self.aircraft_registration = None
        self.landing_light_state = None

# A class to handle the SimConnect connection and data handling.
class SimConnectDataClient:
    def __init__(self):
        self.sim = None
        self.sim_data = SimData()
        self.is_connected = False
        # WebSocket server loop and thread
        self.ws_loop = None
        self.ws_thread = None
        self.connected_clients = set()
        self.WS_HOST = "localhost"
        self.WS_PORT = 8765
        if websockets is None:
            print("Warning: 'websockets' package not found. Real-time web updates will be disabled. Install with: pip install websockets")
        else:
            # Start websocket server in background thread
            self.ws_loop = asyncio.new_event_loop()
            self.ws_thread = threading.Thread(target=self._start_ws_server, daemon=True)
            self.ws_thread.start()

    def connect(self):
        """Attempts to establish a connection to the flight simulator."""
        try:
            self.sim = SimConnect()
            self.is_connected = True
            print("Successfully connected to the simulator.")
            self.setup_data_definition()
            self.subscribe_to_data()
        except Exception as e:
            print(f"Error connecting to SimConnect: {e}")
            self.is_connected = False

    def setup_data_definition(self):
        """
        Defines the data structure that will be requested from SimConnect.
        This tells SimConnect which simulation variables we want to receive.
        """
        if not self.is_connected:
            return

        # Get a data definition object and define our variables.
        # The arguments are: variable name, unit, data type.
        # We're using "number" as a unit for simplicity for most values.
        # For the string values, we use a different data type.
        data_def = self.sim.get_data_definition(DATA_REQUEST_ID)
        data_def.add("PLANE LATITUDE", "degrees")
        data_def.add("PLANE LONGITUDE", "degrees")
        data_def.add("AIRSPEED INDICATED", "knots")
        data_def.add("PLANE ALTITUDE", "feet")
        data_def.add("GEAR HANDLE POSITION", "bool")  # Landing gear position (0 for up, 1 for down)
        data_def.add("FLAPS HANDLE POSITION", "position")
        data_def.add("SPOILERS HANDLE POSITION", "position")
        data_def.add("TITLE", "string", 256)  # Aircraft type string
        data_def.add("ATC AIRCRAFT REGISTRATION", "string", 256)
        data_def.add("LIGHT LANDING", "bool") # Landing light status (0 for off, 1 for on)

        print("Data definition created successfully.")

    # --- Websocket server / broadcaster helpers ---
    def _start_ws_server(self):
        """Run the asyncio event loop and websocket server in a background thread."""
        asyncio.set_event_loop(self.ws_loop)

        async def handler(websocket, path):
            # Register
            self.connected_clients.add(websocket)
            try:
                await websocket.wait_closed()
            finally:
                self.connected_clients.discard(websocket)

        start_server = websockets.serve(handler, self.WS_HOST, self.WS_PORT)
        try:
            self.ws_loop.run_until_complete(start_server)
            print(f"WebSocket server started on ws://{self.WS_HOST}:{self.WS_PORT}")
            self.ws_loop.run_forever()
        except Exception as e:
            print(f"WebSocket server error: {e}")

    async def _broadcast_async(self, message):
        """Coroutine: broadcast a message to all connected websocket clients."""
        if not self.connected_clients:
            return
        to_remove = set()
        for ws in list(self.connected_clients):
            try:
                await ws.send(message)
            except Exception:
                to_remove.add(ws)
        for ws in to_remove:
            self.connected_clients.discard(ws)

    def broadcast(self, payload: dict):
        """Called from the synchronous SimConnect loop to send JSON to web clients."""
        if websockets is None or self.ws_loop is None:
            return
        try:
            message = json.dumps(payload)
            asyncio.run_coroutine_threadsafe(self._broadcast_async(message), self.ws_loop)
        except Exception as e:
            print(f"Failed to broadcast websocket message: {e}")

    def subscribe_to_data(self):
        """
        Requests the defined data from the simulator.
        This sets up a continuous stream of data updates.
        """
        if not self.is_connected:
            return

        # Request data for the user's aircraft (the "user" object ID is 1).
        # We request updates on a per-second basis (SIMCONNECT_PERIOD_SECOND).
        self.sim.request_data_on_simobject(
            DATA_REQUEST_ID,
            SimConnect.SIMCONNECT_OBJECT_ID_USER,
            SimConnect.SIMCONNECT_PERIOD_SECOND,
            SimConnect.SIMCONNECT_DATA_REQUEST_FLAG_CHANGED,
        )
        print("Subscribed to data updates. Waiting for data...")

    def update_data(self):
        """
        Processes incoming data from SimConnect and updates our SimData object.
        This function is called by the main loop.
        """
        if not self.is_connected:
            return

        # Get a list of the updated data from SimConnect.
        data = self.sim.get_next_dispatch()
        if data:
            data_id, data_obj = data
            if data_id == DATA_REQUEST_ID:
                self.sim_data.plane_latitude = data_obj[0]
                self.sim_data.plane_longitude = data_obj[1]
                self.sim_data.indicated_airspeed = data_obj[2]
                self.sim_data.plane_altitude = data_obj[3]
                self.sim_data.gear_position = "Down" if data_obj[4] else "Up"
                self.sim_data.flaps_position = data_obj[5]
                self.sim_data.spoilers_handle_position = data_obj[6]
                self.sim_data.aircraft_title = data_obj[7].rstrip('\x00')
                self.sim_data.aircraft_registration = data_obj[8].rstrip('\x00')
                self.sim_data.landing_light_state = "On" if data_obj[9] else "Off"
                self.print_data()
                # Send a compact payload to any connected web clients
                payload = {
                    "aircraft_title": self.sim_data.aircraft_title,
                    "registration": self.sim_data.aircraft_registration,
                    "speed": self.sim_data.indicated_airspeed,
                    "altitude": self.sim_data.plane_altitude,
                    "latitude": self.sim_data.plane_latitude,
                    "longitude": self.sim_data.plane_longitude,
                    "gear": self.sim_data.gear_position,
                    "flaps": self.sim_data.flaps_position,
                    "spoilers": self.sim_data.spoilers_handle_position,
                    "landing_lights": self.sim_data.landing_light_state,
                    "ts": time.time(),
                }
                # Non-blocking broadcast to websocket clients
                self.broadcast(payload)

    def print_data(self):
        """Prints the current state of the simulation data to the console."""
        # The "current airport" is not a standard SimVar. It's usually
        # determined by an external database based on the aircraft's coordinates.
        # This script does not include that functionality.
        
        # Clear the console for a cleaner update display.
        # This works on most terminal environments.
        print("\033[H\033[J", end="")
        
        print("--- Flight Simulator Data ---")
        print(f"Aircraft Type:           {self.sim_data.aircraft_title}")
        print(f"Aircraft Registration:   {self.sim_data.aircraft_registration}")
        print("-" * 27)
        print(f"Speed:                   {self.sim_data.indicated_airspeed:.2f} knots")
        print(f"Altitude:                {self.sim_data.plane_altitude:.2f} feet")
        print(f"Latitude:                {self.sim_data.plane_latitude:.6f}°")
        print(f"Longitude:               {self.sim_data.plane_longitude:.6f}°")
        print("-" * 27)
        print(f"Landing Gear:            {self.sim_data.gear_position}")
        print(f"Flaps Position:          {self.sim_data.flaps_position:.2f}")
        print(f"Spoiler Position:        {self.sim_data.spoilers_handle_position:.2f}")
        print(f"Landing Lights:          {self.sim_data.landing_light_state}")

    def run_loop(self):
        """The main loop that continuously updates and displays data."""
        self.connect()
        if not self.is_connected:
            print("Could not connect to SimConnect. Exiting.")
            return

        try:
            while True:
                self.update_data()
                # A small delay to prevent the loop from running too fast.
                time.sleep(0.5)
        except KeyboardInterrupt:
            print("\nScript terminated by user.")
        finally:
            self.sim.exit()
            print("Connection to simulator closed.")


if __name__ == "__main__":
    client = SimConnectDataClient()
    client.run_loop()
