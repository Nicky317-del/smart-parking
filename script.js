
// ==========================================
// SMARTPARK PRO - MAIN JAVASCRIPT
// ==========================================

let usersData = [];
let vehiclesData = [];
let paymentsData = [];
let slotsData = [];
let reservationsData = [];
let occupancyChart = null;


// ==========================================
// API REQUEST
// ==========================================

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.error || data.message || "Request failed"
        );
    }

    return data;
}


// ==========================================
// HELPERS
// ==========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];
    });
}

function money(value) {
    return "₹" + Number(value || 0).toFixed(2);
}

function showMessage(message) {
    alert(message);
}

function getStatusClass(status) {
    return String(status || "").toLowerCase().replace(/\s+/g, "-");
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


// ==========================================
// DATE
// ==========================================

function updateDate() {
    const dateElement = document.getElementById("current-date");

    if (dateElement) {
        dateElement.textContent = new Date().toLocaleDateString(
            "en-IN",
            {
                day: "numeric",
                month: "short",
                year: "numeric"
            }
        );
    }
}


// ==========================================
// NAVIGATION
// ==========================================

document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();

        const page = link.dataset.page;

        document.querySelectorAll(".nav-link").forEach(item => {
            item.classList.remove("active");
        });

        link.classList.add("active");

        document.querySelectorAll(".page-section").forEach(section => {
            section.classList.remove("active");
        });

        document.getElementById(page + "-page")?.classList.add("active");

        const headings = {
            dashboard: "Dashboard Overview",
            vehicles: "Vehicle Management",
            payments: "Payment Management",
            reports: "Reports & Analytics"
        };

        setText("page-heading", headings[page] || "SmartPark Pro");

        if (page === "dashboard") {
            loadDashboard();
            loadSlots();
            loadReservations();
        }

        if (page === "vehicles") {
            loadUsers();
            loadVehicles();
        }

        if (page === "payments") {
            loadPayments();
        }

        if (page === "reports") {
            loadReports();
        }
    });
});


// ==========================================
// DASHBOARD
// ==========================================

async function loadDashboard() {
    try {
        const data = await apiRequest("/api/dashboard");

        const available = Number(
            data.availableSlots ?? data.available_slots ?? 0
        );

        const occupied = Number(
            data.occupiedSlots ?? data.occupied_slots ?? 0
        );

        setText("totalSlots", data.totalSlots ?? data.total_slots ?? 0);
        setText("availableSlots", available);
        setText("occupiedSlots", occupied);

        setText(
            "totalReservations",
            data.totalReservations ?? data.total_reservations ?? 0
        );

        updateOccupancyChart(available, occupied);

    } catch (error) {
        console.error("Dashboard loading failed:", error);
    }
}


// ==========================================
// PARKING SLOTS
// ==========================================

async function loadSlots() {
    try {
        slotsData = await apiRequest("/api/slots");
        renderParkingSlots();

    } catch (error) {
        console.error("Slot loading failed:", error);

        const grid = document.getElementById("parkingGrid");

        if (grid) {
            grid.innerHTML = "<p>Unable to load parking slots.</p>";
        }
    }
}


function renderParkingSlots() {
    const grid = document.getElementById("parkingGrid");

    if (!grid) return;

    const search = (
        document.getElementById("slotSearch")?.value || ""
    ).toLowerCase();

    const filter = (
        document.getElementById("slotFilter")?.value || "all"
    ).toLowerCase();

    const filteredSlots = slotsData.filter(slot => {
        const slotNumber = String(slot.slot_number || "").toLowerCase();
        const status = String(slot.slot_status || "").toLowerCase();

        return slotNumber.includes(search) &&
            (
                filter === "all" ||
                (filter === "available" && status === "available") ||
                (filter === "occupied" && status === "occupied")
            );
    });

    if (!filteredSlots.length) {
        grid.innerHTML = "<p>No parking slots found.</p>";
        return;
    }

    grid.innerHTML = filteredSlots.map(slot => {
        const status = String(slot.slot_status || "Unknown");
        const assignedVehicle = slot.registration_number || "";

        const vehicleOptions = vehiclesData.map(vehicle => `
            <option value="${Number(vehicle.vehicle_id)}">
                ${escapeHTML(vehicle.registration_number)}
                (${escapeHTML(vehicle.vehicle_type)})
            </option>
        `).join("");

        return `
            <div class="parking-card ${escapeHTML(getStatusClass(status))}">
                <h3>${escapeHTML(slot.slot_number)}</h3>

                <p>Slot ID: ${escapeHTML(slot.slot_id)}</p>
                <p>Type: ${escapeHTML(slot.slot_type || "General")}</p>
                <p>Rate: ${money(slot.hourly_rate)} / hour</p>

                <p class="slot-status">
                    Status: <strong>${escapeHTML(status)}</strong>
                </p>

                <div class="assigned-vehicle">
                    <strong>Assigned Vehicle:</strong>
                    <p>
                        ${assignedVehicle
                            ? escapeHTML(assignedVehicle)
                            : "No vehicle assigned"}
                    </p>
                </div>

                ${
                    status.toLowerCase() !== "maintenance" &&
                    status.toLowerCase() !== "reserved"
                    ? `
                        <div class="slot-assignment">
                            <select id="vehicleForSlot-${Number(slot.slot_id)}">
                                <option value="">Select vehicle</option>
                                ${vehicleOptions}
                            </select>

                            <button
                                type="button"
                                class="primary-btn"
                                onclick="assignVehicle(${Number(slot.slot_id)})">
                                Assign
                            </button>

                            ${
                                assignedVehicle
                                ? `
                                    <button
                                        type="button"
                                        class="secondary-btn"
                                        onclick="removeVehicleAssignment(${Number(slot.slot_id)})">
                                        Remove
                                    </button>
                                `
                                : ""
                            }
                        </div>
                    `
                    : ""
                }
            </div>
        `;
    }).join("");
}


