// intermap-display.js
const routeCache = new Map();
const activeLayers = new Map();
let activeRoutes = new Map();

// Configuration defaults
const config = {
  localRouteBasePath: 'route-data/geojson',
  routesDataUrl: 'route-data/routes.json',
  overpassEndpoint: 'https://overpass-api.de/api/interpreter',
  ...(window.routeConfig || {}) // Merge with user-provided config
};

// route-map.js functions
function fetchLocalRoute(relationId, displayType, routeColor) {
    return new Promise((resolve, reject) => {
        const layerGroup = L.layerGroup();
        const basePath = `${config.localRouteBasePath}/${relationId}`;

        Promise.all([
            fetch(`${basePath}/ways.geojson`),
            fetch(`${basePath}/${displayType === "ways_with_points" ? "stops" : "endstops"}.geojson`)
        ]).then(async ([waysResponse, stopsResponse]) => {
            if (!waysResponse.ok || !stopsResponse.ok) throw new Error('Local files not found');
            
            const [waysData, stopsData] = await Promise.all([
                waysResponse.json(),
                stopsResponse.json()
            ]);

            waysData.features.forEach(feature => {
                if (feature.geometry.type === "LineString") {
                    L.polyline(feature.geometry.coordinates.map(coord => [coord[1], coord[0]]), {
                        color: routeColor,
                        weight: 4
                    }).addTo(layerGroup);
                }
            });

            stopsData.features.forEach(feature => {
                if (feature.geometry.type === "Point") {
                    const coords = feature.geometry.coordinates;
                    L.circleMarker([coords[1], coords[0]], {
                        radius: 5,
                        color: routeColor,
                        fillColor: "#ffffff",
                        fillOpacity: 1
                    }).bindPopup(feature.properties?.name || "Unnamed Stop")
                     .addTo(layerGroup);
                }
            });

            resolve(layerGroup);
        }).catch(reject);
    });
}

function fetchOverpassRoute(relationId, displayType, routeColor) {
    return new Promise((resolve, reject) => {
        const layerGroup = L.layerGroup();
        const stopQuery = displayType === "ways_with_points" ? 
            `node(r:"stop"),node(r:"stop_entry_only"),node(r:"stop_exit_only")` : 
            `node(r:"stop_entry_only"),node(r:"stop_exit_only")`;

        const query = `[out:json];
            relation(${relationId});
            way(r);>;out geom;
            ${stopQuery};out geom;`;

        fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                data.elements.forEach(element => {
                    if (element.type === "way" && element.geometry) {
                        L.polyline(element.geometry.map(p => [p.lat, p.lon]), {
                            color: routeColor,
                            weight: 4
                        }).addTo(layerGroup);
                    }
                    else if (element.type === "node") {
                        L.circleMarker([element.lat, element.lon], {
                            radius: 5,
                            color: routeColor,
                            fillColor: "#ffffff",
                            fillOpacity: 1
                        }).bindPopup(element.tags?.name || "Unnamed Stop")
                          .addTo(layerGroup);
                    }
                });
                resolve(layerGroup);
            }).catch(reject);
    });
}

// Modified route-loader.js functions
async function initializeRoutes() {
  try {
    const container = document.getElementById('route-container');
    const response = await fetch(config.routesDataUrl);
    const { routes } = await response.json(); // Changed to read routes directly

    const fragment = document.createDocumentFragment();

    // Create a single container for all routes
    const routesHTML = `
      <div class="accordion mb-3" id="routes-accordion">
        <div class="accordion-item">
          <div class="accordion-header" id="heading-all">
            <button class="accordion-button" type="button" data-bs-toggle="collapse" 
                    data-bs-target="#collapse-all" aria-expanded="true" 
                    aria-controls="collapse-all">
              All Routes
            </button>
          </div>
          <div id="collapse-all" class="accordion-collapse collapse show" 
               aria-labelledby="heading-all" data-bs-parent="#routes-accordion">
            <div class="accordion-body">
              <div class="form-check mb-3" style="margin-bottom: 1.5rem !important;">
                <input class="form-check-input master-checkbox" 
                       type="checkbox" 
                       id="master-all">
                <label class="form-check-label fw-bold" for="master-all">
                   Pilih semua rute
                </label>
              </div>
              ${routes.map((route, index) => `
                <div class="form-check mb-2" style="margin-bottom: 1.0rem !important;">
                  <input class="form-check-input route-checkbox" 
                         type="checkbox"
                         id="route-${index}"
                         data-relation-id="${route.relationId}"
                         data-display-type="${route.type}"
                         data-route-color="${route.color}">
                  <label class="form-check-label" for="route-${index}">
                    ${route.name}
                  </label>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = routesHTML;
    fragment.appendChild(tempDiv.firstElementChild);

    container.appendChild(fragment);
    setupEventDelegation();
  } catch (error) {
    console.error('Error initializing routes:', error);
  }
}

