// Admin Dashboard Logic

const STATUSES = [
    "Pending", "Shipment Created", "Package Received", "Processing", "Packed",
    "On Hold", "In Transit", "Customs Clearance", "Arrived at Facility",
    "Departed Facility", "Out for Delivery", "Delivery Attempt Failed", "Delivered",
    "Delayed", "Returned to Sender", "Cancelled", "Awaiting Pickup", "Security Inspection",
    "Air Transit", "Sea Transit", "Warehouse Scan", "Distribution Center", "Updated Route",
    "Shipment Exception", "Destination Arrival", "Local Dispatch", "Loading Cargo",
    "Unloading Cargo", "Transit Pause", "Re-routed", "Awaiting Documents",
    "Insurance Verification", "Final Delivery Stage"
];

// Global cached shipments list
let currentAdminShipments = [];

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Basic Auth Check
    const token = sessionStorage.getItem('aqua_admin_token');
    if (!token) {
        window.location.href = 'admin-login.html';
        return;
    }

    populateDropdowns();
    generateTrackingCode();
    loadShipments();
    // Start chat widget (app.js is loaded before admin.js)
    if (typeof initChatWidget === 'function') initChatWidget();
});

function logout() {
    sessionStorage.removeItem('aqua_admin_token');
    window.location.href = 'admin-login.html';
}

// UI Helpers
function populateDropdowns() {
    // Populate Countries
    const countrySelects = document.querySelectorAll('.country-select');
    let countryOptions = '<option value="">Select Country</option>';
    COUNTRIES.forEach(c => {
        countryOptions += `<option value="${c}">${c}</option>`;
    });
    countrySelects.forEach(sel => sel.innerHTML = countryOptions);

    // Populate Statuses
    let statusOptions = '<option value="">Select Status</option>';
    STATUSES.forEach(s => {
        statusOptions += `<option value="${s}">${s}</option>`;
    });

    const createStatusEl = document.getElementById('create-status');
    const updateStatusEl = document.getElementById('update-status');
    const editStatusEl = document.getElementById('edit-status');
    const editHistoryStatusEl = document.getElementById('edit-history-status');

    if (createStatusEl) createStatusEl.innerHTML = statusOptions;
    if (updateStatusEl) updateStatusEl.innerHTML = statusOptions;
    if (editStatusEl) editStatusEl.innerHTML = statusOptions;
    if (editHistoryStatusEl) editHistoryStatusEl.innerHTML = statusOptions;
}

function generateTrackingCode() {
    const prefix = "AC-";
    const random = Math.floor(10000000 + Math.random() * 90000000); // 8 digit random
    const code = prefix + random;
    const el = document.getElementById('create-tracking');
    if(el) el.value = code;
    return code;
}