// ==========================================
// MANUAL VEHICLE ASSIGNMENT
// ==========================================

async function assignVehicle(slotId) {
    const select = document.getElementById(
        `vehicleForSlot-${slotId}`
    );

    if (!select || !select.value) {
        showMessage("Please select a vehicle first.");
        return;
    }

    try {
        await apiRequest(`/api/slots/${slotId}/assign`, {
            method: "POST",
            body: JSON.stringify({
                vehicle_id: Number(select.value)
            })
        });

        showMessage("Vehicle assigned successfully!");

        await loadSlots();
        await loadDashboard();

    } catch (error) {
        showMessage(error.message);
    }
}


async function removeVehicleAssignment(slotId) {
    if (!confirm("Remove this vehicle from the parking slot?")) {
        return;
    }

    try {
        await apiRequest(`/api/slots/${slotId}/assign`, {
            method: "DELETE"
        });

        showMessage("Vehicle assignment removed successfully!");

        await loadSlots();
        await loadDashboard();

    } catch (error) {
        showMessage(error.message);
    }
}


// ==========================================
// OCCUPANCY CHART
// ==========================================

function updateOccupancyChart(available, occupied) {
    const canvas = document.getElementById("occupancyChart");

    if (!canvas || typeof Chart === "undefined") return;

    if (occupancyChart) {
        occupancyChart.destroy();
    }

    occupancyChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: ["Available", "Occupied"],
            datasets: [{
                data: [available, occupied],
                backgroundColor: ["#22c55e", "#f59e0b"],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom"
                }
            }
        }
    });
}


// ==========================================
// RESERVATIONS
// ==========================================

async function loadReservations() {
    try {
        reservationsData = await apiRequest("/api/reservations");
        renderReservations();

    } catch (error) {
        console.error("Reservation loading failed:", error);
    }
}


function renderReservations() {
    const table = document.getElementById("reservationTable");

    if (!table) return;

    if (!reservationsData.length) {
        table.innerHTML = `
            <tr><td colspan="4">No reservations found.</td></tr>
        `;
        return;
    }

    table.innerHTML = reservationsData.map(reservation => `
        <tr>
            <td>${escapeHTML(reservation.reservation_id)}</td>
            <td>${escapeHTML(reservation.user_id)}</td>
            <td>${escapeHTML(reservation.slot_id)}</td>
            <td>
                <span class="status-badge ${escapeHTML(
                    getStatusClass(reservation.reservation_status)
                )}">
                    ${escapeHTML(reservation.reservation_status)}
                </span>
            </td>
        </tr>
    `).join("");
}


// ==========================================
// USER MANAGEMENT
// ==========================================

// LOAD USERS INTO VEHICLE OWNER DROPDOWN

async function loadUsers() {
    const dropdown = document.getElementById("vehicleUserId");

    if (!dropdown) return;

    try {
        usersData = await apiRequest("/api/users");

        dropdown.innerHTML = `
            <option value="">Select a vehicle owner</option>
        `;

        usersData.forEach(user => {
            const option = document.createElement("option");

            option.value = user.user_id;

            // Correct database column: full_name
            option.textContent =
                `${user.full_name} (User ID: ${user.user_id})`;

            dropdown.appendChild(option);
        });

        if (usersData.length === 0) {
            dropdown.innerHTML = `
                <option value="">No registered users found</option>
            `;
        }

    } catch (error) {
        console.error("User loading failed:", error);

        dropdown.innerHTML = `
            <option value="">Unable to load users</option>
        `;
    }
}


