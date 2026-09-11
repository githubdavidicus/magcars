// magcarsapp.js has been replaced by separate HTML and JS files to fix parsing
// and improve maintainability. Please use the new files in this directory:
//
//   magcarsapp.html  - The HTML page to open in your browser
//   client.js        - The extracted client-side JavaScript module
//
// If you still need this file removed, run:
//   git rm src/magcarsapp.js
//
          type="text"
          placeholder="Enter ICAO code (e.g., EGLL)"
          maxlength="4"
          class="flex-1 p-2 border border-gray-500 rounded-md text-sm bg-gray-900 text-white placeholder-gray-400 shadow-sm uppercase"
        />
        <button
          id="getWeatherBtn"
          class="px-4 py-2 bg-sky-400 hover:bg-sky-500 text-white font-semibold rounded-full transition duration-300 transform hover:scale-105"
        >
          Get Weather
        </button>
      </div>
      <div
        id="weatherDisplay"
        class="weather-info-display space-y-4 text-sm text-white flex-1 p-4 bg-gray-900 border border-gray-700 rounded-lg shadow-inner"
      >
        <div class="text-center text-gray-400">
          Enter an ICAO code and click "Get Weather" to see the latest report.
        </div>
      </div>
    </div>

    <!-- OpenLayers JS -->
    <script src="https://cdn.jsdelivr.net/npm/ol@v8.2.0/dist/ol.js"></script>

    <!-- Firebase SDKs -->
    <script type="module">
      import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
      import {
        getAuth,
        signInAnonymously,
        signInWithCustomToken,
        onAuthStateChanged,
      } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
      import {
        getFirestore,
        collection,
        addDoc,
        onSnapshot,
        query,
        where,
        serverTimestamp,
      } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

      // Firebase Global Variables
      const appId =
        typeof __app_id !== "undefined" ? __app_id : "default-app-id";
      const firebaseConfig =
        typeof __firebase_config !== "undefined"
          ? JSON.parse(__firebase_config)
          : {};
      const initialAuthToken =
        typeof __initial_auth_token !== "undefined"
          ? __initial_auth_token
          : null;

      let db, auth, userId;
      let flightPathCoordinates = [];
      let currentFlightFeature = null;
      let pastFlightsLayer, liveFlightLayer;
      let unsubscribeFromFlights = null;

      const statusMessageEl = document.getElementById("statusMessage");
      const userIdDisplayEl = document.getElementById("userIdDisplay");
      const recordFlightBtn = document.getElementById("recordFlightBtn");
      const showPastFlightsBtn = document.getElementById("showPastFlightsBtn");
      const pastFlightsListEl = document.getElementById("pastFlightsList");
      const altDisplayEl = document.getElementById("altDisplay");
      const speedDisplayEl = document.getElementById("speedDisplay");
      const depDisplayEl = document.getElementById("depDisplay");
      const destDisplayEl = document.getElementById("destDisplay");
      const regDisplayEl = document.getElementById("regDisplay");
      const flightFilterCheckboxes = document.querySelectorAll(
        'input[name="flightFilter"]'
      );

      // --- OpenLayers Map Initialization ---
      const map = new ol.Map({
        target: "map",
        layers: [
          new ol.layer.Tile({
            source: new ol.source.OSM(),
          }),
        ],
        view: new ol.View({
          center: ol.proj.fromLonLat([0, 0]),
          zoom: 2,
        }),
      });

      // Layer for the live flight path
      liveFlightLayer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(59, 130, 246, 0.8)",
            width: 4,
          }),
        }),
      });
      map.addLayer(liveFlightLayer);

      // Layer for past flights
      pastFlightsLayer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(22, 163, 74, 0.6)",
            width: 3,
            lineDash: [5, 5],
          }),
        }),
      });
      map.addLayer(pastFlightsLayer);

      // --- Firebase Initialization and Authentication ---
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      auth = getAuth(app);

      onAuthStateChanged(auth, async (user) => {
        if (user) {
          userId = user.uid;
          userIdDisplayEl.textContent = "Hello, " + userId;
          console.log(
            "Firebase Auth State Changed: User is authenticated. UID:",
            userId
          );
          startTracking();
        } else {
          console.log(
            "Firebase Auth State Changed: No user found. Signing in."
          );
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(auth, initialAuthToken);
              console.log("Signed in with custom token.");
            } else {
              await signInAnonymously(auth);
              console.log("Signed in anonymously.");
            }
          } catch (error) {
            console.error("Firebase auth error:", error);
            statusMessageEl.textContent =
              "Error signing in. Check console for details.";
          }
        }
      });

      // --- Location Tracking & Map Update ---
      function startTracking() {
        if (navigator.geolocation) {
          statusMessageEl.textContent =
            "Tracking your flight. The map will update as you move.";
          const options = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0,
          };
          navigator.geolocation.watchPosition(updateMap, showError, options);
        } else {
          statusMessageEl.textContent =
            "Geolocation is not supported by your browser.";
        }
      }

      function updateMap(position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const altitude =
          position.coords.altitude !== null ? position.coords.altitude : "N/A";
        const speed =
          position.coords.speed !== null
            ? (position.coords.speed * 1.944).toFixed(2)
            : "N/A";
        const newCoord = ol.proj.fromLonLat([lon, lat]);

        if (flightPathCoordinates.length === 0) {
          map.getView().animate({ center: newCoord, zoom: 14 });
        }
        flightPathCoordinates.push(newCoord);

        // Create a new line feature or update the existing one
        if (currentFlightFeature) {
          currentFlightFeature
            .getGeometry()
            .setCoordinates(flightPathCoordinates);
        } else {
          const lineString = new ol.geom.LineString(flightPathCoordinates);
          currentFlightFeature = new ol.Feature({
            geometry: lineString,
          });
          liveFlightLayer.getSource().addFeature(currentFlightFeature);
        }
        // Update the floating window and status message
        depDisplayEl.innerHTML = `<span class="font-semibold">Departure:</span> N/A`;
        destDisplayEl.innerHTML = `<span class="font-semibold">Destination:</span> N/A`;
        regDisplayEl.innerHTML = `<span class="font-semibold">Registration:</span> N/A`;
        altDisplayEl.innerHTML = `<span class="font-semibold">Altitude:</span> ${
          altitude !== "N/A" ? `${altitude.toFixed(2)} m` : "N/A"
        }`;
        speedDisplayEl.innerHTML = `<span class="font-semibold">Speed:</span> ${
          speed !== "N/A" ? `${speed} knots` : "N/A"
        }`;
        statusMessageEl.textContent = "Live tracking active.";
      }

      function showError(error) {
        let message = "";
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = "User denied the request for Geolocation.";
            break;
          case error.POSITION_UNAVAILABLE:
            message = "Location information is unavailable.";
            break;
          case error.TIMEOUT:
            message = "The request to get user location timed out.";
            break;
          case error.UNKNOWN_ERROR:
            message = "An unknown error occurred.";
            break;
        }
        statusMessageEl.textContent = `Error: ${message}`;
      }

      // --- Firestore Data Functions ---
      async function recordFlight() {
        if (flightPathCoordinates.length < 2) {
          statusMessageEl.textContent =
            "Not enough data to record a flight. Please move to track a path.";
          return;
        }

        const departure = "N/A";
        const destination = "N/A";
        const registration = "N/A";

        try {
          const flightsCollectionRef = collection(
            db,
            `artifacts/${appId}/public/data/flights`
          );
          await addDoc(flightsCollectionRef, {
            userId: userId,
            departure: departure,
            destination: destination,
            registration: registration,
            path: JSON.stringify(flightPathCoordinates),
            timestamp: serverTimestamp(),
          });
          statusMessageEl.textContent = "Flight path saved successfully!";
          flightPathCoordinates = [];
          liveFlightLayer.getSource().clear();
          currentFlightFeature = null;
        } catch (e) {
          console.error("Error adding document: ", e);
          statusMessageEl.textContent =
            "Error saving flight. See console for details.";
        }
      }

      const magFlightData = [
        {
          id: "mag1",
          departure: "JFK",
          destination: "LAX",
          registration: "N12345",
          path: [
            [-74.006, 40.7128],
            [-80.1918, 25.7617],
            [-118.2437, 34.0522],
          ],
        },
        {
          id: "mag2",
          departure: "LHR",
          destination: "JFK",
          registration: "G-MAG1",
          path: [
            [-0.1278, 51.5074],
            [-74.006, 40.7128],
          ],
        },
        {
          id: "mag3",
          departure: "DXB",
          destination: "SIN",
          registration: "A6-MAG",
          path: [
            [55.2708, 25.2048],
            [103.8198, 1.3521],
          ],
        },
      ];

      function showPastFlights(filterTypes) {
        if (unsubscribeFromFlights) {
          unsubscribeFromFlights();
        }

        pastFlightsLayer.getSource().clear();
        pastFlightsListEl.innerHTML =
          '<li class="text-sm text-gray-300 p-2 rounded-lg text-center">Loading flights...</li>';

        if (filterTypes.length === 0) {
          pastFlightsListEl.innerHTML =
            '<li class="text-sm text-gray-300 p-2 rounded-lg text-center">No filters selected.</li>';
          statusMessageEl.textContent = "No filters selected. Map cleared.";
          return;
        }

        const allFlights = [];

        const processMAGFlights = () => {
          magFlightData.forEach((data) => {
            const path = data.path.map((coord) => ol.proj.fromLonLat(coord));
            const lineString = new ol.geom.LineString(path);
            const feature = new ol.Feature({
              geometry: lineString,
              name: `MAG Flight from ${data.departure} to ${data.destination}`,
            });
            feature.set("type", "MAG");
            allFlights.push({ feature, data });
          });
        };

        const processMAGCARSFlights = () => {
          const flightsCollectionRef = collection(
            db,
            `artifacts/${appId}/public/data/flights`
          );
          let flightsQuery = query(flightsCollectionRef);

          unsubscribeFromFlights = onSnapshot(flightsQuery, (snapshot) => {
            if (snapshot.empty) {
              return; // Will handle the combined list later
            }

            snapshot.forEach((doc) => {
              const data = doc.data();
              try {
                const path = JSON.parse(data.path);
                const departure = data.departure || "N/A";
                const destination = data.destination || "N/A";
                const registration = data.registration || "N/A";

                const lineString = new ol.geom.LineString(path);
                const feature = new ol.Feature({
                  geometry: lineString,
                  name: `Flight from ${new Date(
                    data.timestamp.toDate()
                  ).toLocaleString()}`,
                });
                feature.set("type", "MAGCARS");
                allFlights.push({
                  feature,
                  data: {
                    departure,
                    destination,
                    registration,
                    timestamp: data.timestamp,
                  },
                });
              } catch (e) {
                console.error("Error parsing flight data:", e);
              }
            });

            renderFlights();
          });
        };

        const renderFlights = () => {
          pastFlightsLayer.getSource().clear();
          pastFlightsListEl.innerHTML = "";
          if (allFlights.length === 0) {
            pastFlightsListEl.innerHTML =
              '<li class="text-sm text-gray-300 p-2 rounded-lg text-center">No flights found for selected filters.</li>';
            statusMessageEl.textContent = "No flights found.";
            return;
          }

          allFlights.forEach(({ feature, data }) => {
            pastFlightsLayer.getSource().addFeature(feature);

            const listItem = document.createElement("li");
            listItem.classList.add(
              "p-2",
              "bg-gray-700",
              "text-gray-100",
              "border",
              "border-gray-600",
              "shadow-sm",
              "hover:bg-gray-800",
              "rounded-lg",
              "cursor-pointer",
              "transition-colors",
              "duration-200"
            );
            listItem.innerHTML = `
                        <div><span class="font-bold">From:</span> ${
                          data.departure
                        }</div>
                        <div><span class="font-bold">To:</span> ${
                          data.destination
                        }</div>
                        <div><span class="font-bold">Reg:</span> ${
                          data.registration
                        }</div>
                        ${
                          data.timestamp
                            ? `<div class="text-xs text-gray-400 mt-1">${new Date(
                                data.timestamp.toDate()
                              ).toLocaleString()}</div>`
                            : ""
                        }
                    `;
            listItem.addEventListener("click", () => {
              clearMap();
              pastFlightsLayer.getSource().addFeature(feature);
              const extent = feature.getGeometry().getExtent();
              map
                .getView()
                .fit(extent, { padding: [50, 50, 50, 50], duration: 1000 });
              statusMessageEl.textContent = `Zooming to flight.`;
            });
            pastFlightsListEl.appendChild(listItem);
          });
          statusMessageEl.textContent = `Displaying ${allFlights.length} flight(s) in the list and on the map.`;
        };

        const promises = [];
        if (filterTypes.includes("allMAGCARS")) {
          processMAGCARSFlights();
        }
        if (filterTypes.includes("allMAG")) {
          processMAGFlights();
        }

        // If a listener for MAGCARS is not set, we need to manually render the flights.
        if (!filterTypes.includes("allMAGCARS")) {
          renderFlights();
        }
      }

      function clearMap() {
        liveFlightLayer.getSource().clear();
        pastFlightsLayer.getSource().clear();
        flightPathCoordinates = [];
        currentFlightFeature = null;
        statusMessageEl.textContent = "Map has been cleared.";
      }

      // --- Slide-over Window Logic ---
      const pastFlightsIconBtn = document.getElementById("pastFlightsIconBtn");
      const aircraftIconBtn = document.getElementById("aircraftIconBtn");
      const bookFlightIconBtn = document.getElementById("bookFlightIconBtn");
      const weatherIconBtn = document.getElementById("weatherIconBtn"); // New Weather Icon Button
      const iconContainer = document.getElementById("iconContainer");
      const rightSideContainer = document.getElementById("rightSideContainer");

      const pastFlightsWindow = document.getElementById("pastFlightsWindow");
      const aircraftWindow = document.getElementById("aircraftWindow");
      const bookFlightWindow = document.getElementById("bookFlightWindow");
      const weatherWindow = document.getElementById("weatherWindow"); // New Weather Window

      const closePastFlightsBtn = document.getElementById(
        "closePastFlightsBtn"
      );
      const closeAircraftBtn = document.getElementById("closeAircraftBtn");
      const closeBookFlightBtn = document.getElementById("closeBookFlightBtn");
      const closeWeatherBtn = document.getElementById("closeWeatherBtn"); // New Close Button

      const windows = {
        pastFlights: pastFlightsWindow,
        aircraft: aircraftWindow,
        bookFlight: bookFlightWindow,
        weather: weatherWindow, // Add new window
      };

      const buttons = {
        pastFlights: pastFlightsIconBtn,
        aircraft: aircraftIconBtn,
        bookFlight: bookFlightIconBtn,
        weather: weatherIconBtn, // Add new button
      };

      function showWindow(windowName) {
        // Close any open window first
        for (const name in windows) {
          if (windows[name].classList.contains("translate-x-0")) {
            windows[name].classList.remove("translate-x-0");
            windows[name].classList.add("translate-x-full");
            buttons[name].classList.remove("bg-sky-400", "text-white");
            buttons[name].classList.add(
              "bg-gray-600/70",
              "text-white",
              "hover:bg-sky-400"
            );
          }
        }

        // Open the new window
        const windowEl = windows[windowName];
        const buttonEl = buttons[windowName];
        windowEl.classList.remove("translate-x-full");
        windowEl.classList.add("translate-x-0");
        buttonEl.classList.remove(
          "bg-gray-600/70",
          "text-white",
          "hover:bg-sky-400"
        );
        buttonEl.classList.add("bg-sky-400", "text-white");

        // Special action for Past Flights
        if (windowName === "pastFlights") {
          const selectedFilters = Array.from(
            document.querySelectorAll('input[name="flightFilter"]:checked')
          ).map((cb) => cb.value);
          showPastFlights(selectedFilters);
        }
      }

      function hideWindow(windowName) {
        const windowEl = windows[windowName];
        const buttonEl = buttons[windowName];
        windowEl.classList.remove("translate-x-0");
        windowEl.classList.add("translate-x-full");
        buttonEl.classList.remove("bg-sky-400", "text-white");
        buttonEl.classList.add(
          "bg-gray-600/70",
          "text-white",
          "hover:bg-sky-400"
        );
      }

      // Event listeners for icon buttons
      pastFlightsIconBtn.addEventListener("click", () => {
        if (pastFlightsWindow.classList.contains("translate-x-0")) {
          hideWindow("pastFlights");
        } else {
          showWindow("pastFlights");
        }
      });

      aircraftIconBtn.addEventListener("click", () => {
        if (aircraftWindow.classList.contains("translate-x-0")) {
          hideWindow("aircraft");
        } else {
          showWindow("aircraft");
        }
      });

      bookFlightIconBtn.addEventListener("click", () => {
        if (bookFlightWindow.classList.contains("translate-x-0")) {
          hideWindow("bookFlight");
        } else {
          showWindow("bookFlight");
        }
      });

      weatherIconBtn.addEventListener("click", () => {
        if (weatherWindow.classList.contains("translate-x-0")) {
          hideWindow("weather");
        } else {
          showWindow("weather");
        }
      });

      // Event listeners for close buttons
      closePastFlightsBtn.addEventListener("click", () =>
        hideWindow("pastFlights")
      );
      closeAircraftBtn.addEventListener("click", () => hideWindow("aircraft"));
      closeBookFlightBtn.addEventListener("click", () =>
        hideWindow("bookFlight")
      );
      closeWeatherBtn.addEventListener("click", () => hideWindow("weather"));

      // Mousemove event listener to show/hide icons
      document.addEventListener("mousemove", (e) => {
        const screenWidth = window.innerWidth;
        const threshold = 50; // pixels from the right edge
        if (e.clientX > screenWidth - threshold) {
          iconContainer.classList.remove("translate-x-full");
          rightSideContainer.classList.add("translate-x-[-6rem]");
        } else {
          iconContainer.classList.add("translate-x-full");
          rightSideContainer.classList.remove("translate-x-[-6rem]");
        }
      });

      // Event listener for filter checkboxes
      flightFilterCheckboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const selectedFilters = Array.from(
            document.querySelectorAll('input[name="flightFilter"]:checked')
          ).map((cb) => cb.value);
          showPastFlights(selectedFilters);
        });
      });

      // --- Simulated CSV Database for flights ---
      const flightSearchInput = document.getElementById("flightSearchInput");
      const flightScheduleList = document.getElementById("flightScheduleList");

      const flightScheduleData = [
        {
          flightNumber: "BA2490",
          departure: "LHR",
          destination: "JFK",
          date: "2024-12-25",
          price: 750,
        },
        {
          flightNumber: "AA100",
          departure: "JFK",
          destination: "LAX",
          date: "2024-12-26",
          price: 420,
        },
        {
          flightNumber: "LH453",
          departure: "FRA",
          destination: "SIN",
          date: "2024-12-27",
          price: 980,
        },
        {
          flightNumber: "DL567",
          departure: "ATL",
          destination: "MCO",
          date: "2024-12-28",
          price: 210,
        },
        {
          flightNumber: "EK202",
          departure: "DXB",
          destination: "LHR",
          date: "2024-12-29",
          price: 600,
        },
        {
          flightNumber: "BA2491",
          departure: "JFK",
          destination: "LHR",
          date: "2024-12-30",
          price: 800,
        },
        {
          flightNumber: "QR902",
          departure: "DOH",
          destination: "CDG",
          date: "2024-12-31",
          price: 550,
        },
      ];

      function displayFlights(flights) {
        flightScheduleList.innerHTML = "";
        if (flights.length === 0) {
          flightScheduleList.innerHTML =
            '<li class="text-sm text-gray-300 p-2 border border-gray-600 rounded-lg text-center shadow-sm">No flights found.</li>';
          return;
        }

        flights.forEach((flight) => {
          const listItem = document.createElement("li");
          listItem.classList.add(
            "p-2",
            "bg-gray-700",
            "text-gray-100",
            "border",
            "border-gray-600",
            "rounded-lg",
            "shadow-sm"
          );
          listItem.innerHTML = `
                    <div class="flex items-center justify-between">
                        <div>
                            <span class="font-bold text-sky-300">${flight.flightNumber}</span>
                            <span class="text-sm text-gray-400">(${flight.departure} &rarr; ${flight.destination})</span>
                        </div>
                        <span class="font-bold text-lg text-green-400">$${flight.price}</span>
                    </div>
                    <div class="text-xs text-gray-400 mt-1">Date: ${flight.date}</div>
                `;
          flightScheduleList.appendChild(listItem);
        });
      }

      flightSearchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filteredFlights = flightScheduleData.filter(
          (flight) =>
            flight.flightNumber.toLowerCase().includes(query) ||
            flight.departure.toLowerCase().includes(query) ||
            flight.destination.toLowerCase().includes(query)
        );
        displayFlights(filteredFlights);
      });

      // Event listener for the refresh button
      showPastFlightsBtn.addEventListener("click", () => {
        const selectedFilters = Array.from(
          document.querySelectorAll('input[name="flightFilter"]:checked')
        ).map((cb) => cb.value);
        showPastFlights(selectedFilters);
      });

      // --- Weather Functionality ---
      const icaoInput = document.getElementById("icaoInput");
      const getWeatherBtn = document.getElementById("getWeatherBtn");
      const weatherDisplay = document.getElementById("weatherDisplay");

      getWeatherBtn.addEventListener("click", () => {
        const icao = icaoInput.value.toUpperCase().trim();
        if (icao.length !== 4) {
          weatherDisplay.innerHTML = `<div class="text-center text-red-400">Please enter a valid 4-letter ICAO code.</div>`;
          return;
        }
        fetchWeather(icao);
      });

      async function fetchWeather(icao) {
        weatherDisplay.innerHTML = `<div class="text-center text-gray-400">Fetching weather for ${icao}...</div>`;
        const proxyUrl = "https://cors-anywhere.herokuapp.com/";
        const metarUrl = `https://aviationweather.gov/api/data/dataserver?requestType=retrieve&dataSource=metars&stationString=${icao}&format=xml&hoursBeforeNow=1`;

        try {
          const response = await fetch(proxyUrl + metarUrl);
          const text = await response.text();
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(text, "text/xml");
          const metarEl = xmlDoc.querySelector("METAR");

          if (!metarEl) {
            weatherDisplay.innerHTML = `<div class="text-center text-yellow-400">No METAR data found for ${icao}.</div>`;
            return;
          }

          const stationId =
            metarEl.querySelector("station_id")?.textContent || "N/A";
          const observationTime =
            metarEl.querySelector("observation_time")?.textContent || "N/A";
          const windDir =
            metarEl.querySelector("wind_dir_degrees")?.textContent || "N/A";
          const windSpeed =
            metarEl.querySelector("wind_speed_kt")?.textContent || "N/A";
          const visibility =
            metarEl.querySelector("visibility_sm")?.textContent || "N/A";
          const tempC = metarEl.querySelector("temp_c")?.textContent || "N/A";
          const dewpointC =
            metarEl.querySelector("dewpoint_c")?.textContent || "N/A";
          const skyCondition =
            metarEl.querySelector("sky_condition")?.getAttribute("sky_cover") ||
            "N/A";
          const rawText =
            metarEl.querySelector("raw_text")?.textContent || "N/A";

          weatherDisplay.innerHTML = `
                    <h3 class="text-lg font-bold text-sky-400">${stationId} - Weather Report</h3>
                    <p><span class="font-semibold text-gray-300">Observation Time:</span> ${observationTime}</p>
                    <p><span class="font-semibold text-gray-300">Temperature:</span> ${tempC}°C</p>
                    <p><span class="font-semibold text-gray-300">Dewpoint:</span> ${dewpointC}°C</p>
                    <p><span class="font-semibold text-gray-300">Winds:</span> ${windDir}° at ${windSpeed} knots</p>
                    <p><span class="font-semibold text-gray-300">Visibility:</span> ${visibility} statute miles</p>
                    <p><span class="font-semibold text-gray-300">Sky Conditions:</span> ${skyCondition}</p>
                    <hr class="my-2 border-gray-700">
                    <p class="font-mono text-xs text-gray-400 break-all">Raw METAR: ${rawText}</p>
                `;
        } catch (error) {
          console.error("Failed to fetch weather data:", error);
          weatherDisplay.innerHTML = `<div class="text-center text-red-400">Failed to fetch weather data. Please try again.</div>`;
        }
      }

      // Initial load
      window.onload = () => {
        const selectedFilters = Array.from(
          document.querySelectorAll('input[name="flightFilter"]:checked')
        ).map((cb) => cb.value);
        showPastFlights(selectedFilters);
      };
    </script>
    </div>

    <!-- Realtime WebSocket client to receive simulator updates -->
    <script>
      (function () {
        const statusEl = document.getElementById('statusMessage');
        function setStatus(text) {
          if (statusEl) statusEl.textContent = text;
        }

        const WS_URL = 'ws://localhost:8765';
        let ws;
        try {
          ws = new WebSocket(WS_URL);
        } catch (e) {
          console.error('WebSocket init error', e);
          setStatus('WebSocket init error');
          return;
        }

        ws.addEventListener('open', () => {
          console.log('Connected to SimConnect WebSocket');
          setStatus('Connected to simulator');
        });

        ws.addEventListener('close', () => {
          console.log('WebSocket closed');
          setStatus('Disconnected from simulator');
        });

        ws.addEventListener('error', (e) => {
          console.error('WebSocket error', e);
          setStatus('WebSocket error');
        });

        ws.addEventListener('message', (evt) => {
          try {
            const data = JSON.parse(evt.data);
            // Update small UI fields if they exist
            const reg = document.getElementById('regDisplay');
            const alt = document.getElementById('altDisplay');
            const spd = document.getElementById('speedDisplay');
            if (reg && data.registration !== undefined) {
              reg.innerHTML = '<span class="font-semibold">Registration:</span> ' + data.registration;
            }
            if (alt && data.altitude !== undefined) {
              alt.innerHTML = '<span class="font-semibold">Altitude:</span> ' + Number(data.altitude).toFixed(2);
            }
            if (spd && data.speed !== undefined) {
              spd.innerHTML = '<span class="font-semibold">Speed:</span> ' + Number(data.speed).toFixed(2) + ' knots';
            }

            // Update status line with lat/lon when available
            if (data.latitude !== undefined && data.longitude !== undefined) {
              setStatus(`Lat ${Number(data.latitude).toFixed(5)} Lon ${Number(data.longitude).toFixed(5)}`);
              // If map code exposes updateAircraftPosition, call it
              if (window.updateAircraftPosition && typeof window.updateAircraftPosition === 'function') {
                window.updateAircraftPosition([data.longitude, data.latitude]);
              }
            }
          } catch (err) {
            console.error('Malformed WS message', err, evt.data);
          }
        });
      })();
    </script>

  </body>
</html>