function openModal(id) {
    const modal = document.getElementById(id);
    if(modal) {
        modal.classList.add('active');
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if(modal) {
        modal.classList.remove('active');
        const form = modal.querySelector('form');
        if(form && id !== 'create-shipment-modal' && id !== 'edit-shipment-modal') form.reset();
    }
}

// Data Fetching and Rendering
async function loadShipments() {
    const tableBody = document.getElementById('shipments-table-body');
    try {
        let shipments = [];
        if (window.db && window.db.getAllShipments) {
            shipments = await window.db.getAllShipments();
        }
        currentAdminShipments = shipments;

        updateStats(shipments);
        renderTable(shipments);

    } catch (e) {
        console.error("Error loading shipments", e);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: #ff4d4d;">Failed to load shipments records.</td></tr>`;
    }
}

function updateStats(shipments) {
    document.getElementById('stat-total').innerText = shipments.length;
    let transit = 0, delivered = 0;
    shipments.forEach(s => {
        if(s.status.toLowerCase() === 'delivered') delivered++;
        else if(s.status.toLowerCase() !== 'pending' && s.status.toLowerCase() !== 'cancelled') transit++;
    });
    document.getElementById('stat-transit').innerText = transit;
    document.getElementById('stat-delivered').innerText = delivered;
}

function renderTable(shipments) {
    const tableBody = document.getElementById('shipments-table-body');
    if (shipments.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No shipments found. Create one above.</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';
    shipments.forEach(s => {
        let statusClass = 'status-transit';
        if (s.status.toLowerCase() === 'delivered') statusClass = 'status-delivered';
        if (s.status.toLowerCase() === 'pending') statusClass = 'status-pending';

        // Pause/Resume button logic for updated route
        let togglePauseBtn = '';
        if (s.automated_routes && s.automated_routes.length > 0) {
            if (s.is_routing_paused) {
                togglePauseBtn = `<button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem; border-color: #03e8a4; color: #03e8a4;" onclick="toggleRoutingPause('${s.id}', false)">▶ Resume Route</button>`;
            } else {
                togglePauseBtn = `<button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem; border-color: #f7a00f; color: #f7a00f;" onclick="toggleRoutingPause('${s.id}', true)">⏸ Pause Route</button>`;
            }
        }

        const row = `
            <tr>
                <td><strong>${s.tracking_number}</strong></td>
                <td><span class="status-badge ${statusClass}">${s.status}</span></td>
                <td>${s.origin_country || '-'}</td>
                <td>${s.destination_country || '-'}</td>
                <td>${new Date(s.created_at).toLocaleDateString()}</td>
                <td style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                    ${togglePauseBtn}
                    <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem; border-color: var(--primary-color); color: var(--primary-color);" onclick="openUpdateModal('${s.id}', '${s.tracking_number}', '${s.status}')">✏️ Status & Updates</button>
                    <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem;" onclick="openEditShipmentModal('${s.id}')">⚙️ Edit</button>
                    <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem; border-color: #ff4d4d; color: #ff4d4d;" onclick="handleDelete('${s.id}')">Delete</button>
                </td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

// Route Builder Logic (Create Form)
let routeCount = 0;
function addRouteInput() {
    routeCount++;
    const container = document.getElementById('route-inputs-container');
    const id = 'route-input-' + routeCount;
    const html = `
        <div id="${id}" style="display: flex; gap: 10px; align-items: center;">
            <div style="background: rgba(255,255,255,0.1); width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold;">${routeCount}</div>
            <input type="text" class="form-control route-stop-input" placeholder="e.g. Port of Loading" style="margin-bottom: 0; flex: 1;">
            <button type="button" class="btn btn-secondary" onclick="removeRouteInput('${id}')" style="padding: 5px 10px; color: #ff4d4d; border-color: #ff4d4d;">X</button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
}

function removeRouteInput(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    // Re-number
    const routeInputs = document.querySelectorAll('#route-inputs-container > div');
    routeCount = 0;
    routeInputs.forEach(div => {
        routeCount++;
        div.id = 'route-input-' + routeCount;
        div.querySelector('div').innerText = routeCount;
        div.querySelector('button').setAttribute('onclick', `removeRouteInput('${div.id}')`);
    });
}

// Route Builder Logic (Edit Form)
let editRouteCount = 0;
function addEditRouteInput(val = '') {
    editRouteCount++;
    const container = document.getElementById('edit-route-inputs-container');
    const id = 'edit-route-input-' + editRouteCount;
    const html = `
        <div id="${id}" style="display: flex; gap: 10px; align-items: center;">
            <div style="background: rgba(255,255,255,0.1); width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold;">${editRouteCount}</div>
            <input type="text" class="form-control edit-route-stop-input" value="${val}" placeholder="e.g. Port of Loading" style="margin-bottom: 0; flex: 1;">
            <button type="button" class="btn btn-secondary" onclick="removeEditRouteInput('${id}')" style="padding: 5px 10px; color: #ff4d4d; border-color: #ff4d4d;">X</button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
}

function removeEditRouteInput(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
    const routeInputs = document.querySelectorAll('#edit-route-inputs-container > div');
    editRouteCount = 0;
    routeInputs.forEach(div => {
        editRouteCount++;
        div.id = 'edit-route-input-' + editRouteCount;
        div.querySelector('div').innerText = editRouteCount;
        div.querySelector('button').setAttribute('onclick', `removeEditRouteInput('${div.id}')`);
    });
}

// Creating Shipment
async function submitCreateShipment() {
    const tracking = document.getElementById('create-tracking').value;
    const status = document.getElementById('create-status').value;
    if (!tracking || !status) return alert('Tracking number and initial status are required.');

    const data = {
        tracking_number: tracking,
        status: status,
        origin_country: document.getElementById('create-origin').value,
        destination_country: document.getElementById('create-destination').value,
        sender_details: document.getElementById('create-sender').value,
        receiver_details: document.getElementById('create-receiver').value,
        weight_kg: parseFloat(document.getElementById('create-weight').value) || null,
        dimensions: document.getElementById('create-dimensions').value,
        estimated_delivery_date: document.getElementById('create-est-date').value || null,
        package_details: document.getElementById('create-package-details').value,
        customer_name: document.getElementById('create-customer').value,
        receiver_name: document.getElementById('create-receiver-name').value,
        receiver_email: document.getElementById('create-receiver-email').value,
        container_number: document.getElementById('create-container').value,
        seal_number: document.getElementById('create-seal').value,
        vessel_name: document.getElementById('create-vessel').value,
        freight_charges: parseFloat(document.getElementById('create-freight').value) || 0,
        payment_terms: document.getElementById('create-payment-terms').value,
        progress_percentage: status === 'Delivered' ? 100 : (status === 'Shipment Created' ? 5 : 10),
        
        // Updated Route Fields
        automated_routes: Array.from(document.querySelectorAll('.route-stop-input')).map(el => el.value.trim()).filter(v => v !== ''),
        current_route_index: 0,
        is_routing_paused: false,
        next_automated_update: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48 hours from now
    };

    try {
        const res = await window.db.createShipment(data);
        if (!res) {
            alert("Database Error: Could not save shipment. Please check your connection.");
            return;
        }

        alert("Shipment " + tracking + " created successfully!");

        // Add initial history with updated status description
        await window.db.addShipmentHistory({
            shipment_id: res.id,
            location: data.origin_country || "Dispatch Center",
            status: "Shipment Created",
            description: "Electronic shipping details received and processed. Your package is on hold."
        });

        closeModal('create-shipment-modal');
        generateTrackingCode(); // prep new
        document.getElementById('create-form').reset();
        document.getElementById('route-inputs-container').innerHTML = '';
        routeCount = 0;
        await loadShipments();

    } catch (e) {
        alert('Failed to save: ' + (e.message || e) + '\nCheck console for more details.');
        console.error("Save Shipment Error:", e);
    }
}

// Updating & Managing History Updates
async function openUpdateModal(id, trackingNo, currentStatus) {
    document.getElementById('update-shipment-id').value = id;
    document.getElementById('update-tracking-display').innerText = trackingNo;
    document.getElementById('update-current-status-display').innerText = currentStatus;
    document.getElementById('update-status').value = currentStatus;
    document.getElementById('update-location').value = '';
    document.getElementById('update-desc').value = 'Your package is on hold';
    
    // Auto suggest progress
    let p = 50;
    if(currentStatus.toLowerCase() === 'delivered') p = 100;
    document.getElementById('update-progress').value = p;

    openModal('update-history-modal');
    await loadModalHistoryList(id);
}

// Load and render history updates into the update modal (editable!)
async function loadModalHistoryList(shipmentId) {
    const listContainer = document.getElementById('modal-history-list');
    const countBadge = document.getElementById('history-count-badge');
    listContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Loading status history...</p>';

    try {
        let history = [];
        if (window.db && window.db.getShipmentHistory) {
            history = await window.db.getShipmentHistory(shipmentId);
        }

        countBadge.innerText = `${history.length} update${history.length === 1 ? '' : 's'}`;

        if (history.length === 0) {
            listContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No status updates recorded yet.</p>';
            return;
        }

        listContainer.innerHTML = '';
        history.forEach(item => {
            const dateStr = item.update_date ? new Date(item.update_date).toLocaleString() : 'No date';
            const desc = item.description || 'Your package is on hold';
            
            const itemHtml = `
                <div class="history-item-card" id="history-item-${item.id}">
                    <div class="history-item-details">
                        <div class="history-item-header">
                            <span class="status-badge status-transit" style="font-size: 0.75rem; padding: 3px 8px;">${item.status}</span>
                            <span style="font-size: 0.85rem; font-weight: 600;">📍 ${item.location}</span>
                            <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">🕒 ${dateStr}</span>
                        </div>
                        <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted);">${desc}</p>
                    </div>
                    <div class="history-item-actions">
                        <button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick='openEditHistoryModal(${JSON.stringify(item).replace(/'/g, "&#39;")})'>✏️ Edit</button>
                        <button type="button" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem; border-color: #ff4d4d; color: #ff4d4d;" onclick="handleDeleteHistoryItem('${item.id}', '${shipmentId}')">🗑️</button>
                    </div>
                </div>
            `;
            listContainer.insertAdjacentHTML('beforeend', itemHtml);
        });
    } catch (err) {
        console.error("Error loading modal history:", err);
        listContainer.innerHTML = '<p style="color: #ff4d4d; font-size: 0.85rem;">Failed to load update history.</p>';
    }
}

async function submitUpdateHistory() {
    const shipmentId = document.getElementById('update-shipment-id').value;
    const newStatus = document.getElementById('update-status').value;
    const loc = document.getElementById('update-location').value;
    const details = document.getElementById('update-desc').value.trim() || 'Your package is on hold';
    const progress = document.getElementById('update-progress').value;

    if (!newStatus || !loc) return alert('Status and Location are required.');

    try {
        await window.db.updateShipment(shipmentId, { 
            status: newStatus, 
            progress_percentage: parseInt(progress) || 0 
        });
        
        await window.db.addShipmentHistory({
            shipment_id: shipmentId,
            location: loc,
            status: newStatus,
            description: details
        });

        // Update UI
        document.getElementById('update-current-status-display').innerText = newStatus;
        document.getElementById('update-location').value = '';
        document.getElementById('update-desc').value = 'Your package is on hold';
        
        await loadModalHistoryList(shipmentId);
        await loadShipments();
        alert("Status update saved successfully!");

    } catch (e) {
        alert('Failed to add update. Check console.');
        console.error(e);
    }
}

// Edit Individual History Record
function openEditHistoryModal(item) {
    document.getElementById('edit-history-id').value = item.id;
    document.getElementById('edit-history-status').value = item.status || 'On Hold';
    document.getElementById('edit-history-location').value = item.location || '';
    document.getElementById('edit-history-desc').value = item.description || 'Your package is on hold';
    
    if (item.update_date) {
        const d = new Date(item.update_date);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        document.getElementById('edit-history-date').value = d.toISOString().slice(0, 16);
    } else {
        document.getElementById('edit-history-date').value = new Date().toISOString().slice(0, 16);
    }

    openModal('edit-history-item-modal');
}

async function submitEditHistoryItem() {
    const historyId = document.getElementById('edit-history-id').value;
    const shipmentId = document.getElementById('update-shipment-id').value;
    const status = document.getElementById('edit-history-status').value;
    const location = document.getElementById('edit-history-location').value;
    const desc = document.getElementById('edit-history-desc').value.trim() || 'Your package is on hold';
    const dateVal = document.getElementById('edit-history-date').value;

    if (!status || !location) return alert('Status and Location are required.');

    try {
        const updateData = {
            status: status,
            location: location,
            description: desc,
            update_date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString()
        };

        await window.db.updateShipmentHistory(historyId, updateData);
        closeModal('edit-history-item-modal');
        await loadModalHistoryList(shipmentId);
        await loadShipments();
        alert("History update record saved!");
    } catch (err) {
        console.error("Error editing history item:", err);
        alert("Failed to save history update record.");
    }
}

async function handleDeleteHistoryItem(historyId, shipmentId) {
    if (confirm("Are you sure you want to delete this status update record?")) {
        try {
            await window.db.deleteShipmentHistory(historyId);
            await loadModalHistoryList(shipmentId);
            await loadShipments();
        } catch (err) {
            console.error("Error deleting history record:", err);
            alert("Failed to delete history record.");
        }
    }
}

// Edit Full Shipment
function openEditShipmentModal(id) {
    const s = currentAdminShipments.find(x => x.id === id);
    if (!s) return alert("Shipment details not found.");

    document.getElementById('edit-shipment-id').value = s.id;
    document.getElementById('edit-tracking').value = s.tracking_number;
    document.getElementById('edit-status').value = s.status;
    document.getElementById('edit-origin').value = s.origin_country || '';
    document.getElementById('edit-destination').value = s.destination_country || '';
    document.getElementById('edit-sender').value = s.sender_details || '';
    document.getElementById('edit-receiver').value = s.receiver_details || '';
    document.getElementById('edit-weight').value = s.weight_kg || '';
    document.getElementById('edit-dimensions').value = s.dimensions || '';
    document.getElementById('edit-est-date').value = s.estimated_delivery_date || '';
    document.getElementById('edit-progress').value = s.progress_percentage || 0;
    document.getElementById('edit-customer').value = s.customer_name || '';
    document.getElementById('edit-receiver-name').value = s.receiver_name || '';
    document.getElementById('edit-receiver-email').value = s.receiver_email || '';
    document.getElementById('edit-container').value = s.container_number || '';
    document.getElementById('edit-seal').value = s.seal_number || '';
    document.getElementById('edit-vessel').value = s.vessel_name || '';
    document.getElementById('edit-freight').value = s.freight_charges || '';
    document.getElementById('edit-payment-terms').value = s.payment_terms || 'PREPAID';
    document.getElementById('edit-package-details').value = s.package_details || '';

    // Populate Updated Route Stops
    const container = document.getElementById('edit-route-inputs-container');
    container.innerHTML = '';
    editRouteCount = 0;
    if (s.automated_routes && Array.isArray(s.automated_routes)) {
        s.automated_routes.forEach(route => {
            addEditRouteInput(route);
        });
    }

    openModal('edit-shipment-modal');
}

async function submitEditShipment() {
    const shipmentId = document.getElementById('edit-shipment-id').value;
    const status = document.getElementById('edit-status').value;
    if (!status) return alert('Status is required.');

    const updateData = {
        status: status,
        origin_country: document.getElementById('edit-origin').value,
        destination_country: document.getElementById('edit-destination').value,
        sender_details: document.getElementById('edit-sender').value,
        receiver_details: document.getElementById('edit-receiver').value,
        weight_kg: parseFloat(document.getElementById('edit-weight').value) || null,
        dimensions: document.getElementById('edit-dimensions').value,
        estimated_delivery_date: document.getElementById('edit-est-date').value || null,
        progress_percentage: parseInt(document.getElementById('edit-progress').value) || 0,
        package_details: document.getElementById('edit-package-details').value,
        customer_name: document.getElementById('edit-customer').value,
        receiver_name: document.getElementById('edit-receiver-name').value,
        receiver_email: document.getElementById('edit-receiver-email').value,
        container_number: document.getElementById('edit-container').value,
        seal_number: document.getElementById('edit-seal').value,
        vessel_name: document.getElementById('edit-vessel').value,
        freight_charges: parseFloat(document.getElementById('edit-freight').value) || 0,
        payment_terms: document.getElementById('edit-payment-terms').value,
        automated_routes: Array.from(document.querySelectorAll('.edit-route-stop-input')).map(el => el.value.trim()).filter(v => v !== '')
    };

    try {
        await window.db.updateShipment(shipmentId, updateData);
        closeModal('edit-shipment-modal');
        await loadShipments();
        alert("Shipment details updated successfully!");
    } catch (e) {
        alert('Failed to update shipment: ' + (e.message || e));
        console.error("Edit Shipment Error:", e);
    }
}

// Deleting
async function handleDelete(id) {
    if (confirm("Are you sure you want to delete this shipment?")) {
        try {
            await window.db.deleteShipment(id);
            await loadShipments();
        } catch (e) {
            console.error("Delete Error:", e);
            alert("Could not delete. Check console.");
        }
    }
}

// Toggle Pause/Resume Updated Route
async function toggleRoutingPause(id, pauseState) {
    try {
        const updateData = { is_routing_paused: pauseState };
        if (!pauseState) {
            // When resuming, reset the timer to 48 hours from NOW so it doesn't immediately skip if it was paused a long time
            updateData.next_automated_update = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        }
        await window.db.updateShipment(id, updateData);
        await loadShipments();
    } catch (e) {
        console.error("Toggle Pause Error:", e);
        alert("Failed to toggle routing state.");
    }
}