// ==========================================
// ADD NEW USER
// ==========================================

const userForm = document.getElementById("userForm");

if (userForm) {
    userForm.addEventListener("submit", async event => {
        event.preventDefault();

        const button = document.getElementById("addUserBtn");
        const message = document.getElementById("userMessage");

        const userData = {
            full_name: document.getElementById("newUserName").value.trim(),
            email: document.getElementById("newUserEmail").value.trim(),
            phone: document.getElementById("newUserPhone").value.trim()
        };

        if (
            !userData.full_name ||
            !userData.email ||
            !userData.phone
        ) {
            showMessage("Please fill in all user details.");
            return;
        }

        try {
            if (button) button.disabled = true;

            const result = await apiRequest("/api/users", {
                method: "POST",
                body: JSON.stringify(userData)
            });

            await loadUsers();

            const dropdown = document.getElementById("vehicleUserId");

            if (dropdown && result.user_id) {
                dropdown.value = String(result.user_id);
            }

            userForm.reset();

            if (message) {
                message.textContent =
                    `User added successfully! User ID: ${result.user_id}`;
            }

            showMessage(
                `User added successfully!\nUser ID: ${result.user_id}`
            );

        } catch (error) {
            if (message) {
                message.textContent = error.message;
            }

            showMessage(error.message);

        } finally {
            if (button) button.disabled = false;
        }
    });
}


// ==========================================
// VEHICLE MANAGEMENT
// ==========================================

async function loadVehicles() {
    try {
        vehiclesData = await apiRequest("/api/vehicles");

        renderVehicles();
        renderParkingSlots();

    } catch (error) {
        console.error("Vehicle loading failed:", error);

        const table = document.getElementById("vehicleTable");

        if (table) {
            table.innerHTML = `
                <tr><td colspan="8">Unable to load vehicles.</td></tr>
            `;
        }
    }
}


function renderVehicles() {
    const table = document.getElementById("vehicleTable");

    if (!table) return;

    setText("vehicleCount", vehiclesData.length);

    const search = (
        document.getElementById("vehicleSearch")?.value || ""
    ).toLowerCase();

    const filter = (
        document.getElementById("vehicleFilter")?.value || "all"
    ).toLowerCase();

    const filteredVehicles = vehiclesData.filter(vehicle => {
        const registration = String(
            vehicle.registration_number || ""
        ).toLowerCase();

        const type = String(
            vehicle.vehicle_type || ""
        ).toLowerCase();

        return registration.includes(search) &&
            (filter === "all" || type === filter);
    });

    if (!filteredVehicles.length) {
        table.innerHTML = `
            <tr><td colspan="8">No vehicles found.</td></tr>
        `;
        return;
    }

    table.innerHTML = filteredVehicles.map(vehicle => `
        <tr>
            <td>${escapeHTML(vehicle.vehicle_id)}</td>
            <td>${escapeHTML(vehicle.user_id)}</td>
            <td>${escapeHTML(vehicle.registration_number)}</td>
            <td>${escapeHTML(vehicle.vehicle_type)}</td>
            <td>${escapeHTML(vehicle.brand || "-")}</td>
            <td>${escapeHTML(vehicle.model || "-")}</td>
            <td>${escapeHTML(vehicle.color || "-")}</td>
            <td>
                <button
                    type="button"
                    class="edit-btn"
                    onclick="editVehicle(${Number(vehicle.vehicle_id)})">
                    Edit
                </button>

                <button
                    type="button"
                    class="delete-btn"
                    onclick="deleteVehicle(${Number(vehicle.vehicle_id)})">
                    Delete
                </button>
            </td>
        </tr>
    `).join("");
}


// ==========================================
// ADD / UPDATE VEHICLE
// ==========================================

const vehicleForm = document.getElementById("vehicleForm");

