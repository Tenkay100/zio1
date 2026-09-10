// Aqua Cargo - Firebase Integration

const firebaseConfig = {
  apiKey: "AIzaSyBBgunb5Ys3DJCP5x8BLPwGI9hh9gdjPd0",
  authDomain: "zio1111.firebaseapp.com",
  projectId: "zio1111",
  storageBucket: "zio1111.firebasestorage.app",
  messagingSenderId: "832416594833",
  appId: "1:832416594833:web:1a8350120e117950483830"
};

// Initialize Firebase if not already initialized
if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
} else {
    console.error("Firebase SDK not loaded. Please ensure Firebase CDNs are included in the HTML.");
}

const firestoreDb = typeof firebase !== 'undefined' ? firebase.firestore() : null;

// ----------------------
// Local Storage Fallback
// ----------------------
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getLocalShipments() {
    try {
        const s = localStorage.getItem('aqua_shipments');
        const parsed = s ? JSON.parse(s) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function setLocalShipments(data) {
    localStorage.setItem('aqua_shipments', JSON.stringify(data));
}

function getLocalHistory() {
    try {
        const h = localStorage.getItem('aqua_history');
        const parsed = h ? JSON.parse(h) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function setLocalHistory(data) {
    localStorage.setItem('aqua_history', JSON.stringify(data));
}

function sanitizeStatus(status) {
    if (!status) return "In Transit";
    const lower = status.toLowerCase();
    if (lower === 'automated routing' || lower === 'routing update') {
        return "Updated Route";
    }
    return status;
}

function sanitizeHistoryItem(item) {
    if (!item) return item;
    let modified = false;

    if (item.status) {
        const cleanStatus = sanitizeStatus(item.status);
        if (cleanStatus !== item.status) {
            item.status = cleanStatus;
            modified = true;
        }
    }

    if (item.description) {
        let desc = item.description;
        const originalDesc = desc;

        // Replace automated routing mentions with "Your package is been updated."
        desc = desc.replace(/automated routing update\.?/gi, "Your package is been updated.")
                   .replace(/automated routing/gi, "updated route")
                   .replace(/automated route/gi, "updated route")
                   .replace(/automated/gi, "updated");

        if (desc !== originalDesc) {
            item.description = desc;
            modified = true;
        }
    }

    return { item, modified };
}

function sanitizeShipment(shipment) {
    if (!shipment) return shipment;
    let modified = false;

    if (shipment.status) {
        const cleanStatus = sanitizeStatus(shipment.status);
        if (cleanStatus !== shipment.status) {
            shipment.status = cleanStatus;
            modified = true;
        }
    }

    if (shipment.shipment_history && Array.isArray(shipment.shipment_history)) {
        shipment.shipment_history = shipment.shipment_history.map(h => {
            const res = sanitizeHistoryItem(h);
            if (res.modified) modified = true;
            return res.item;
        });
    }

    return { shipment, modified };
}

// Automatic background migration for existing data
async function runDatabaseMigration() {
    try {
        // 1. Migrate LocalStorage
        let localShipments = getLocalShipments();
        let sModified = false;
        localShipments = localShipments.map(s => {
            const res = sanitizeShipment(s);
            if (res.modified) sModified = true;
            return res.shipment;
        });
        if (sModified) setLocalShipments(localShipments);

        let localHistory = getLocalHistory();
        let hModified = false;
        localHistory = localHistory.map(h => {
            const res = sanitizeHistoryItem(h);
            if (res.modified) hModified = true;
            return res.item;
        });
        if (hModified) setLocalHistory(localHistory);

        // 2. Migrate Firestore if connected
        if (firestoreDb) {
            // Migrate shipments with legacy status
            const shipmentsSnap = await firestoreDb.collection('shipments').get();
            const batch = firestoreDb.batch();
            let batchCount = 0;

            shipmentsSnap.docs.forEach(doc => {
                const data = doc.data();
                const cleanStatus = sanitizeStatus(data.status);
                if (cleanStatus !== data.status) {
                    batch.update(doc.ref, { status: cleanStatus });
                    batchCount++;
                }
            });

            // Migrate history records
            const historySnap = await firestoreDb.collection('shipment_history').get();
            historySnap.docs.forEach(doc => {
                const data = doc.data();
                const res = sanitizeHistoryItem({ ...data });
                if (res.modified) {
                    batch.update(doc.ref, {
                        status: res.item.status,
                        description: res.item.description
                    });
                    batchCount++;
                }
            });

            if (batchCount > 0) {
                await batch.commit();
            }
        }
    } catch (e) {
        console.warn("Migration notice:", e);
    }
}

// Run migration on load
if (typeof window !== 'undefined') {
    runDatabaseMigration();
}

// ----------------------
// Tracker API Methods (Firestore)
// ----------------------

async function processAutomatedRouting(shipmentData) {
    if (!shipmentData.automated_routes || shipmentData.automated_routes.length === 0) return shipmentData;
    if (shipmentData.is_routing_paused) return shipmentData;
    if (!shipmentData.next_automated_update) return shipmentData;
    
    let nextUpdate = new Date(shipmentData.next_automated_update);
    let now = new Date();
    
    if (now >= nextUpdate) {
        let diffMs = now - nextUpdate;
        let intervalsPassed = Math.floor(diffMs / (48 * 60 * 60 * 1000)) + 1; 
        
        let newIndex = shipmentData.current_route_index || 0;
        let historyUpdates = [];
        let routes = shipmentData.automated_routes;
        let finalStatus = shipmentData.status;
        
        for (let i = 0; i < intervalsPassed; i++) {
            if (newIndex < routes.length - 1) {
                newIndex++;
                let status = "Arrived at Facility";
                
                if (newIndex === routes.length - 1) {
                    status = "Delivered";
                }
                
                finalStatus = status;
                
                historyUpdates.push({
                    shipment_id: shipmentData.id,
                    location: routes[newIndex],
                    status: status,
                    description: "Your package is been updated.",
                    update_date: new Date(nextUpdate.getTime() + (i * 48 * 60 * 60 * 1000)).toISOString()
                });
                
                if (newIndex === routes.length - 1) break; 
            } else {
                break;
            }
        }
        
        if (newIndex !== shipmentData.current_route_index) {
            const newNextUpdate = new Date(nextUpdate.getTime() + (intervalsPassed * 48 * 60 * 60 * 1000)).toISOString();
            
            const updatePayload = {
                current_route_index: newIndex,
                next_automated_update: newNextUpdate,
                status: finalStatus,
                progress_percentage: newIndex === routes.length - 1 ? 100 : Math.min(90, (newIndex / routes.length) * 100)
            };
            
            if (typeof firestoreDb !== 'undefined' && firestoreDb) {
                try {
                    await firestoreDb.collection('shipments').doc(shipmentData.id).update(updatePayload);
                    
                    const batch = firestoreDb.batch();
                    const historyRef = firestoreDb.collection('shipment_history');
                    historyUpdates.forEach(hu => {
                        const newDoc = historyRef.doc();
                        batch.set(newDoc, hu);
                        if(!shipmentData.shipment_history) shipmentData.shipment_history = [];
                        shipmentData.shipment_history.push({ id: newDoc.id, ...hu });
                    });
                    await batch.commit();
                    
                    Object.assign(shipmentData, updatePayload);
                } catch(e) {
                    console.error("Failed automated route update", e);
                }
            } else {
                 Object.assign(shipmentData, updatePayload);
                 let localShipments = getLocalShipments();
                 let idx = localShipments.findIndex(x => x.id === shipmentData.id);
                 if(idx !== -1) {
                     localShipments[idx] = shipmentData;
                     setLocalShipments(localShipments);
                 }
                 let localHistory = getLocalHistory();
                 historyUpdates.forEach(hu => {
                     hu.id = uuidv4();
                     localHistory.push(hu);
                     if(!shipmentData.shipment_history) shipmentData.shipment_history = [];
                     shipmentData.shipment_history.push(hu);
                 });
                 setLocalHistory(localHistory);
            }
        }
    }
    
    return shipmentData;
}

async function getShipment(trackingNumber) {
    const localFallback = async () => {
        const s = getLocalShipments().find(x => x.tracking_number === trackingNumber);
        if (s) {
            s.shipment_history = getLocalHistory().filter(h => h.shipment_id === s.id);
            const routed = await processAutomatedRouting(s);
            return sanitizeShipment(routed).shipment;
        }
        return null;
    };

    if (!firestoreDb) return localFallback();

    try {
        const shipmentsRef = firestoreDb.collection('shipments');
        const querySnapshot = await shipmentsRef.where('tracking_number', '==', trackingNumber).get();
        
        if (querySnapshot.empty) {
            return await localFallback();
        }
        
        const doc = querySnapshot.docs[0];
        const shipmentData = { id: doc.id, ...doc.data() };
        
        // Fetch history
        const historyRef = firestoreDb.collection('shipment_history');
        const historySnapshot = await historyRef.where('shipment_id', '==', shipmentData.id).get();
        
        shipmentData.shipment_history = historySnapshot.docs.map(hDoc => ({ id: hDoc.id, ...hDoc.data() }));
        
        const routed = await processAutomatedRouting(shipmentData);
        return sanitizeShipment(routed).shipment;
    } catch (err) {
        console.error("Error fetching shipment from Firebase, using local fallback", err);
        return localFallback();
    }
}

async function getAllShipments() {
    const localFallback = async () => {
        let shipments = getLocalShipments().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        for (let i=0; i<shipments.length; i++) {
            shipments[i] = await processAutomatedRouting(shipments[i]);
            shipments[i] = sanitizeShipment(shipments[i]).shipment;
        }
        return shipments;
    };

    if (!firestoreDb) return localFallback();
    
    try {
        const shipmentsRef = firestoreDb.collection('shipments');
        const querySnapshot = await shipmentsRef.orderBy('created_at', 'desc').get();
        
        let docs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        for (let i=0; i<docs.length; i++) {
            docs[i] = await processAutomatedRouting(docs[i]);
            docs[i] = sanitizeShipment(docs[i]).shipment;
        }
        return docs;
    } catch (err) {
        console.error("Error fetching all shipments from Firebase, using local fallback", err);
        return localFallback();
    }
}

async function createShipment(shipmentData) {
    const fallbackId = uuidv4();
    shipmentData.created_at = shipmentData.created_at || new Date().toISOString();

    const localFallback = () => {
        shipmentData.id = fallbackId;
        const shipments = getLocalShipments();
        shipments.push(shipmentData);
        setLocalShipments(shipments);
        return shipmentData;
    };

    if (!firestoreDb) return localFallback();
    
    try {
        const shipmentsRef = firestoreDb.collection('shipments');
        const docRef = await shipmentsRef.add(shipmentData);
        return { id: docRef.id, ...shipmentData };
    } catch (err) {
        console.error("Error creating shipment in Firebase, using local fallback", err);
        return localFallback();
    }
}

async function updateShipment(shipmentId, updateData) {
    const localFallback = () => {
        const shipments = getLocalShipments();
        const idx = shipments.findIndex(x => x.id === shipmentId);
        if (idx !== -1) {
            shipments[idx] = { ...shipments[idx], ...updateData };
            setLocalShipments(shipments);
            return shipments[idx];
        }
        return null;
    };

    if (!firestoreDb) return localFallback();
    
    try {
        const docRef = firestoreDb.collection('shipments').doc(shipmentId);
        await docRef.update(updateData);
        
        // Fetch the updated document to return it
        const docSnap = await docRef.get();
        return { id: docSnap.id, ...docSnap.data() };
    } catch (err) {
        console.error("Error updating shipment in Firebase, using local fallback", err);
        return localFallback();
    }
}

async function deleteShipment(shipmentId) {
    const localFallback = () => {
        let shipments = getLocalShipments();
        shipments = shipments.filter(x => x.id !== shipmentId);
        setLocalShipments(shipments);
        return true;
    };

    if (!firestoreDb) return localFallback();
    
    try {
        await firestoreDb.collection('shipments').doc(shipmentId).delete();
        
        // Also delete associated history
        const historyRef = firestoreDb.collection('shipment_history');
        const historySnapshot = await historyRef.where('shipment_id', '==', shipmentId).get();
        
        const batch = firestoreDb.batch();
        historySnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
        return true;
    } catch (err) {
        console.error("Error deleting shipment in Firebase, using local fallback", err);
        return localFallback();
    }
}

async function addShipmentHistory(historyData) {
    historyData.update_date = historyData.update_date || new Date().toISOString();

    const localFallback = () => {
        historyData.id = uuidv4();
        const history = getLocalHistory();
        history.push(historyData);
        setLocalHistory(history);
        return historyData;
    };

    if (!firestoreDb) return localFallback();
    
    try {
        const historyRef = firestoreDb.collection('shipment_history');
        const docRef = await historyRef.add(historyData);
        return { id: docRef.id, ...historyData };
    } catch (err) {
        console.error("Error adding history in Firebase, using local fallback", err);
        return localFallback();
    }
}

async function updateShipmentHistory(historyId, updateData) {
    const localFallback = () => {
        let history = getLocalHistory();
        const idx = history.findIndex(x => x.id === historyId);
        if (idx !== -1) {
            history[idx] = { ...history[idx], ...updateData };
            setLocalHistory(history);
            return history[idx];
        }
        return null;
    };

    if (!firestoreDb) return localFallback();

    try {
        const docRef = firestoreDb.collection('shipment_history').doc(historyId);
        await docRef.update(updateData);
        const docSnap = await docRef.get();
        return { id: docSnap.id, ...docSnap.data() };
    } catch (err) {
        console.error("Error updating shipment history in Firebase, using local fallback", err);
        return localFallback();
    }
}

async function deleteShipmentHistory(historyId) {
    const localFallback = () => {
        let history = getLocalHistory();
        history = history.filter(x => x.id !== historyId);
        setLocalHistory(history);
        return true;
    };

    if (!firestoreDb) return localFallback();

    try {
        await firestoreDb.collection('shipment_history').doc(historyId).delete();
        return true;
    } catch (err) {
        console.error("Error deleting history in Firebase, using local fallback", err);
        return localFallback();
    }
}

async function getShipmentHistory(shipmentId) {
    const localFallback = () => {
        return getLocalHistory()
            .filter(h => h.shipment_id === shipmentId)
            .map(h => sanitizeHistoryItem(h).item)
            .sort((a, b) => new Date(b.update_date) - new Date(a.update_date));
    };

    if (!firestoreDb) return localFallback();

    try {
        const historyRef = firestoreDb.collection('shipment_history');
        const historySnapshot = await historyRef.where('shipment_id', '==', shipmentId).get();
        let history = historySnapshot.docs.map(hDoc => {
            const data = { id: hDoc.id, ...hDoc.data() };
            return sanitizeHistoryItem(data).item;
        });
        history.sort((a, b) => new Date(b.update_date) - new Date(a.update_date));
        return history;
    } catch (err) {
        console.error("Error fetching shipment history from Firebase, using local fallback", err);
        return localFallback();
    }
}

// Export for module usage (if enabled), otherwise accessible in window
window.db = window.db || {
    getShipment,
    getAllShipments,
    createShipment,
    updateShipment,
    deleteShipment,
    addShipmentHistory,
    updateShipmentHistory,
    deleteShipmentHistory,
    getShipmentHistory
};