// Modified event delegation
function setupEventDelegation() {
  const container = document.getElementById('route-container');

  const updateMasterCheckbox = () => {
    const checkboxes = container.querySelectorAll('.route-checkbox');
    const master = container.querySelector('.master-checkbox');
    const checkedCount = [...checkboxes].filter(c => c.checked).length;
    master.checked = checkedCount === checkboxes.length;
    master.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  };

  const handleMasterChange = async (masterCheckbox) => {
    const checkboxes = container.querySelectorAll('.route-checkbox');
    masterCheckbox.disabled = true;
    const isChecked = masterCheckbox.checked;

    // Process checkboxes sequentially
    for (const checkbox of checkboxes) {
      if (checkbox.checked !== isChecked) {
        checkbox.checked = isChecked;
        const { relationId, displayType, routeColor } = checkbox.dataset;
        
        try {
          checkbox.disabled = true;
          if (isChecked) {
            await loadRoute(relationId, displayType, routeColor);
          } else {
            unloadRoute(relationId);
          }
        } catch (error) {
          console.error(`Route operation failed for ${relationId}:`, error);
          checkbox.checked = false;
        } finally {
          checkbox.disabled = false;
        }
      }
    }

    masterCheckbox.disabled = false;
    updateMasterCheckbox();
  };

  container.addEventListener('change', async (e) => {
    const checkbox = e.target;
    
    if (checkbox.classList.contains('master-checkbox')) {
      await handleMasterChange(checkbox);
      return;
    }

    if (checkbox.classList.contains('route-checkbox')) {
      const { relationId, displayType, routeColor } = checkbox.dataset;
      
      try {
        checkbox.disabled = true;
        if (checkbox.checked) {
          await loadRoute(relationId, displayType, routeColor);
        } else {
          unloadRoute(relationId);
        }
      } catch (error) {
        console.error(`Route operation failed for ${relationId}:`, error);
        checkbox.checked = false;
      } finally {
        checkbox.disabled = false;
        updateMasterCheckbox();
      }
    }
  });
}

async function loadRoute(relationId, displayType, routeColor) {
  if (activeLayers.has(relationId)) {
    map.addLayer(activeLayers.get(relationId));
    return;
  }

  try {
    const layerGroup = routeCache.has(relationId) 
      ? routeCache.get(relationId)
      : await fetchRouteData(relationId, displayType, routeColor);

    layerGroup.addTo(map);
    activeLayers.set(relationId, layerGroup);
    routeCache.set(relationId, layerGroup);
  } catch (error) {
    throw new Error(`Failed loading route ${relationId}: ${error.message}`);
  }
}

async function fetchRouteData(relationId, displayType, routeColor) {
  try {
    return await fetchLocalRoute(relationId, displayType, routeColor);
  } catch (localError) {
    console.warn(`Local data missing for ${relationId}:`, localError);
    try {
      return await fetchOverpassRoute(relationId, displayType, routeColor);
    } catch (overpassError) {
      throw new Error(`Both local and Overpass sources failed for ${relationId}`);
    }
  }
}

function unloadRoute(relationId) {
  const layer = activeLayers.get(relationId);
  if (layer && map.hasLayer(layer)) {
    map.removeLayer(layer);
  }
  activeLayers.delete(relationId);
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof map !== 'undefined') initializeRoutes();
});