if (vehicleForm) {
    vehicleForm.addEventListener("submit", async event => {
        event.preventDefault();

        const vehicleId = document.getElementById("vehicleId").value;

        const userId = Number(
            document.getElementById("vehicleUserId").value
        );

        if (!Number.isInteger(userId) || userId <= 0) {
            showMessage("Please select a registered user.");
            return;
        }

        const vehicle = {
            user_id: userId,

            registration_number: document
                .getElementById("registrationNumber")
                .value.trim()
                .toUpperCase(),

            vehicle_type: document
                .getElementById("vehicleType").value,

            brand: document
                .getElementById("vehicleBrand").value.trim(),

            model: document
                .getElementById("vehicleModel").value.trim(),

            color: document
                .getElementById("vehicleColor").value.trim()
        };

        if (!vehicle.registration_number || !vehicle.vehicle_type) {
            showMessage("Please enter registration number and vehicle type.");
            return;
        }

        try {
            if (vehicleId) {
                await apiRequest(`/api/vehicles/${vehicleId}`, {
                    method: "PUT",
                    body: JSON.stringify(vehicle)
                });

                showMessage("Vehicle updated successfully!");

            } else {
                await apiRequest("/api/vehicles", {
                    method: "POST",
                    body: JSON.stringify(vehicle)
                });

                showMessage("Vehicle registered successfully!");
            }

            vehicleForm.reset();

            document.getElementById("vehicleId").value = "";

            setText("vehicleFormTitle", "Register New Vehicle");
            setText("vehicleSubmitBtn", "Add Vehicle");

            await loadVehicles();

        } catch (error) {
            showMessage(error.message);
        }
    });
}


// ==========================================
// EDIT VEHICLE
// ==========================================

function editVehicle(vehicleId) {
    const vehicle = vehiclesData.find(
        item => Number(item.vehicle_id) === Number(vehicleId)
    );

    if (!vehicle) {
        showMessage("Vehicle not found.");
        return;
    }

    document.getElementById("vehicleId").value = vehicle.vehicle_id;

    document.getElementById("vehicleUserId").value =
        String(vehicle.user_id);

    document.getElementById("registrationNumber").value =
        vehicle.registration_number || "";

    document.getElementById("vehicleType").value =
        vehicle.vehicle_type || "";

    document.getElementById("vehicleBrand").value =
        vehicle.brand || "";

    document.getElementById("vehicleModel").value =
        vehicle.model || "";

    document.getElementById("vehicleColor").value =
        vehicle.color || "";

    setText("vehicleFormTitle", "Update Vehicle");
    setText("vehicleSubmitBtn", "Update Vehicle");

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


// ==========================================
// DELETE VEHICLE
// ==========================================

async function deleteVehicle(vehicleId) {
    if (!confirm("Are you sure you want to delete this vehicle?")) {
        return;
    }

    try {
        await apiRequest(`/api/vehicles/${vehicleId}`, {
            method: "DELETE"
        });

        showMessage("Vehicle deleted successfully!");

        await loadVehicles();
        await loadSlots();

    } catch (error) {
        showMessage(error.message);
    }
}


// ==========================================
// CLEAR VEHICLE FORM
// ==========================================

const clearVehicleButton = document.getElementById("cancelVehicleEdit");

if (clearVehicleButton) {
    clearVehicleButton.addEventListener("click", () => {
        vehicleForm.reset();

        document.getElementById("vehicleId").value = "";

        setText("vehicleFormTitle", "Register New Vehicle");
        setText("vehicleSubmitBtn", "Add Vehicle");
    });
}


// ==========================================
// PAYMENTS
// ==========================================

async function loadPayments() {
    try {
        paymentsData = await apiRequest("/api/payments");
        renderPayments();

    } catch (error) {
        console.error("Payment loading failed:", error);

        const table = document.getElementById("paymentTable");

        if (table) {
            table.innerHTML = `
                <tr><td colspan="8">Unable to load payment records.</td></tr>
            `;
        }
    }
}


function renderPayments() {
    const table = document.getElementById("paymentTable");

    if (!table) return;

    const search = (
        document.getElementById("paymentSearch")?.value || ""
    ).toLowerCase();

    const filter = (
        document.getElementById("paymentFilter")?.value || "all"
    ).toLowerCase();

    const filteredPayments = paymentsData.filter(payment => {
        const transactionId = String(
            payment.transaction_id || ""
        ).toLowerCase();

        const status = String(
            payment.payment_status || ""
        ).toLowerCase();

        const matchesFilter =
            filter === "all" ||
            (filter === "success" && status === "completed") ||
            status === filter;

        return transactionId.includes(search) && matchesFilter;
    });

    if (!filteredPayments.length) {
        table.innerHTML = `
            <tr><td colspan="8">No payment records found.</td></tr>
        `;
    } else {
        table.innerHTML = filteredPayments.map(payment => `
            <tr>
                <td>${escapeHTML(payment.payment_id)}</td>
                <td>${escapeHTML(payment.reservation_id)}</td>
                <td>${escapeHTML(payment.user_id)}</td>
                <td>${money(payment.amount)}</td>
                <td>${escapeHTML(payment.payment_method)}</td>
                <td>${escapeHTML(payment.transaction_id)}</td>
                <td>
                    <span class="status-badge ${escapeHTML(
                        getStatusClass(payment.payment_status)
                    )}">
                        ${escapeHTML(payment.payment_status)}
                    </span>
                </td>
                <td>
                    ${payment.payment_time
                        ? escapeHTML(
                            new Date(payment.payment_time).toLocaleString("en-IN")
                        )
                        : "-"
                    }
                </td>
            </tr>
        `).join("");
    }

    const completedPayments = paymentsData.filter(
        payment =>
            String(payment.payment_status).toLowerCase() === "completed"
    );

    const pendingPaymentsList = paymentsData.filter(
        payment =>
            String(payment.payment_status).toLowerCase() === "pending"
    );

    const revenue = completedPayments.reduce(
        (total, payment) => total + Number(payment.amount || 0),
        0
    );

    setText("paymentCount", paymentsData.length);
    setText("totalRevenue", money(revenue));
    setText("pendingPayments", pendingPaymentsList.length);
}


// ==========================================
// REPORTS
// ==========================================

async function loadReports() {
    try {
        const [dashboard, vehicles, payments, reservations] =
            await Promise.all([
                apiRequest("/api/dashboard"),
                apiRequest("/api/vehicles"),
                apiRequest("/api/payments"),
                apiRequest("/api/reservations")
            ]);

        const completedPayments = payments.filter(
            payment =>
                String(payment.payment_status).toLowerCase() === "completed"
        );

        const revenue = completedPayments.reduce(
            (total, payment) => total + Number(payment.amount || 0),
            0
        );

        const totalSlots =
            dashboard.totalSlots ??
            dashboard.total_slots ??
            0;

        setText("reportSlots", totalSlots);
        setText("reportVehicles", vehicles.length);
        setText("reportReservations", reservations.length);
        setText("reportRevenue", money(revenue));

        const output = document.getElementById("reportOutput");

        if (output) {
            output.innerHTML = `
                <h3>SmartPark Pro System Report</h3>

                <p><strong>Report Date:</strong>
                    ${escapeHTML(new Date().toLocaleDateString("en-IN"))}
                </p>

                <hr>

                <p><strong>Total Parking Slots:</strong> ${escapeHTML(totalSlots)}</p>

                <p><strong>Available Slots:</strong>
                    ${escapeHTML(dashboard.availableSlots ?? dashboard.available_slots ?? 0)}
                </p>

                <p><strong>Occupied Slots:</strong>
                    ${escapeHTML(dashboard.occupiedSlots ?? dashboard.occupied_slots ?? 0)}
                </p>

                <p><strong>Registered Vehicles:</strong> ${vehicles.length}</p>
                <p><strong>Total Reservations:</strong> ${reservations.length}</p>
                <p><strong>Total Payments:</strong> ${payments.length}</p>
                <p><strong>Completed Payment Revenue:</strong> ${money(revenue)}</p>

                <hr>

                <p><strong>System Status:</strong> Active</p>
                <p><strong>Application:</strong> SmartPark Pro</p>
            `;
        }

    } catch (error) {
        console.error("Report loading failed:", error);
        showMessage("Unable to generate report: " + error.message);
    }
}


// ==========================================
// REPORT BUTTONS
// ==========================================

document.getElementById("generateReportBtn")?.addEventListener(
    "click",
    loadReports
);

document.getElementById("printReportBtn")?.addEventListener(
    "click",
    () => window.print()
);


// ==========================================
// SEARCH AND FILTER EVENTS
// ==========================================

document.getElementById("slotSearch")?.addEventListener(
    "input",
    renderParkingSlots
);

document.getElementById("slotFilter")?.addEventListener(
    "change",
    renderParkingSlots
);

document.getElementById("vehicleSearch")?.addEventListener(
    "input",
    renderVehicles
);

document.getElementById("vehicleFilter")?.addEventListener(
    "change",
    renderVehicles
);

document.getElementById("paymentSearch")?.addEventListener(
    "input",
    renderPayments
);

document.getElementById("paymentFilter")?.addEventListener(
    "change",
    renderPayments
);


// ==========================================
// REFRESH
// ==========================================

document.getElementById("refreshBtn")?.addEventListener(
    "click",
    async () => {
        await loadWebsite();
        showMessage("SmartPark data refreshed successfully!");
    }
);


// ==========================================
// LOAD WEBSITE
// ==========================================

async function loadWebsite() {
    updateDate();

    await Promise.all([
        loadDashboard(),
        loadSlots(),
        loadReservations(),
        loadUsers(),
        loadVehicles(),
        loadPayments()
    ]);
}


// ==========================================
// INITIALIZE
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    loadWebsite();
});
